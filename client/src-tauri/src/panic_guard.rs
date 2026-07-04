//! Blast-radius containment for background-task panics (docs/ROADMAP.md,
//! Phase 1 "linked_chunk panic plan").
//!
//! The known offender is matrix-sdk 0.18's event cache
//! (`linked_chunk/as_vector.rs: "The chunk is not found"`, upstream #5416):
//! a panic kills the tokio worker task, the sync observer's recovery loop
//! restarts sync, and the app self-heals. This module adds the two layers we
//! own on top of that:
//!
//!   1. TELEMETRY — a chained panic hook that appends every panic (message,
//!      location, backtrace) to `<app_data>/panics.log` and emits a
//!      "rust-panic" Tauri event, so panic *frequency* is measurable
//!      (Gate G2 reads this) instead of anecdotal.
//!   2. THE HAMMER — if event-cache-class panics recur in one session, the
//!      cache is presumed poisoned: we drop a flag file, and the NEXT launch
//!      deletes `matrix-sdk-event-cache.sqlite3` before the client is built.
//!      The event cache is disposable by design (the server is truth); the
//!      cost is one cold open. Crypto keys, state, and media stores are
//!      untouched.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::OnceLock;

use tauri::Emitter;

/// Event-cache-class panics in one session before we schedule a wipe.
/// ONE is enough: a single `linked_chunk` panic (upstream #5416) leaves the
/// persisted event cache inconsistent (`InvalidItemIndex` on subsequent ops),
/// which silently freezes open-room timelines even though sync self-heals and
/// the room list (a separate RoomListService path) keeps updating. Confirmed
/// 2026-07-05: wiping the event cache and relaunching clears both the panic
/// on load and the frozen timelines. The cost — one cold open — is far cheaper
/// than a silently-stale conversation.
const WIPE_THRESHOLD: u32 = 1;

/// Size cap for panics.log; at startup a larger file rolls to panics.log.1
/// (replacing the previous roll). Bounds total footprint at ~2× this cap
/// while keeping one generation for post-mortems.
const LOG_ROTATE_BYTES: u64 = 512 * 1024;

static APP_DATA_DIR: OnceLock<PathBuf> = OnceLock::new();
static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();
static PANIC_COUNT: AtomicU32 = AtomicU32::new(0);
static CACHE_PANIC_COUNT: AtomicU32 = AtomicU32::new(0);

fn flag_path(dir: &Path) -> PathBuf {
    dir.join("wipe-event-cache.flag")
}

/// Install the chained panic hook. Call once, as early as possible in run().
/// Safe to call before Tauri is up: until `arm()` provides the app-data dir,
/// panics still reach stderr via the previous (default) hook.
pub fn install() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let msg = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "<non-string panic payload>".into());
        let location = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "<unknown>".into());

        let n = PANIC_COUNT.fetch_add(1, Ordering::SeqCst) + 1;

        // Event-cache class: the linked_chunk family, or anything from the
        // event cache module. Only THESE feed the wipe hammer — an unrelated
        // panic shouldn't cost the user a cold open.
        let cache_class = location.contains("linked_chunk")
            || location.contains("event_cache")
            || msg.contains("chunk");
        let cache_n = if cache_class {
            CACHE_PANIC_COUNT.fetch_add(1, Ordering::SeqCst) + 1
        } else {
            CACHE_PANIC_COUNT.load(Ordering::SeqCst)
        };

        if let Some(dir) = APP_DATA_DIR.get() {
            let backtrace = std::backtrace::Backtrace::force_capture();
            let entry = format!(
                "[{}] panic #{n} (cache-class: {cache_class}) at {location}\n{msg}\n{backtrace}\n\n",
                chrono_lite_now()
            );
            let _ = std::fs::create_dir_all(dir);
            let _ = append(&dir.join("panics.log"), &entry);

            if cache_class && cache_n >= WIPE_THRESHOLD {
                // Poisoned cache presumed: schedule the wipe for next launch.
                let _ = std::fs::write(
                    flag_path(dir),
                    format!("scheduled by panic #{n} at {location}\n"),
                );
            }
        }

        if let Some(app) = APP_HANDLE.get() {
            let _ = app.emit(
                "rust-panic",
                serde_json::json!({
                    "message": msg,
                    "location": location,
                    "count": n,
                    "cache_class": cache_class,
                }),
            );
        }

        previous(info);
    }));
}

/// Late-bind the hook to the app: gives it the log/flag directory and the
/// handle for events, and — the hammer — performs a scheduled event-cache
/// wipe from the previous session. MUST run before the Matrix client is
/// built (i.e. in Tauri setup, before the webview can invoke login/restore),
/// otherwise the store files are open and locked.
pub fn arm(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };

    // Rotate the panic log before this session appends to it: no TTL games,
    // just a hard size bound (an active crash-loop writes fast; time doesn't
    // bound size, size does).
    let log = dir.join("panics.log");
    if std::fs::metadata(&log).map(|m| m.len() > LOG_ROTATE_BYTES).unwrap_or(false) {
        let _ = std::fs::rename(&log, dir.join("panics.log.1")); // replaces prior roll
    }

    let flag = flag_path(&dir);
    if flag.exists() {
        let store = dir.join("matrix.db");
        let mut removed = 0;
        for f in [
            "matrix-sdk-event-cache.sqlite3",
            "matrix-sdk-event-cache.sqlite3-wal",
            "matrix-sdk-event-cache.sqlite3-shm",
        ] {
            if std::fs::remove_file(store.join(f)).is_ok() {
                removed += 1;
            }
        }
        let _ = std::fs::remove_file(&flag);
        let _ = append(
            &dir.join("panics.log"),
            &format!(
                "[{}] cache-reset hammer: wiped event cache ({removed} files) per flag from previous session\n\n",
                chrono_lite_now()
            ),
        );
        println!("[panic-guard] event cache wiped ({removed} files) — poisoned-cache flag from previous session");
    }

    let _ = APP_DATA_DIR.set(dir);
    let _ = APP_HANDLE.set(app.clone());
}

/// Restart the app. Used by the UI's degraded-state banner after a cache-class
/// panic: relaunching runs `arm()`, which applies the scheduled event-cache
/// wipe and starts clean. `restart()` never returns (it re-execs the process).
#[tauri::command]
pub fn restart_app(app: tauri::AppHandle) {
    app.restart();
}

fn append(path: &Path, text: &str) -> std::io::Result<()> {
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(path)?;
    f.write_all(text.as_bytes())
}

/// RFC3339-ish local timestamp without pulling in chrono for one string.
fn chrono_lite_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("unix:{now}")
}

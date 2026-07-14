//! Timeline-loading performance log (Phase 2.5).
//!
//! The roadmap's guiding constraint is "keep the current speed": warm-room
//! count and auto-backfill depth must be tuned from measurement, not guessed.
//! This module is that measurement: every timeline open, room warming pass,
//! and auto-backfill round appends one line to `<app_data>/perf.log`, so a
//! dogfooding session produces the numbers the constants are tuned against.
//!
//! Format: `[unix:<secs>] <label> <detail>` — grep-friendly, one event per line.

use std::path::Path;

/// Same hard size bound as panics.log: rotation on size, not time.
const LOG_ROTATE_BYTES: u64 = 512 * 1024;

/// Append one measurement line to perf.log (rotating first if oversized).
/// Best-effort: a failed write must never affect the feature being measured.
pub fn note(app: &tauri::AppHandle, label: &str, detail: &str) {
    use tauri::Manager;
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    let log = dir.join("perf.log");
    if std::fs::metadata(&log).map(|m| m.len() > LOG_ROTATE_BYTES).unwrap_or(false) {
        let _ = std::fs::rename(&log, dir.join("perf.log.1")); // replaces prior roll
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let _ = append(&log, &format!("[unix:{now}] {label} {detail}\n"));
}

fn append(path: &Path, text: &str) -> std::io::Result<()> {
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(path)?;
    f.write_all(text.as_bytes())
}

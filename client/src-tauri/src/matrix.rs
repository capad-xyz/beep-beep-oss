//! Thin integration layer over `matrix-rust-sdk`.
//!
//! WHY THIS EXISTS
//! The frontend (React/TS) must never speak the Matrix protocol directly. It
//! calls the typed commands below; all the protocol, end-to-end encryption, and
//! sync complexity stays in Rust where `matrix-rust-sdk` handles it for us. This
//! is the whole point of the Rust core: we write glue, not crypto.
//!
//! ⚠️ VERSION / COMPILE NOTE
//! `matrix-rust-sdk`'s API changes between releases, and this skeleton has NOT
//! been compiled in CI yet. Treat the code below as the correct *shape* of the
//! integration. Before building, pin the current SDK (`cargo add matrix-sdk`)
//! and fix any renamed items the compiler points at. Spots most likely to need a
//! tweak are marked with `// VERIFY:`.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use matrix_sdk::{authentication::matrix::MatrixSession, ruma::OwnedUserId, store::RoomLoadSettings, Client};
use matrix_sdk_ui::sync_service::{State as SyncState, SyncService};
use matrix_sdk_ui::timeline::Timeline;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use tokio::sync::RwLock;
use ts_rs::TS;

/// Shared application state: the Matrix client, once logged in.
///
/// One Matrix account is enough even for the "two WhatsApp accounts" feature —
/// multi-account is handled *inside* a single Matrix account by the bridge
/// (bridgev2 multi-login), so the client stays single. If we later support
/// multiple *Matrix* accounts, this becomes a map keyed by user id.
#[derive(Default)]
pub struct MatrixState {
    client: Arc<RwLock<Option<Client>>>,
    /// The Simplified Sliding Sync engine. It must be kept alive for the app's
    /// lifetime (dropping it stops sync), so it lives in state beside the client.
    sync_service: RwLock<Option<Arc<SyncService>>>,
    /// Monotonic id of the *current* SyncService. `start_sync` bumps this on every
    /// login/restore and hands the fresh value to the observer task it spawns. The
    /// observer compares it against this counter after each state change and exits
    /// the moment it no longer matches — so when a new login replaces the service,
    /// the previous observer retires itself instead of two observers fighting to
    /// restart different (one of them dead) services. See `spawn_sync_observer`.
    sync_generation: Arc<AtomicU64>,

    /// The Timeline for the ONE room the user currently has open, if any.
    ///
    /// WHY SINGLE-OPEN-ROOM (not a map): the UI only ever shows one conversation
    /// at a time — opening a chat replaces whatever was open, and hitting "← Inbox"
    /// closes it. Modelling that as a single slot (not a `HashMap<room_id, …>`)
    /// keeps the lifecycle trivial: opening a new room drops the previous Timeline
    /// (which stops its SDK background tasks) and its diff-forwarding task retires
    /// itself via the generation guard below. No bookkeeping of stale entries, no
    /// risk of leaking timelines for rooms the user has long since navigated away
    /// from. If we ever add split-view / multiple open panes, this becomes a map.
    open_timeline: RwLock<Option<Arc<Timeline>>>,
    /// Monotonic id of the *current* open Timeline, mirroring `sync_generation`.
    /// `open_room_timeline` bumps this and hands the fresh value to the diff task
    /// it spawns; that task exits the instant the counter moves past its value
    /// (because a different room was opened, the room was closed, or we logged
    /// out). Without it, switching rooms fast could leave an old task still
    /// emitting the previous room's items over the shared "timeline-items" event.
    timeline_generation: Arc<AtomicU64>,
    /// Serializes `open_room_timeline` calls. Building a Timeline awaits several
    /// times BEFORE the generation bump + slot store, so two rapid open calls
    /// (fast room switching — the frontend doesn't await the previous open) could
    /// interleave and leave the WRONG room's Timeline parked in `open_timeline`
    /// while the visible room's diff task retires: the conversation silently stops
    /// updating and sends go to the wrong room. Tokio's Mutex is FIFO, so holding
    /// this across the whole open preserves invocation order — last open wins.
    open_timeline_lock: tokio::sync::Mutex<()>,
}

/// On-disk session for "stay logged in". The homeserver is saved alongside the
/// tokens because restore must rebuild the client against the same server.
#[derive(Serialize, Deserialize)]
struct SavedSession {
    homeserver: String,
    session: MatrixSession,
}

/// Per-app writable data dir (created if missing): holds the SQLite store + the
/// saved session. On Windows this is %APPDATA%\<app>.
fn data_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| format!("app data dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Does this Matrix error mean our session is no longer valid on the server?
///
/// The homeserver answers a request made with a dead access token with HTTP 401 +
/// `errcode: M_UNKNOWN_TOKEN` — this happens when the session is revoked remotely,
/// the device is deleted, or the token simply expired. There is nothing the client
/// can retry its way out of: the only cure is a fresh login. We treat `soft_logout`
/// the same as a hard one here — in both cases the current token is unusable and
/// the user must re-authenticate — so a single code path covers both.
///
/// `client_api_error_kind()` peels the ruma `errcode` out of whatever layer the
/// error surfaced from (a plain command, or a sliding-sync failure wrapped inside
/// the SyncService error), so one check works for every entry point.
fn is_auth_invalid(err: &matrix_sdk::Error) -> bool {
    use matrix_sdk::ruma::api::error::ErrorKind;
    matches!(err.client_api_error_kind(), Some(ErrorKind::UnknownToken { .. }))
}

/// The same M_UNKNOWN_TOKEN check, but for the error the SyncService reports in
/// `State::Error`. That is the UI crate's own error enum, which wraps the real
/// underlying failure: a dead token surfaces as a sliding-sync request failing,
/// i.e. `RoomList`/`EncryptionSync` → `SlidingSync(matrix_sdk::Error)`. We reach
/// through to that inner `matrix_sdk::Error` and reuse `is_auth_invalid`. Any
/// other error shape (a supervisor bug, etc.) is not an auth problem.
fn sync_error_is_auth_invalid(err: &matrix_sdk_ui::sync_service::Error) -> bool {
    use matrix_sdk_ui::{
        encryption_sync_service::Error as EncErr, room_list_service::Error as RoomErr,
        sync_service::Error as SyncErr,
    };
    let inner = match err {
        SyncErr::RoomList(RoomErr::SlidingSync(e)) => Some(e),
        SyncErr::EncryptionSync(EncErr::SlidingSync(e)) => Some(e),
        _ => None,
    };
    inner.is_some_and(is_auth_invalid)
}

/// React to a confirmed auth invalidation (M_UNKNOWN_TOKEN): wipe the saved
/// session so the next launch shows the login screen (not a broken restore), and
/// tell the frontend to drop back to login with an "expired" message. Idempotent —
/// safe to call from every place that can observe the failure (a command, or the
/// sync observer), because deleting an already-deleted file and emitting a second
/// event both no-op harmlessly.
fn handle_auth_invalid(app: &tauri::AppHandle) {
    if let Ok(dir) = data_dir(app) {
        let _ = std::fs::remove_file(dir.join("session.json"));
    }
    let _ = app.emit("auth-invalid", ());
}

/// Central error mapping for Tauri commands: stringify a Matrix error for the UI,
/// AND, if it's an auth invalidation, fire the same re-login flow the sync observer
/// uses. This means a command that trips over a dead token (e.g. the user sends a
/// message right as the session is revoked) surfaces the "session expired" flow
/// immediately, without waiting for the next sync tick to notice. Idempotent: if
/// the sync observer already fired `auth-invalid`, a second emit is harmless.
fn map_matrix_err(app: &tauri::AppHandle, err: matrix_sdk::Error) -> String {
    if is_auth_invalid(&err) {
        handle_auth_invalid(app);
    }
    err.to_string()
}

/// Map the four `SyncService` states we care about to the stable string the UI
/// listens for. `Idle` is folded into "reconnecting" because the only time the
/// observer sees `Idle` after a start is the brief window while a restart spins
/// back up — from the user's point of view that's "reconnecting", not a distinct
/// state worth its own pill. Returns None for `Running`, whose meaning ("all good")
/// the UI shows by hiding the pill entirely.
fn sync_state_label(state: &SyncState) -> Option<&'static str> {
    match state {
        SyncState::Running => None,
        SyncState::Offline => Some("offline"),
        SyncState::Terminated => Some("terminated"),
        SyncState::Error(_) => Some("reconnecting"),
        SyncState::Idle => Some("reconnecting"),
    }
}

/// Watch one SyncService's state stream and keep sync alive across drops.
///
/// WHY THIS EXISTS
/// `SyncService::start()` launches background tasks, but nothing inside the SDK
/// resurrects them if they die: a network drop, a laptop sleep/wake, or a server
/// hiccup can push the service into `Error`/`Terminated`, after which the app
/// looks alive but silently never syncs again. This task closes that gap — it
/// observes every state change, restarts on the terminal ones with exponential
/// backoff, and emits `sync-state` so the UI can show "Reconnecting…"/"Offline".
///
/// GENERATION GUARD (no double observers)
/// `start_sync` is called once per login/restore, each time replacing the service
/// in `MatrixState`. The observer holds an `Arc<SyncService>`, which keeps the OLD
/// service alive, so its stream would never end on its own — two observers could
/// then both try to restart their (one now-orphaned) service. To prevent that,
/// every `start_sync` bumps `sync_generation` and passes its value in as `my_gen`;
/// after each state change this task checks the shared counter and returns the
/// instant it no longer owns the current generation. The newest observer always
/// wins; older ones retire themselves.
fn spawn_sync_observer(
    sync_service: Arc<SyncService>,
    generation: Arc<AtomicU64>,
    my_gen: u64,
    app: tauri::AppHandle,
) {
    tauri::async_runtime::spawn(async move {
        let mut states = sync_service.state();
        // Retry delay for the auto-restart, doubling on each consecutive failure
        // and capped so we never wait more than a minute between attempts.
        let mut backoff = Duration::from_secs(1);
        const MAX_BACKOFF: Duration = Duration::from_secs(60);

        loop {
            // A new login replaced us — stop before touching a service we no longer own.
            if generation.load(Ordering::SeqCst) != my_gen {
                break;
            }

            let state = match states.next().await {
                // The state changed: react to the new value below.
                Some(state) => state,
                // The observable was dropped (the SyncService is gone, e.g. on
                // logout). Nothing left to watch, so the observer ends here.
                None => break,
            };

            // Re-check after the await: the state may have changed *because* a new
            // login is tearing the old service down. Don't restart a dead service.
            if generation.load(Ordering::SeqCst) != my_gen {
                break;
            }

            // Surface the new state to the UI (pill shows only when not Running).
            if let Some(label) = sync_state_label(&state) {
                let _ = app.emit("sync-state", label);
            } else {
                let _ = app.emit("sync-state", "running");
            }

            match state {
                // Healthy again: clear the pill and reset backoff so the *next*
                // failure starts from 1s, not wherever the last storm left off.
                SyncState::Running => {
                    backoff = Duration::from_secs(1);
                }
                // Offline mode is the SDK's own recovery loop (it polls
                // /versions and self-heals), so we don't fight it with a restart —
                // we only reflect it in the UI and wait for it to return to Running.
                SyncState::Offline | SyncState::Idle => {}
                // Terminal failures. If the cause is a dead token, no amount of
                // restarting helps — divert to the re-login flow. Otherwise, wait
                // out the backoff and restart the service.
                SyncState::Terminated | SyncState::Error(_) => {
                    if let SyncState::Error(err) = &state {
                        if sync_error_is_auth_invalid(err) {
                            handle_auth_invalid(&app);
                            break;
                        }
                    }
                    tokio::time::sleep(backoff).await;
                    if generation.load(Ordering::SeqCst) != my_gen {
                        break;
                    }
                    // `start()` is a no-op if already Running and does the right
                    // cleanup/restart from Terminated/Error/Offline (see its docs).
                    sync_service.start().await;
                    backoff = (backoff * 2).min(MAX_BACKOFF);
                }
            }
        }
    });
}

/// Build + start Simplified Sliding Sync for `client`, and wire its updates to a
/// debounced "rooms-updated" Tauri event so the UI stays live. Returns the
/// SyncService (kept alive in state). Shared by login + restore_session.
///
/// `generation` is `MatrixState.sync_generation`: we bump it here so the observer
/// this call spawns can tell whether it still owns the live service (see
/// `spawn_sync_observer`).
async fn start_sync(
    client: &Client,
    app: tauri::AppHandle,
    generation: Arc<AtomicU64>,
) -> Result<Arc<SyncService>, String> {
    let sync_service = SyncService::builder(client.clone())
        // Enable the SDK's offline mode: instead of hard-terminating when the
        // server is unreachable, the service enters `Offline` and polls
        // /_matrix/client/versions until it can sync again — so a transient network
        // drop self-heals and we surface it as "offline" rather than "reconnecting".
        .with_offline_mode()
        .build()
        .await
        .map_err(|e| e.to_string())?;
    let sync_service = Arc::new(sync_service);
    sync_service.start().await;

    // Claim a new generation for this service and start watching its lifecycle.
    // Ordering::SeqCst: the observer reads this from another task, and we want the
    // bump to be visible before the observer it spawns runs its first check.
    let my_gen = generation.fetch_add(1, Ordering::SeqCst) + 1;
    spawn_sync_observer(sync_service.clone(), generation, my_gen, app.clone());

    // Live "X is typing…" — typing events arrive via sliding sync's typing
    // extension; resolve display names and forward to the UI per room.
    client.add_event_handler({
        let app = app.clone();
        move |ev: matrix_sdk::ruma::events::typing::SyncTypingEvent, room: matrix_sdk::Room| {
            let app = app.clone();
            async move {
                let own = room.client().user_id().map(|u| u.to_owned());
                let mut names: Vec<String> = Vec::new();
                for uid in &ev.content.user_ids {
                    if Some(uid) == own.as_ref() {
                        continue; // our own typing isn't news to us
                    }
                    let name = match room.get_member(uid).await {
                        Ok(Some(m)) => m
                            .display_name()
                            .map(|s| s.to_owned())
                            .unwrap_or_else(|| uid.localpart().to_owned()),
                        _ => uid.localpart().to_owned(),
                    };
                    names.push(name);
                }
                let _ = app.emit(
                    "typing",
                    serde_json::json!({ "room_id": room.room_id().to_string(), "names": names }),
                );
            }
        }
    });

    // Desktop notifications for incoming messages. Gates, in cheap-first order:
    // fresh event (skips history backfill), not our own, window unfocused, and
    // the room isn't muted (push-rule check last — it's the costly one).
    client.add_event_handler({
        let app = app.clone();
        move |ev: matrix_sdk::ruma::events::room::message::SyncRoomMessageEvent,
              room: matrix_sdk::Room| {
            let app = app.clone();
            async move {
                use matrix_sdk::notification_settings::RoomNotificationMode;
                use matrix_sdk::ruma::events::room::message::MessageType;
                use tauri::Manager;
                use tauri_plugin_notification::NotificationExt;

                let Some(original) = ev.as_original() else { return };

                // Freshness: only notify for events younger than ~2 minutes, so
                // initial sync / backfill can't fire a notification storm.
                let fresh = original
                    .origin_server_ts
                    .to_system_time()
                    .and_then(|t| std::time::SystemTime::now().duration_since(t).ok())
                    .is_some_and(|age| age.as_secs() < 120);
                if !fresh {
                    return;
                }

                // Never notify for our own messages (incl. echoes from other devices).
                let client = room.client();
                if Some(original.sender.as_ref()) == client.user_id() {
                    return;
                }

                // Only notify when the app isn't focused — if the user is looking
                // at the app, the inbox/timeline already shows the message.
                let focused = app
                    .get_webview_window("main")
                    .and_then(|w| w.is_focused().ok())
                    .unwrap_or(false);
                if focused {
                    return;
                }

                // Muted rooms stay silent.
                let mode = client
                    .notification_settings()
                    .await
                    .get_user_defined_room_notification_mode(room.room_id())
                    .await;
                if mode == Some(RoomNotificationMode::Mute) {
                    return;
                }

                let title = match room.display_name().await {
                    Ok(dn) => dn.to_string(),
                    Err(_) => "New message".to_string(),
                };
                let preview = match &original.content.msgtype {
                    MessageType::Text(t) => t.body.clone(),
                    MessageType::Image(_) => "[image]".into(),
                    MessageType::Video(_) => "[video]".into(),
                    MessageType::Audio(_) => "[voice message]".into(),
                    MessageType::File(_) => "[file]".into(),
                    other => other.body().to_string(),
                };
                let preview: String = preview.chars().take(120).collect();

                let _ = app
                    .notification()
                    .builder()
                    .title(title)
                    .body(preview)
                    .show();
            }
        }
    });

    let mut updates = client.subscribe_to_all_room_updates();
    tauri::async_runtime::spawn(async move {
        loop {
            match updates.recv().await {
                Ok(_) => {}
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
            // INSTANT-first: emit immediately on the first update (no built-in
            // latency), then coalesce the burst that follows for 250ms and emit
            // once more so the final state also lands. This is the "no delay"
            // promise — a new message paints at once instead of after a debounce.
            let _ = app.emit("rooms-updated", ());
            let mut more = false;
            loop {
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_millis(250)) => break,
                    r = updates.recv() => match r {
                        Ok(_) => { more = true; continue },
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => { more = true; continue },
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
                    },
                }
            }
            if more {
                let _ = app.emit("rooms-updated", ());
            }
        }
    });

    Ok(sync_service)
}

/// A minimal, serializable view of a room for the UI.
///
/// `#[derive(TS)]` + `#[ts(export)]` makes `ts-rs` generate a matching
/// TypeScript type, so the Rust <-> TS boundary can never silently drift — the
/// gotcha we flagged when choosing this stack. The generated file lands in
/// `../src/bindings/` and the frontend imports it. Regenerate via `cargo test`.
#[derive(Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct RoomSummary {
    pub id: String,
    pub name: Option<String>,
    pub unread: u64,
    /// Whether this room is a bridged chat. Placeholder for now; a real
    /// implementation inspects room state for the bridge's marker events.
    pub is_bridged: bool,
    /// Our membership: "joined" | "invited" | "left" | "knocked" | "banned".
    /// The mautrix bridge invites us into each WhatsApp portal and waits for us
    /// to accept, so many real chats start "invited" — the UI dims those + offers
    /// Accept instead of opening into a 403. Derived from room.state().
    pub membership: String,
    /// Preview of the most recent text message, if any.
    pub last_message: Option<String>,
    /// Timestamp (ms since epoch) of that latest message — drives recency sort
    /// and a relative "2m / 3h / Mon" label in the inbox. f64 → plain TS number.
    pub last_ts: Option<f64>,
    /// The account (WhatsApp login) this chat belongs to, as the backing bridge
    /// Space's room id. None for rooms not inside any account Space (e.g. the
    /// bridge management room). The UI maps the id to a label via list_accounts.
    pub account: Option<String>,
    /// m.favourite tag — pinned chats sort first in the inbox.
    pub pinned: bool,
    /// m.lowpriority tag — archived chats are hidden behind the Archived filter.
    pub archived: bool,
    /// Per-room push rule set to Mute.
    pub muted: bool,
}

/// One hit from server-side full-text message search (across ALL chats).
#[derive(Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct SearchHit {
    pub room_id: String,
    pub room_name: Option<String>,
    pub sender_name: String,
    pub body: String,
    pub ts: f64,
}

/// One connected account (a WhatsApp login). mautrix models each login as a
/// Matrix Space whose children are that account's chats, so an account IS a Space.
#[derive(Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct Account {
    /// The backing Space room id: the stable key used to filter the inbox.
    pub id: String,
    /// Human label: the Space's display name (the bridge sets this per account).
    pub label: String,
}

/// The result of trying to restore a saved session on launch.
///
/// WHY A TYPE INSTEAD OF `Option<String>`
/// Restore can end three ways, and the login screen must tell them apart:
///   - there was no saved session at all → show a plain login form,
///   - a session existed but the server rejected it (revoked/expired token) →
///     show "Session expired, please log in again",
///   - it worked → skip login and go straight to the inbox.
///
/// The old `Option<String>` collapsed the first two into `None`, so the UI could
/// never show the "expired" message. `status` names the outcome; `user_id` is set
/// only for `restored`.
#[derive(Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct RestoreOutcome {
    /// One of: "restored" | "none" | "expired".
    pub status: String,
    /// The Matrix user id, present only when `status == "restored"`.
    pub user_id: Option<String>,
}

/// Log in with username + password and start syncing.
///
/// `homeserver` is e.g. `http://localhost:8008` (Phase 0 local) or
/// `https://yourname.duckdns.org` (Oracle path).
#[tauri::command]
pub async fn login(
    state: tauri::State<'_, MatrixState>,
    app: tauri::AppHandle,
    homeserver: String,
    username: String,
    password: String,
) -> Result<String, String> {
    // On-disk SQLite store (persists session + E2EE keys) under the app data dir,
    // so the next launch can restore this login (see restore_session).
    let dir = data_dir(&app)?;
    let client = Client::builder()
        .homeserver_url(&homeserver)
        .sqlite_store(dir.join("matrix.db"), None)
        .build()
        .await
        .map_err(|e| e.to_string())?;

    // Password login. Later we can add SSO / QR login like Element X.
    client
        .matrix_auth()
        .login_username(&username, &password)
        .initial_device_display_name("beep-beep")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let user_id: OwnedUserId = client.user_id().ok_or("no user id after login")?.to_owned();

    // Persist the session so the next launch can restore it (stay logged in).
    if let Some(session) = client.matrix_auth().session() {
        let saved = SavedSession { homeserver: homeserver.clone(), session };
        match serde_json::to_string(&saved) {
            Ok(json) => {
                let _ = std::fs::write(dir.join("session.json"), json);
            }
            Err(e) => eprintln!("session serialize failed: {e}"),
        }
    }

    // Sliding sync + live "rooms-updated" events (shared with restore_session).
    let svc = start_sync(&client, app.clone(), state.sync_generation.clone()).await?;
    *state.sync_service.write().await = Some(svc);

    *state.client.write().await = Some(client);
    Ok(user_id.to_string())
}

/// Try to restore a persisted session (stay logged in across restarts).
///
/// Returns a `RestoreOutcome` distinguishing the three cases the login screen
/// needs (no session / expired session / restored) — see that type. A rejected
/// token (M_UNKNOWN_TOKEN) is NOT a hard error: we wipe the dead session and
/// report "expired" so the UI can prompt a fresh login, rather than bubbling an
/// opaque error string.
#[tauri::command]
pub async fn restore_session(
    state: tauri::State<'_, MatrixState>,
    app: tauri::AppHandle,
) -> Result<RestoreOutcome, String> {
    let dir = data_dir(&app)?;
    let path = dir.join("session.json");
    if !path.exists() {
        return Ok(RestoreOutcome { status: "none".into(), user_id: None });
    }

    let json = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let saved: SavedSession = serde_json::from_str(&json).map_err(|e| e.to_string())?;

    let client = Client::builder()
        .homeserver_url(&saved.homeserver)
        .sqlite_store(dir.join("matrix.db"), None)
        .build()
        .await
        .map_err(|e| e.to_string())?;

    // A restore that fails on a dead token isn't an app error — it's an expired
    // login. Wipe the stale session file and report "expired" so the login screen
    // shows the right message. Any other error (network, corrupt store) still
    // bubbles up as a real error string.
    if let Err(err) = client
        .matrix_auth()
        .restore_session(saved.session, RoomLoadSettings::default())
        .await
    {
        if is_auth_invalid(&err) {
            let _ = std::fs::remove_file(&path);
            return Ok(RestoreOutcome { status: "expired".into(), user_id: None });
        }
        return Err(err.to_string());
    }

    let user_id: OwnedUserId = client.user_id().ok_or("no user id after restore")?.to_owned();

    let svc = start_sync(&client, app.clone(), state.sync_generation.clone()).await?;
    *state.sync_service.write().await = Some(svc);
    *state.client.write().await = Some(client);
    Ok(RestoreOutcome { status: "restored".into(), user_id: Some(user_id.to_string()) })
}

/// Return the current room list for the UI.
#[tauri::command]
pub async fn list_rooms(
    state: tauri::State<'_, MatrixState>,
) -> Result<Vec<RoomSummary>, String> {
    use matrix_sdk::RoomState;

    use matrix_sdk::notification_settings::RoomNotificationMode;
    use matrix_sdk::ruma::events::tag::TagName;

    let guard = state.client.read().await;
    let client = guard.as_ref().ok_or("not logged in")?;

    // Which account (bridge Space) each room belongs to, for the per-account filter.
    let (room_to_account, _accounts) = account_map(client).await;

    // Build each room's summary CONCURRENTLY. The per-room work (display name,
    // last-message fetch, tags) used to run sequentially — with ~70 rooms that
    // meant ~70 serial round trips per refresh. Parallel makes it feel instant.
    let mut set = tokio::task::JoinSet::new();
    for room in client.rooms() {
        // Spaces are containers (account groupings, WhatsApp communities), not
        // chats — they'd render as dead rows in the inbox.
        if room.is_space() {
            continue;
        }
        let account = room_to_account.get(room.room_id()).cloned();
        set.spawn(async move {
            // Prefer the SDK's computed display name (covers DMs / bridged rooms
            // that carry no m.room.name), falling back to the raw name.
            let name = match room.display_name().await {
                Ok(dn) => Some(dn.to_string()),
                Err(_) => room.name(),
            };
            let (last_message, last_ts) = match latest_message(&room).await {
                Some((body, ts)) => (Some(body), Some(ts)),
                None => (None, None),
            };
            let membership = match room.state() {
                RoomState::Joined => "joined",
                RoomState::Invited => "invited",
                RoomState::Left => "left",
                RoomState::Knocked => "knocked",
                RoomState::Banned => "banned",
            }
            .to_string();
            let (mut pinned, mut archived) = (false, false);
            if let Ok(Some(tags)) = room.tags().await {
                pinned = tags.contains_key(&TagName::Favorite);
                archived = tags.contains_key(&TagName::LowPriority);
            }
            RoomSummary {
                id: room.room_id().to_string(),
                name,
                unread: room.unread_notification_counts().notification_count,
                is_bridged: false,
                membership,
                last_message,
                last_ts,
                account,
                pinned,
                archived,
                muted: false, // filled below (needs the shared push ruleset)
            }
        });
    }

    let mut rooms = Vec::new();
    while let Some(res) = set.join_next().await {
        if let Ok(summary) = res {
            rooms.push(summary);
        }
    }

    // Mute flags from the push ruleset: one shared object, cheap local reads.
    let settings = client.notification_settings().await;
    for r in rooms.iter_mut() {
        if let Ok(rid) = matrix_sdk::ruma::RoomId::parse(&r.id) {
            r.muted = settings.get_user_defined_room_notification_mode(&rid).await
                == Some(RoomNotificationMode::Mute);
        }
    }

    Ok(rooms)
}

/// Pin/unpin a chat (the m.favourite tag — pinned chats sort first).
#[tauri::command]
pub async fn set_pinned(
    state: tauri::State<'_, MatrixState>,
    room_id: String,
    pinned: bool,
) -> Result<(), String> {
    use matrix_sdk::ruma::events::tag::{TagInfo, TagName};
    use matrix_sdk::ruma::RoomId;

    let guard = state.client.read().await;
    let client = guard.as_ref().ok_or("not logged in")?;
    let rid = RoomId::parse(&room_id).map_err(|e| e.to_string())?;
    let room = client.get_room(&rid).ok_or("room not found")?;
    if pinned {
        room.set_tag(TagName::Favorite, TagInfo::new()).await.map_err(|e| e.to_string())?;
    } else {
        room.remove_tag(TagName::Favorite).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Archive/unarchive a chat (the m.lowpriority tag — hidden behind the Archived filter).
#[tauri::command]
pub async fn set_archived(
    state: tauri::State<'_, MatrixState>,
    room_id: String,
    archived: bool,
) -> Result<(), String> {
    use matrix_sdk::ruma::events::tag::{TagInfo, TagName};
    use matrix_sdk::ruma::RoomId;

    let guard = state.client.read().await;
    let client = guard.as_ref().ok_or("not logged in")?;
    let rid = RoomId::parse(&room_id).map_err(|e| e.to_string())?;
    let room = client.get_room(&rid).ok_or("room not found")?;
    if archived {
        room.set_tag(TagName::LowPriority, TagInfo::new()).await.map_err(|e| e.to_string())?;
    } else {
        room.remove_tag(TagName::LowPriority).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Mute/unmute a chat's notifications (a per-room push rule).
#[tauri::command]
pub async fn set_muted(
    state: tauri::State<'_, MatrixState>,
    room_id: String,
    muted: bool,
) -> Result<(), String> {
    use matrix_sdk::notification_settings::RoomNotificationMode;
    use matrix_sdk::ruma::RoomId;

    let guard = state.client.read().await;
    let client = guard.as_ref().ok_or("not logged in")?;
    let rid = RoomId::parse(&room_id).map_err(|e| e.to_string())?;
    let settings = client.notification_settings().await;
    if muted {
        settings
            .set_room_notification_mode(&rid, RoomNotificationMode::Mute)
            .await
            .map_err(|e| e.to_string())?;
    } else {
        settings
            .delete_user_defined_room_rules(&rid)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Send a file/image to a room. `data_base64` is the file's bytes; the media
/// goes through the SDK's send queue (upload + m.image/m.file event).
#[tauri::command]
pub async fn send_media(
    state: tauri::State<'_, MatrixState>,
    room_id: String,
    filename: String,
    mime_type: String,
    data_base64: String,
) -> Result<(), String> {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    use matrix_sdk::attachment::AttachmentConfig;
    use matrix_sdk::ruma::RoomId;

    let guard = state.client.read().await;
    let client = guard.as_ref().ok_or("not logged in")?;
    let rid = RoomId::parse(&room_id).map_err(|e| e.to_string())?;
    let room = client.get_room(&rid).ok_or("room not found")?;

    let bytes = STANDARD.decode(&data_base64).map_err(|e| e.to_string())?;
    let mime: mime::Mime = mime_type.parse().unwrap_or(mime::APPLICATION_OCTET_STREAM);

    room.send_queue()
        .send_attachment(filename, mime, bytes, AttachmentConfig::default())
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Full-text search across ALL chats, server-side (Synapse /search).
#[tauri::command]
pub async fn search_messages(
    state: tauri::State<'_, MatrixState>,
    query: String,
    limit: u16,
) -> Result<Vec<SearchHit>, String> {
    use matrix_sdk::ruma::api::client::search::search_events::v3::{Categories, Criteria, Request};
    use matrix_sdk::ruma::events::{AnyMessageLikeEvent, AnyTimelineEvent};
    use matrix_sdk::ruma::events::room::message::MessageType;

    let guard = state.client.read().await;
    let client = guard.as_ref().ok_or("not logged in")?;

    let mut categories = Categories::new();
    categories.room_events = Some(Criteria::new(query));
    let resp = client.send(Request::new(categories)).await.map_err(|e| e.to_string())?;

    let mut hits = Vec::new();
    for result in resp.search_categories.room_events.results {
        let Some(raw) = result.result else { continue };
        let Ok(AnyTimelineEvent::MessageLike(AnyMessageLikeEvent::RoomMessage(msg))) =
            raw.deserialize()
        else {
            continue;
        };
        let Some(original) = msg.as_original() else { continue };
        let body = match &original.content.msgtype {
            MessageType::Text(t) => t.body.clone(),
            MessageType::Notice(n) => n.body.clone(),
            MessageType::Emote(e) => e.body.clone(),
            _ => continue,
        };
        let room_name = client
            .get_room(&original.room_id)
            .and_then(|r| r.name());
        hits.push(SearchHit {
            room_id: original.room_id.to_string(),
            room_name,
            sender_name: original.sender.localpart().to_string(),
            body,
            ts: u64::from(original.origin_server_ts.0) as f64,
        });
        if hits.len() >= limit as usize {
            break;
        }
    }
    Ok(hits)
}

/// Build the room -> account map (and the account list) from the bridge Spaces.
///
/// mautrix (bridgev2) models each WhatsApp login as a Matrix Space whose
/// `m.space.child` state events point at that account's chats. So we scan every
/// Space, read its children, and remember which Space (account) each chat is in.
/// A Space with no children is ignored (not a real account portal container).
async fn account_map(
    client: &Client,
) -> (std::collections::HashMap<matrix_sdk::ruma::OwnedRoomId, String>, Vec<Account>) {
    use matrix_sdk::deserialized_responses::SyncOrStrippedState;
    use matrix_sdk::ruma::events::{space::child::SpaceChildEventContent, SyncStateEvent};

    let mut room_to_account = std::collections::HashMap::new();
    let mut accounts = Vec::new();

    for space in client.rooms() {
        if !space.is_space() {
            continue;
        }
        let space_id = space.room_id().to_string();
        let label = match space.display_name().await {
            Ok(dn) => dn.to_string(),
            Err(_) => space.name().unwrap_or_else(|| "Account".to_string()),
        };

        // Only the bridge's per-account spaces are accounts; mautrix names them
        // "WhatsApp (+<number>)". This excludes WhatsApp Community spaces (also
        // m.space rooms) from being mistaken for accounts. WhatsApp-specific for
        // now; generalize per-network when we add more bridges.
        if !label.starts_with("WhatsApp (+") {
            continue;
        }

        let mut child_ids = Vec::new();
        if let Ok(children) = space.get_state_events_static::<SpaceChildEventContent>().await {
            for child in children {
                match child.deserialize() {
                    Ok(SyncOrStrippedState::Sync(SyncStateEvent::Original(e))) => {
                        child_ids.push(e.state_key)
                    }
                    Ok(SyncOrStrippedState::Stripped(e)) => child_ids.push(e.state_key),
                    _ => {}
                }
            }
        }

        // Push the account even with no children yet, so a freshly-linked account
        // shows its chip immediately (before its chats finish backfilling).
        for cid in child_ids {
            room_to_account.insert(cid, space_id.clone());
        }
        accounts.push(Account { id: space_id, label });
    }

    (room_to_account, accounts)
}

/// The connected accounts (WhatsApp logins), for the inbox's per-account filter.
#[tauri::command]
pub async fn list_accounts(
    state: tauri::State<'_, MatrixState>,
) -> Result<Vec<Account>, String> {
    let guard = state.client.read().await;
    let client = guard.as_ref().ok_or("not logged in")?;
    let (_map, accounts) = account_map(client).await;
    Ok(accounts)
}

/// Best-effort preview: the most recent text message in a room, if any.
/// NOTE: this does a per-room history fetch, so it is O(rooms) network calls —
/// fine for a local server, but Simplified Sliding Sync is the real fix.
async fn latest_message(room: &matrix_sdk::Room) -> Option<(String, f64)> {
    use matrix_sdk::room::MessagesOptions;
    use matrix_sdk::ruma::events::{
        room::message::MessageType, AnySyncMessageLikeEvent, AnySyncTimelineEvent,
    };
    let mut opts = MessagesOptions::backward();
    opts.limit = 10u32.into();
    let chunk = room.messages(opts).await.ok()?.chunk;
    // `backward` yields newest-first, so the first text we hit is the latest.
    for ev in chunk {
        if let Ok(AnySyncTimelineEvent::MessageLike(AnySyncMessageLikeEvent::RoomMessage(msg))) =
            ev.raw().deserialize()
        {
            if let Some(original) = msg.as_original() {
                // Text-like types (text/notice/emote) — so bot/bridge notices
                // also surface as the room's last-message preview.
                let body = match &original.content.msgtype {
                    MessageType::Text(t) => Some(t.body.clone()),
                    MessageType::Notice(n) => Some(n.body.clone()),
                    MessageType::Emote(e) => Some(e.body.clone()),
                    _ => None,
                };
                if let Some(body) = body {
                    let ts = u64::from(original.origin_server_ts.0) as f64;
                    return Some((body, ts));
                }
            }
        }
    }
    None
}

/// Log out and drop the client.
#[tauri::command]
pub async fn logout(
    state: tauri::State<'_, MatrixState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    // Drop the saved session so logging out actually persists across restarts.
    if let Ok(dir) = data_dir(&app) {
        let _ = std::fs::remove_file(dir.join("session.json"));
    }
    // Bump the generation so the running sync observer retires itself: it holds an
    // Arc to the service (which keeps its state stream open), so without this it
    // would keep observing — and could try to restart — a service we've stopped.
    state.sync_generation.fetch_add(1, Ordering::SeqCst);
    // Same for the open room's Timeline: retire its diff task and drop the handle,
    // otherwise it lingers against the torn-down client and can emit stale
    // "timeline-items" while the user is back on the login screen.
    state.timeline_generation.fetch_add(1, Ordering::SeqCst);
    *state.open_timeline.write().await = None;
    if let Some(sync) = state.sync_service.write().await.take() {
        let _ = sync.stop().await;
    }
    if let Some(client) = state.client.write().await.take() {
        let _ = client.matrix_auth().logout().await;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Message history — context source for the AI layer (see ai.rs).
//
// The `ai` module reaches messages ONLY through the helper below, never through
// the `Client` directly. That keeps the client encapsulated here and keeps the
// AI layer free of any direct dependency on Matrix internals (see the licensing
// note in ai.rs).
// ---------------------------------------------------------------------------

/// One message line, flattened for the conversation view (reused by the AI layer).
#[derive(Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bindings/")]
pub struct ChatLine {
    pub sender: String,
    /// Resolved display name of the sender. The bridge sets these to the WhatsApp
    /// contact's name; falls back to the mxid localpart when unknown.
    pub sender_name: String,
    pub body: String,
    /// Milliseconds since the Unix epoch (origin_server_ts). f64 so it maps to a
    /// plain TS `number` for `new Date(ts)` — u64 would surface as `bigint`.
    pub ts: f64,
    /// For image messages: an opaque handle (a serialized MediaSource) the UI
    /// passes to `fetch_media` to lazily load the picture. None for text. Lazy so
    /// opening a photo-heavy chat doesn't block on downloading every image at once.
    pub image: Option<String>,
    /// The Matrix event id — the handle for reactions / reply / edit / delete.
    /// None only for local echoes that haven't been accepted by the server yet
    /// (the SDK fills it in once the send succeeds, and the next timeline diff
    /// re-emits this line with the real id).
    pub event_id: Option<String>,
    /// True when this message has been edited (an m.replace landed on it);
    /// `body` already contains the LATEST text.
    pub edited: bool,
    /// Reaction emoji on this message, one entry per reaction (duplicates mean
    /// multiple people used the same emoji — the UI groups and counts them).
    pub reactions: Vec<String>,
    /// True while this is a *local echo* — a message we sent that the SDK has
    /// added to the timeline optimistically but the server has not yet confirmed
    /// (send-state NotSentYet). The UI dims it to signal "sending…". Cleared to
    /// false once the send is confirmed (send-state Sent) and the line re-emits
    /// with its real `event_id`. `false` for everything that came from the server.
    pub pending: bool,
    /// True when this local echo *failed* to send (send-state SendingFailed) —
    /// the SDK keeps it in the timeline so the UI can show a failed marker rather
    /// than silently dropping the user's message. `false` otherwise.
    pub failed: bool,
}

/// Fetch the most recent `limit` text messages from a room, oldest-first - the
/// data behind the conversation view. (The AI layer reuses this same path.)
#[tauri::command]
pub async fn room_messages(
    state: tauri::State<'_, MatrixState>,
    room_id: String,
    limit: u16,
) -> Result<Vec<ChatLine>, String> {
    use matrix_sdk::room::MessagesOptions;
    use matrix_sdk::ruma::events::{
        room::message::MessageType, AnySyncMessageLikeEvent, AnySyncTimelineEvent,
    };
    use matrix_sdk::ruma::RoomId;

    let guard = state.client.read().await;
    let client = guard.as_ref().ok_or("not logged in")?;

    let rid = RoomId::parse(&room_id).map_err(|e| e.to_string())?;
    let room = client.get_room(&rid).ok_or("room not found")?;

    // We can only read history for joined rooms. The bridge leaves WhatsApp
    // portals "invited" until accepted; /messages on those 403s. Return empty so
    // the conversation shows its normal empty state, not an error banner.
    if room.state() != matrix_sdk::RoomState::Joined {
        return Ok(Vec::new());
    }

    let mut opts = MessagesOptions::backward();
    opts.limit = (limit as u32).into();

    let chunk = room.messages(opts).await.map_err(|e| e.to_string())?.chunk;

    // First pass (sync): walk the chunk once, splitting it into
    //   - renderable messages (text-ish + images), keeping their event ids,
    //   - edits (m.replace relations) → map target-event-id -> newest new body,
    //   - reactions (m.reaction) → map target-event-id -> emoji keys.
    // The chunk is newest-first, so for edits the FIRST replacement we see per
    // target is the latest one and wins.
    use matrix_sdk::ruma::events::room::message::Relation;
    use matrix_sdk::ruma::OwnedEventId;

    let mut replacements: std::collections::HashMap<OwnedEventId, String> =
        std::collections::HashMap::new();
    let mut reactions: std::collections::HashMap<OwnedEventId, Vec<String>> =
        std::collections::HashMap::new();
    let mut raw: Vec<(matrix_sdk::ruma::OwnedUserId, String, Option<String>, f64, OwnedEventId)> =
        Vec::new();

    for ev in chunk {
        let Ok(any) = ev.raw().deserialize() else { continue };
        match any {
            AnySyncTimelineEvent::MessageLike(AnySyncMessageLikeEvent::RoomMessage(msg)) => {
                let Some(original) = msg.as_original() else { continue };

                // An edit event: record the replacement text, don't render as a line.
                if let Some(Relation::Replacement(r)) = &original.content.relates_to {
                    let new_body = match &r.new_content.msgtype {
                        MessageType::Text(t) => Some(t.body.clone()),
                        MessageType::Notice(n) => Some(n.body.clone()),
                        MessageType::Emote(e) => Some(e.body.clone()),
                        _ => None,
                    };
                    if let Some(nb) = new_body {
                        replacements.entry(r.event_id.clone()).or_insert(nb);
                    }
                    continue;
                }

                // Text-like types (m.text/m.notice/m.emote) carry `.body`; m.image
                // carries a media source we serialize into an opaque handle the UI
                // lazily resolves via fetch_media. Other types are skipped for now.
                let (body, image) = match &original.content.msgtype {
                    MessageType::Text(t) => (t.body.clone(), None),
                    MessageType::Notice(n) => (n.body.clone(), None),
                    MessageType::Emote(e) => (e.body.clone(), None),
                    MessageType::Image(img) => (
                        if img.body.is_empty() { "[image]".to_string() } else { img.body.clone() },
                        serde_json::to_string(&img.source).ok(),
                    ),
                    // Same labeled-row treatment as the Timeline path.
                    MessageType::Video(v) => (format!("[video] {}", v.body), None),
                    MessageType::Audio(a) => (
                        if a.body.is_empty() { "[voice message]".into() } else { format!("[audio] {}", a.body) },
                        None,
                    ),
                    MessageType::File(f) => (format!("[file] {}", f.body), None),
                    _ => continue,
                };
                raw.push((
                    original.sender.clone(),
                    body,
                    image,
                    u64::from(original.origin_server_ts.0) as f64,
                    original.event_id.clone(),
                ));
            }
            AnySyncTimelineEvent::MessageLike(AnySyncMessageLikeEvent::Reaction(re)) => {
                if let Some(original) = re.as_original() {
                    reactions
                        .entry(original.content.relates_to.event_id.clone())
                        .or_default()
                        .push(original.content.relates_to.key.clone());
                }
            }
            _ => {}
        }
    }

    // Second pass (async): resolve each sender's display name, cached per user.
    let mut names: std::collections::HashMap<matrix_sdk::ruma::OwnedUserId, String> =
        std::collections::HashMap::new();
    let mut lines: Vec<ChatLine> = Vec::with_capacity(raw.len());
    for (sender, body, image, ts, event_id) in raw {
        let sender_name = match names.get(&sender) {
            Some(n) => n.clone(),
            None => {
                let n = match room.get_member(&sender).await {
                    Ok(Some(member)) => member
                        .display_name()
                        .map(|s| s.to_owned())
                        .unwrap_or_else(|| sender.localpart().to_owned()),
                    _ => sender.localpart().to_owned(),
                };
                names.insert(sender.clone(), n.clone());
                n
            }
        };
        // Apply the newest edit, if any, and attach this message's reactions.
        let edited = replacements.contains_key(&event_id);
        let body = replacements.get(&event_id).cloned().unwrap_or(body);
        lines.push(ChatLine {
            sender: sender.to_string(),
            sender_name,
            body,
            ts,
            image,
            edited,
            reactions: reactions.remove(&event_id).unwrap_or_default(),
            event_id: Some(event_id.to_string()),
            // `room_messages` only ever returns server history (a /messages
            // backward-paginate), so none of its lines are un-sent local echoes.
            pending: false,
            failed: false,
        });
    }
    // `backward` gave newest-first; the UI wants oldest-first.
    lines.reverse();
    Ok(lines)
}

/// Send a plain-text message to a room. `reply_to` (an event id) makes it a
/// rich reply to that message.
#[tauri::command]
pub async fn send_message(
    state: tauri::State<'_, MatrixState>,
    app: tauri::AppHandle,
    room_id: String,
    body: String,
    reply_to: Option<String>,
) -> Result<(), String> {
    use matrix_sdk::ruma::events::relation::Reply;
    use matrix_sdk::ruma::events::room::message::{Relation, RoomMessageEventContent};
    use matrix_sdk::ruma::{EventId, RoomId};

    let guard = state.client.read().await;
    let client = guard.as_ref().ok_or("not logged in")?;

    let rid = RoomId::parse(&room_id).map_err(|e| e.to_string())?;
    let room = client.get_room(&rid).ok_or("room not found")?;

    let mut content = RoomMessageEventContent::text_plain(body);
    if let Some(target) = reply_to {
        let eid = EventId::parse(&target).map_err(|e| e.to_string())?;
        content.relates_to = Some(Relation::Reply(Reply::with_event_id(eid)));
    }

    // Routed through `map_matrix_err` so a send that fails on a revoked token fires
    // the re-login flow at once, instead of only surfacing on the next sync tick.
    room.send(content).await.map_err(|e| map_matrix_err(&app, e))?;
    Ok(())
}

/// React to a message with an emoji (an m.reaction annotation).
#[tauri::command]
pub async fn send_reaction(
    state: tauri::State<'_, MatrixState>,
    room_id: String,
    event_id: String,
    key: String,
) -> Result<(), String> {
    use matrix_sdk::ruma::events::reaction::ReactionEventContent;
    use matrix_sdk::ruma::events::relation::Annotation;
    use matrix_sdk::ruma::{EventId, RoomId};

    let guard = state.client.read().await;
    let client = guard.as_ref().ok_or("not logged in")?;

    let rid = RoomId::parse(&room_id).map_err(|e| e.to_string())?;
    let room = client.get_room(&rid).ok_or("room not found")?;
    let eid = EventId::parse(&event_id).map_err(|e| e.to_string())?;

    room.send(ReactionEventContent::new(Annotation::new(eid, key)))
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Edit one of our messages (an m.replace relation). The fallback body gets the
/// conventional "* " prefix for clients that don't render edits natively.
#[tauri::command]
pub async fn edit_message(
    state: tauri::State<'_, MatrixState>,
    room_id: String,
    event_id: String,
    body: String,
) -> Result<(), String> {
    use matrix_sdk::ruma::events::relation::Replacement;
    use matrix_sdk::ruma::events::room::message::{
        Relation, RoomMessageEventContent, RoomMessageEventContentWithoutRelation,
    };
    use matrix_sdk::ruma::{EventId, RoomId};

    let guard = state.client.read().await;
    let client = guard.as_ref().ok_or("not logged in")?;

    let rid = RoomId::parse(&room_id).map_err(|e| e.to_string())?;
    let room = client.get_room(&rid).ok_or("room not found")?;
    let eid = EventId::parse(&event_id).map_err(|e| e.to_string())?;

    let new_content = RoomMessageEventContentWithoutRelation::text_plain(body.clone());
    let mut content = RoomMessageEventContent::text_plain(format!("* {body}"));
    content.relates_to = Some(Relation::Replacement(Replacement::new(eid, new_content)));

    room.send(content).await.map_err(|e| e.to_string())?;
    Ok(())
}

/// Delete (redact) a message.
#[tauri::command]
pub async fn delete_message(
    state: tauri::State<'_, MatrixState>,
    room_id: String,
    event_id: String,
) -> Result<(), String> {
    use matrix_sdk::ruma::{EventId, RoomId};

    let guard = state.client.read().await;
    let client = guard.as_ref().ok_or("not logged in")?;

    let rid = RoomId::parse(&room_id).map_err(|e| e.to_string())?;
    let room = client.get_room(&rid).ok_or("room not found")?;
    let eid = EventId::parse(&event_id).map_err(|e| e.to_string())?;

    room.redact(&eid, None, None).await.map_err(|e| e.to_string())?;
    Ok(())
}

/// Mark a room as read: send a read receipt for its latest event. Clears the
/// unread badge here and shows read ticks on the other side (bridged too).
#[tauri::command]
pub async fn mark_read(
    state: tauri::State<'_, MatrixState>,
    room_id: String,
) -> Result<(), String> {
    use matrix_sdk::room::MessagesOptions;
    use matrix_sdk::ruma::api::client::receipt::create_receipt::v3::ReceiptType;
    use matrix_sdk::ruma::events::receipt::ReceiptThread;
    use matrix_sdk::ruma::RoomId;

    let guard = state.client.read().await;
    let client = guard.as_ref().ok_or("not logged in")?;

    let rid = RoomId::parse(&room_id).map_err(|e| e.to_string())?;
    let room = client.get_room(&rid).ok_or("room not found")?;
    if room.state() != matrix_sdk::RoomState::Joined {
        return Ok(());
    }

    // Latest event in the room = what we've now "read".
    let mut opts = MessagesOptions::backward();
    opts.limit = 1u32.into();
    let chunk = room.messages(opts).await.map_err(|e| e.to_string())?.chunk;
    let Some(latest) = chunk.into_iter().next() else { return Ok(()) };
    let Ok(any) = latest.raw().deserialize() else { return Ok(()) };

    room.send_single_receipt(ReceiptType::Read, ReceiptThread::Unthreaded, any.event_id().to_owned())
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Send (or clear) a typing notification for a room. The SDK rate-limits
/// repeats internally, so the UI can call this on every keystroke.
#[tauri::command]
pub async fn typing(
    state: tauri::State<'_, MatrixState>,
    room_id: String,
    typing: bool,
) -> Result<(), String> {
    use matrix_sdk::ruma::RoomId;

    let guard = state.client.read().await;
    let client = guard.as_ref().ok_or("not logged in")?;

    let rid = RoomId::parse(&room_id).map_err(|e| e.to_string())?;
    let room = client.get_room(&rid).ok_or("room not found")?;
    room.typing_notice(typing).await.map_err(|e| e.to_string())?;
    Ok(())
}

/// Lazily fetch a single room's avatar as a small thumbnail, returned as a
/// `data:` URL ready to drop into an `<img src>`. Returns `None` when the room
/// has no avatar set (most 1:1 WhatsApp DMs have one; some groups don't).
///
/// WHY LAZY: O(1) network per call, invoked per visible row from the frontend —
/// NOT inside list_rooms, which would make room-list load O(rooms) downloads.
/// `avatar()` passes use_cache=true, and the UI caches by room id, so repeats
/// are cheap.
#[tauri::command]
pub async fn room_avatar(
    state: tauri::State<'_, MatrixState>,
    room_id: String,
) -> Result<Option<String>, String> {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    use matrix_sdk::media::{MediaFormat, MediaThumbnailSettings};
    use matrix_sdk::ruma::api::client::media::get_content_thumbnail::v3::Method;
    use matrix_sdk::ruma::{uint, RoomId};

    let guard = state.client.read().await;
    let client = guard.as_ref().ok_or("not logged in")?;

    let rid = RoomId::parse(&room_id).map_err(|e| e.to_string())?;
    let room = client.get_room(&rid).ok_or("room not found")?;

    // Small, cropped, square thumbnail — fine for a 40px list avatar.
    let settings = MediaThumbnailSettings::with_method(Method::Crop, uint!(96), uint!(96));

    // `avatar()` returns Ok(None) on its own when the room has no avatar_url.
    let bytes: Option<Vec<u8>> = room
        .avatar(MediaFormat::Thumbnail(settings))
        .await
        .map_err(|e| e.to_string())?;

    // Browsers content-sniff <img> data regardless of the declared MIME, so a
    // jpeg label works even when the source is PNG/WebP.
    Ok(bytes.map(|b| format!("data:image/jpeg;base64,{}", STANDARD.encode(&b))))
}

/// Fetch a message's media (an image) by the opaque handle carried on a ChatLine
/// (a serialized MediaSource). Full-file fetch, so it also decrypts encrypted
/// media. Returned as a `data:` URL ready to drop into an `<img src>`.
#[tauri::command]
pub async fn fetch_media(
    state: tauri::State<'_, MatrixState>,
    source: String,
) -> Result<String, String> {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    use matrix_sdk::media::{MediaFormat, MediaRequestParameters};
    use matrix_sdk::ruma::events::room::MediaSource;

    let guard = state.client.read().await;
    let client = guard.as_ref().ok_or("not logged in")?;

    let media_source: MediaSource = serde_json::from_str(&source).map_err(|e| e.to_string())?;
    let req = MediaRequestParameters { source: media_source, format: MediaFormat::File };
    let bytes = client
        .media()
        .get_media_content(&req, true)
        .await
        .map_err(|e| e.to_string())?;
    Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(&bytes)))
}

/// Accept a pending invite (or re-join a left room). The mautrix bridge invites
/// us into each WhatsApp portal; the inbox surfaces those as "invited" rows whose
/// Accept action calls this. After it returns, reload the list / open the room.
#[tauri::command]
pub async fn join_room(
    state: tauri::State<'_, MatrixState>,
    room_id: String,
) -> Result<(), String> {
    use matrix_sdk::ruma::RoomId;

    let guard = state.client.read().await;
    let client = guard.as_ref().ok_or("not logged in")?;

    let rid = RoomId::parse(&room_id).map_err(|e| e.to_string())?;
    let room = client.get_room(&rid).ok_or("room not found")?;

    room.join().await.map_err(|e| e.to_string())?;
    Ok(())
}

/// Auto-accept all pending room invites. mautrix invites us into every chat and
/// each account's Space; until accepted they don't sync. Joining them fills the
/// whole inbox (all accounts) without tapping each one. Joins run in the
/// background so this returns immediately; the inbox updates live as they land.
#[tauri::command]
pub async fn accept_all_invites(
    state: tauri::State<'_, MatrixState>,
) -> Result<u32, String> {
    use matrix_sdk::RoomState;

    let guard = state.client.read().await;
    let client = guard.as_ref().ok_or("not logged in")?.clone();
    drop(guard);

    let invited: Vec<matrix_sdk::Room> = client
        .rooms()
        .into_iter()
        .filter(|r| r.state() == RoomState::Invited)
        .collect();
    let count = invited.len() as u32;

    // Join sequentially in the background: non-blocking for the UI and gentle on
    // the homeserver. Each join triggers a sync update, so the inbox fills live.
    tauri::async_runtime::spawn(async move {
        for room in invited {
            let _ = room.join().await;
            // Throttle: a tight burst of joins overwhelms matrix-sdk's event cache
            // (panic: "chunk is not found"). Spacing them out keeps sync stable.
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
    });

    Ok(count)
}

/// Subscribe the open room to sliding sync so its new events stream live. Sliding
/// sync only pushes rooms in the inbox window by default; this tells it to also
/// stream the room you're viewing, so replies (and the refreshing WhatsApp QR)
/// arrive through the normal "rooms-updated" path with no polling timer.
#[tauri::command]
pub async fn subscribe_room(
    state: tauri::State<'_, MatrixState>,
    room_id: String,
) -> Result<(), String> {
    use matrix_sdk::ruma::RoomId;

    let rid = RoomId::parse(&room_id).map_err(|e| e.to_string())?;
    let guard = state.sync_service.read().await;
    let svc = guard.as_ref().ok_or("sync service not running")?;
    svc.room_list_service()
        .subscribe_to_rooms(&[rid.as_ref()])
        .await;
    Ok(())
}

// ===========================================================================
// Live open-room timeline (Session B, risks #2/#4/#6)
//
// WHY A TIMELINE INSTEAD OF `room_messages`
// `room_messages` does a fresh server `/messages` backward-paginate on EVERY
// call. The open conversation used to fire that on open, on a "rooms-updated"
// ping, on a blind 3-second timer, and after every send — brute-forcing
// liveness at the cost of a network round-trip each time, with the sent bubble
// only reconciled by luck of the next refetch.
//
// `matrix_sdk_ui::timeline::Timeline` replaces all of that. It gives us:
//   • an ordered, deduplicated list of the room's messages, kept live by the
//     SDK (edits/reactions/redactions fold into the items they target),
//   • *local echo*: a message we send appears in the items immediately with a
//     send-state, then flips to confirmed with its real event id — no manual
//     optimistic bubble, no transaction-id reconciliation on our side (risk #4),
//   • reads straight from the persistent SDK event cache (risk #6 — see the
//     EventCache note below), so reopening a room paints from disk with no
//     network wait.
//
// We subscribe to the Timeline's diff stream, but because the frontend keeps
// its simple "replace the whole array" model, we don't translate diffs into a
// TS-side protocol: on each (coalesced) diff batch we just re-read the current
// item list, map it to `ChatLine`s, and emit the full list over the
// "timeline-items" Tauri event. Full-list emission costs no network (the items
// are already in memory) and keeps the frontend trivial.
//
// EVENT CACHE (risk #6): nothing to enable here. In matrix-sdk 0.18 the
// persistent event cache is ALREADY active on our existing setup: `.sqlite_store()`
// wires a `SqliteEventCacheStore` into the client, and `SyncService` (via
// `RoomListService::new`) eagerly calls `client.event_cache().subscribe()`. The
// room event cache loads its linked chunks from that SQLite store on init and
// writes updates back to it — so a reopened room renders from disk instantly.
// The Timeline is the read API over that cache; using it is what turns the
// already-persisted cache into a visible cold-start win. No builder flag, no
// experimental feature. See docs/SYNC-HARDENING.md row 6.
// ===========================================================================

/// Map ONE timeline item to a `ChatLine`, or `None` if it isn't a renderable
/// message.
///
/// WHAT WE SKIP (returning None), and why it's safe:
///   • Virtual items — day dividers, the read marker, the timeline-start marker.
///     The existing UI computes day separators and sender grouping itself from
///     the `ChatLine` stream, so re-emitting the SDK's virtual items would just
///     duplicate that. Filtering them out is the minimal change (mirrors how
///     `room_messages` never produced them).
///   • Non-message events — membership/profile/state changes, call events,
///     stickers, polls, redacted/undecryptable placeholders. `ChatLine` only
///     models text/notice/emote/image, exactly what `room_messages` filtered to;
///     mirroring that filtering here keeps rendering identical.
///
/// SEND STATE → `pending` / `failed`: a local echo carries a send-state instead
/// of a server event id. `NotSentYet` ⇒ pending (UI dims it), `SendingFailed`
/// ⇒ failed, `Sent`/remote ⇒ neither. The event id is None until the server
/// confirms; the next diff re-emits the same line with the real id.
async fn timeline_item_to_chatline(
    room: &matrix_sdk::Room,
    item: &matrix_sdk_ui::timeline::TimelineItem,
    name_cache: &mut std::collections::HashMap<matrix_sdk::ruma::OwnedUserId, String>,
) -> Option<ChatLine> {
    use matrix_sdk::ruma::events::room::message::MessageType;
    use matrix_sdk_ui::timeline::EventSendState;

    // Virtual items (day dividers / read marker / timeline start) are not lines.
    let event = item.as_event()?;

    // Only `m.room.message`-shaped content maps to a ChatLine; everything else
    // (state changes, stickers, polls, redactions, UTDs, calls) is skipped, the
    // same set `room_messages` skips.
    let message = event.content().as_message()?;

    // Text-like types carry `.body`; images carry a media source we serialize
    // into the same opaque handle `room_messages` produces, so the existing
    // `fetch_media` / `<MessageImage>` path renders them unchanged.
    let (body, image) = match message.msgtype() {
        MessageType::Text(t) => (t.body.clone(), None),
        MessageType::Notice(n) => (n.body.clone(), None),
        MessageType::Emote(e) => (e.body.clone(), None),
        MessageType::Image(img) => (
            if img.body.is_empty() { "[image]".to_string() } else { img.body.clone() },
            serde_json::to_string(&img.source).ok(),
        ),
        // Other attachments render as labeled rows (no inline preview yet) so
        // they at least EXIST in the conversation instead of being dropped.
        MessageType::Video(v) => (format!("[video] {}", v.body), None),
        MessageType::Audio(a) => (
            if a.body.is_empty() { "[voice message]".into() } else { format!("[audio] {}", a.body) },
            None,
        ),
        MessageType::File(f) => (format!("[file] {}", f.body), None),
        _ => return None,
    };

    // Resolve the sender's display name, cached per user across the batch.
    let sender = event.sender().to_owned();
    let sender_name = match name_cache.get(&sender) {
        Some(n) => n.clone(),
        None => {
            let n = match room.get_member_no_sync(&sender).await {
                Ok(Some(member)) => member
                    .display_name()
                    .map(|s| s.to_owned())
                    .unwrap_or_else(|| sender.localpart().to_owned()),
                _ => sender.localpart().to_owned(),
            };
            name_cache.insert(sender.clone(), n.clone());
            n
        }
    };

    // Reactions: the Timeline aggregates them onto the target item already, keyed
    // emoji → (sender → info). The UI wants a flat `Vec<String>` with one entry
    // per reaction (it groups + counts), so repeat each key once per sender.
    let mut reactions = Vec::new();
    if let Some(by_key) = event.content().reactions() {
        for (key, by_sender) in by_key.iter() {
            for _ in 0..by_sender.len() {
                reactions.push(key.clone());
            }
        }
    }

    // Send-state → pending/failed (local echoes only). Remote events have None.
    let (pending, failed) = match event.send_state() {
        Some(EventSendState::NotSentYet { .. }) => (true, false),
        Some(EventSendState::SendingFailed { .. }) => (false, true),
        _ => (false, false),
    };

    Some(ChatLine {
        sender: sender.to_string(),
        sender_name,
        body,
        // Local echoes have no origin_server_ts yet; fall back to their local
        // creation time so they sort at the bottom (newest) like the user expects.
        ts: event
            .timestamp()
            .to_system_time()
            .and_then(|st| st.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as f64)
            .unwrap_or_else(|| {
                event
                    .local_created_at()
                    .map(|t| u64::from(t.0) as f64)
                    .unwrap_or(0.0)
            }),
        image,
        event_id: event.event_id().map(|e| e.to_string()),
        edited: message.is_edited(),
        reactions,
        pending,
        failed,
    })
}

/// Map the WHOLE current timeline item list to `ChatLine`s (skipping virtual /
/// non-message items). Called for the initial snapshot and after each diff batch.
async fn map_timeline_items(
    room: &matrix_sdk::Room,
    items: &imbl::Vector<Arc<matrix_sdk_ui::timeline::TimelineItem>>,
) -> Vec<ChatLine> {
    let mut name_cache = std::collections::HashMap::new();
    let mut lines = Vec::with_capacity(items.len());
    for item in items.iter() {
        if let Some(line) = timeline_item_to_chatline(room, item, &mut name_cache).await {
            lines.push(line);
        }
    }
    lines
}

/// Open a live Timeline for `room_id` and stream its mapped items to the UI.
///
/// Emits an initial "timeline-items" event with the current (cache-backed) item
/// list, then spawns a task that re-emits the full mapped list on every diff
/// batch — coalescing bursts so a flurry of edits/reactions doesn't spam the
/// webview. Opening a room replaces any previously-open one: the old Timeline is
/// dropped (stopping its SDK tasks) and its diff task retires via the generation
/// guard (see `timeline_generation`).
#[tauri::command]
pub async fn open_room_timeline(
    state: tauri::State<'_, MatrixState>,
    app: tauri::AppHandle,
    room_id: String,
) -> Result<(), String> {
    use matrix_sdk::ruma::RoomId;
    use matrix_sdk_ui::timeline::RoomExt;

    // Serialize opens: see `open_timeline_lock`. Held to the end of this function
    // (the spawned diff task is NOT covered — it doesn't touch the slot).
    let _open_guard = state.open_timeline_lock.lock().await;

    let rid = RoomId::parse(&room_id).map_err(|e| e.to_string())?;

    let guard = state.client.read().await;
    let client = guard.as_ref().ok_or("not logged in")?;
    let room = client.get_room(&rid).ok_or("room not found")?;
    drop(guard);

    // Build the Timeline for this room (reads from the persistent event cache).
    let timeline = Arc::new(room.timeline().await.map_err(|e| e.to_string())?);

    // Claim a new timeline generation and store this as THE open timeline. Bumping
    // the counter first retires any previous room's diff task before we replace
    // the slot; storing the Arc keeps the Timeline (and its SDK tasks) alive.
    let my_gen = state.timeline_generation.fetch_add(1, Ordering::SeqCst) + 1;
    *state.open_timeline.write().await = Some(timeline.clone());

    // Initial snapshot + the diff stream. `subscribe()` returns the current items
    // and a stream of batched diffs (Vec<VectorDiff<_>> per SDK update).
    let (initial_items, mut diff_stream) = timeline.subscribe().await;

    // Emit the initial list right away so the conversation paints from cache.
    let room_for_map = room.clone();
    let lines = map_timeline_items(&room_for_map, &initial_items).await;
    let _ = app.emit(
        "timeline-items",
        serde_json::json!({ "room_id": room_id.clone(), "lines": lines }),
    );

    // Diff-forwarding task: on each diff batch we IGNORE the diff contents and
    // just re-read + re-map the current items, because the frontend replaces its
    // whole array anyway (no TS-side diff protocol). We coalesce a burst for
    // ~150ms so many rapid updates collapse into one emission.
    let generation = state.timeline_generation.clone();
    let timeline_for_task = timeline.clone();
    tauri::async_runtime::spawn(async move {
        use futures_util::StreamExt;
        loop {
            // A different room was opened / the room was closed / logout — retire.
            if generation.load(Ordering::SeqCst) != my_gen {
                break;
            }
            // Wait for the next diff batch (stream end ⇒ Timeline dropped ⇒ done).
            if diff_stream.next().await.is_none() {
                break;
            }
            // Coalesce: drain any further batches that land within the window so a
            // storm of edits/reactions results in a single re-map + emit.
            loop {
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_millis(150)) => break,
                    next = diff_stream.next() => match next {
                        Some(_) => continue,
                        None => break,
                    },
                }
            }
            if generation.load(Ordering::SeqCst) != my_gen {
                break;
            }
            // Re-read the CURRENT items (cheap, in-memory) and emit the full list.
            let items = timeline_for_task.items().await;
            let lines = map_timeline_items(&room_for_map, &items).await;
            let _ = app.emit(
                "timeline-items",
                serde_json::json!({ "room_id": room_id.clone(), "lines": lines }),
            );
        }
    });

    Ok(())
}

/// Close the open room's Timeline (called when the user returns to the inbox).
///
/// Bumps the generation so the diff task retires, then drops the stored Timeline
/// so the SDK stops its per-room background work. Idempotent: closing when
/// nothing is open just no-ops.
#[tauri::command]
pub async fn close_room_timeline(
    state: tauri::State<'_, MatrixState>,
) -> Result<(), String> {
    state.timeline_generation.fetch_add(1, Ordering::SeqCst);
    *state.open_timeline.write().await = None;
    Ok(())
}

/// Load older messages in the open room by paginating the Timeline backwards.
///
/// The Timeline's diff stream fires as the older events prepend, so the open
/// diff task re-emits the (now longer) list — the frontend doesn't need the
/// return value beyond knowing whether we hit the start of the room. Returns
/// true when the start of the timeline has been reached (nothing more to load).
#[tauri::command]
pub async fn paginate_room_timeline(
    state: tauri::State<'_, MatrixState>,
    count: u16,
) -> Result<bool, String> {
    let guard = state.open_timeline.read().await;
    let timeline = guard.as_ref().ok_or("no open timeline")?;
    // `paginate_backwards` returns Ok(true) when it has reached the start of the
    // room (the timeline is fully back-paginated), Ok(false) if more remains.
    let reached_start = timeline
        .paginate_backwards(count)
        .await
        .map_err(|e| e.to_string())?;
    Ok(reached_start)
}

/// Send a plain-text message THROUGH the open Timeline, so the SDK adds it as a
/// local echo immediately (risk #4). The echo appears in the next "timeline-items"
/// emission with `pending: true` and no event id; when the server confirms, the
/// SDK flips its send-state to Sent and the following diff re-emits the line with
/// its real event id and `pending: false`. This is what lets us delete the
/// frontend's manual optimistic-append hack.
///
/// `reply_to` (an event id) makes it a rich reply to that message.
#[tauri::command]
pub async fn send_message_timeline(
    state: tauri::State<'_, MatrixState>,
    app: tauri::AppHandle,
    reply_to: Option<String>,
    body: String,
) -> Result<(), String> {
    use matrix_sdk::ruma::events::room::message::{
        RoomMessageEventContent, RoomMessageEventContentWithoutRelation,
    };
    use matrix_sdk::ruma::EventId;

    // Not currently used for error mapping (see below), but kept in the signature
    // so a future auth-mapping pass can reach the app handle without a breaking
    // change to the command's arguments.
    let _ = &app;

    let guard = state.open_timeline.read().await;
    let timeline = guard.as_ref().ok_or("no open timeline")?;

    // A reply goes through `send_reply` (it builds the m.in_reply_to relation and
    // the reply fallback for us) and takes a relation-less content; a plain
    // message goes through `send` with the full `AnyMessageLikeEventContent`.
    // Both add the local echo to the timeline, so either way the UI sees it now.
    if let Some(target) = reply_to {
        let eid = EventId::parse(&target).map_err(|e| e.to_string())?;
        let content = RoomMessageEventContentWithoutRelation::text_plain(body);
        timeline.send_reply(content, eid).await.map_err(|e| e.to_string())?;
    } else {
        let content = RoomMessageEventContent::text_plain(body);
        timeline.send(content.into()).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

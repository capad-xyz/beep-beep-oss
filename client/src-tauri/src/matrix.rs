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

use std::sync::Arc;
use std::time::Duration;

use matrix_sdk::{authentication::matrix::MatrixSession, ruma::OwnedUserId, store::RoomLoadSettings, Client};
use matrix_sdk_ui::sync_service::SyncService;
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

/// Build + start Simplified Sliding Sync for `client`, and wire its updates to a
/// debounced "rooms-updated" Tauri event so the UI stays live. Returns the
/// SyncService (kept alive in state). Shared by login + restore_session.
async fn start_sync(client: &Client, app: tauri::AppHandle) -> Result<Arc<SyncService>, String> {
    let sync_service = SyncService::builder(client.clone())
        .build()
        .await
        .map_err(|e| e.to_string())?;
    sync_service.start().await;

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

    Ok(Arc::new(sync_service))
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
    let svc = start_sync(&client, app.clone()).await?;
    *state.sync_service.write().await = Some(svc);

    *state.client.write().await = Some(client);
    Ok(user_id.to_string())
}

/// Try to restore a persisted session (stay logged in across restarts). Returns
/// the user id on success, or None when there is no saved session to restore.
#[tauri::command]
pub async fn restore_session(
    state: tauri::State<'_, MatrixState>,
    app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    let dir = data_dir(&app)?;
    let path = dir.join("session.json");
    if !path.exists() {
        return Ok(None);
    }

    let json = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let saved: SavedSession = serde_json::from_str(&json).map_err(|e| e.to_string())?;

    let client = Client::builder()
        .homeserver_url(&saved.homeserver)
        .sqlite_store(dir.join("matrix.db"), None)
        .build()
        .await
        .map_err(|e| e.to_string())?;

    client
        .matrix_auth()
        .restore_session(saved.session, RoomLoadSettings::default())
        .await
        .map_err(|e| e.to_string())?;

    let user_id: OwnedUserId = client.user_id().ok_or("no user id after restore")?.to_owned();

    let svc = start_sync(&client, app.clone()).await?;
    *state.sync_service.write().await = Some(svc);
    *state.client.write().await = Some(client);
    Ok(Some(user_id.to_string()))
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
    /// None only for optimistic echoes that haven't hit the server yet.
    pub event_id: Option<String>,
    /// True when this message has been edited (an m.replace landed on it);
    /// `body` already contains the LATEST text.
    pub edited: bool,
    /// Reaction emoji on this message, one entry per reaction (duplicates mean
    /// multiple people used the same emoji — the UI groups and counts them).
    pub reactions: Vec<String>,
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

    room.send(content).await.map_err(|e| e.to_string())?;
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

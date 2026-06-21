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

use matrix_sdk::{config::SyncSettings, ruma::OwnedUserId, Client};
use serde::{Deserialize, Serialize};
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
    /// Preview of the most recent text message, if any.
    pub last_message: Option<String>,
    /// Timestamp (ms since epoch) of that latest message — drives recency sort
    /// and a relative "2m / 3h / Mon" label in the inbox. f64 → plain TS number.
    pub last_ts: Option<f64>,
}

/// Log in with username + password and start syncing.
///
/// `homeserver` is e.g. `http://localhost:8008` (Phase 0 local) or
/// `https://yourname.duckdns.org` (Oracle path).
#[tauri::command]
pub async fn login(
    state: tauri::State<'_, MatrixState>,
    homeserver: String,
    username: String,
    password: String,
) -> Result<String, String> {
    // Build a client pointed at the homeserver. The `sqlite` feature (see
    // Cargo.toml) persists the session + E2EE keys on disk so restarts are fast.
    let client = Client::builder()
        .homeserver_url(&homeserver)
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

    // Kick off background sync.
    //
    // ⭐ NO-DELAY NOTE: for production this should be driven by `matrix-sdk-ui`'s
    // `SyncService` + `RoomListService`, which use Simplified Sliding Sync — the
    // instant-sync engine that is the entire point of this project. The plain
    // `client.sync()` below is a stand-in just to get the skeleton running;
    // swapping in the sliding-sync services is the first real Phase 1 task.
    let sync_client = client.clone();
    tauri::async_runtime::spawn(async move {
        let _ = sync_client.sync(SyncSettings::default()).await;
    });

    *state.client.write().await = Some(client);
    Ok(user_id.to_string())
}

/// Return the current room list for the UI.
#[tauri::command]
pub async fn list_rooms(
    state: tauri::State<'_, MatrixState>,
) -> Result<Vec<RoomSummary>, String> {
    let guard = state.client.read().await;
    let client = guard.as_ref().ok_or("not logged in")?;

    let mut rooms = Vec::new();
    for room in client.rooms() {
        // Prefer the SDK's computed display name (covers DMs / bridged rooms that
        // carry no m.room.name), falling back to the raw name.
        let name = match room.display_name().await {
            Ok(dn) => Some(dn.to_string()),
            Err(_) => room.name(),
        };
        let (last_message, last_ts) = match latest_message(&room).await {
            Some((body, ts)) => (Some(body), Some(ts)),
            None => (None, None),
        };
        rooms.push(RoomSummary {
            id: room.room_id().to_string(),
            name,
            unread: room.unread_notification_counts().notification_count,
            is_bridged: false,
            last_message,
            last_ts,
        });
    }

    Ok(rooms)
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
                if let MessageType::Text(text) = &original.content.msgtype {
                    let ts = u64::from(original.origin_server_ts.0) as f64;
                    return Some((text.body.clone(), ts));
                }
            }
        }
    }
    None
}

/// Log out and drop the client.
#[tauri::command]
pub async fn logout(state: tauri::State<'_, MatrixState>) -> Result<(), String> {
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

    let mut opts = MessagesOptions::backward();
    opts.limit = (limit as u32).into();

    let chunk = room.messages(opts).await.map_err(|e| e.to_string())?.chunk;

    // First pass (sync): pull (sender, body, ts) for each text message.
    let raw: Vec<(matrix_sdk::ruma::OwnedUserId, String, f64)> = chunk
        .into_iter()
        .filter_map(|ev| {
            let any = ev.raw().deserialize().ok()?;
            if let AnySyncTimelineEvent::MessageLike(AnySyncMessageLikeEvent::RoomMessage(msg)) = any {
                let original = msg.as_original()?;
                if let MessageType::Text(text) = &original.content.msgtype {
                    return Some((
                        original.sender.clone(),
                        text.body.clone(),
                        u64::from(original.origin_server_ts.0) as f64,
                    ));
                }
            }
            None
        })
        .collect();

    // Second pass (async): resolve each sender's display name, cached per user.
    let mut names: std::collections::HashMap<matrix_sdk::ruma::OwnedUserId, String> =
        std::collections::HashMap::new();
    let mut lines: Vec<ChatLine> = Vec::with_capacity(raw.len());
    for (sender, body, ts) in raw {
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
        lines.push(ChatLine {
            sender: sender.to_string(),
            sender_name,
            body,
            ts,
        });
    }
    // `backward` gave newest-first; the UI wants oldest-first.
    lines.reverse();
    Ok(lines)
}

/// Send a plain-text message to a room.
#[tauri::command]
pub async fn send_message(
    state: tauri::State<'_, MatrixState>,
    room_id: String,
    body: String,
) -> Result<(), String> {
    use matrix_sdk::ruma::events::room::message::RoomMessageEventContent;
    use matrix_sdk::ruma::RoomId;

    let guard = state.client.read().await;
    let client = guard.as_ref().ok_or("not logged in")?;

    let rid = RoomId::parse(&room_id).map_err(|e| e.to_string())?;
    let room = client.get_room(&rid).ok_or("room not found")?;

    room.send(RoomMessageEventContent::text_plain(body))
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

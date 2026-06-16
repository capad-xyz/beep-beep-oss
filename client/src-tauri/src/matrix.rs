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
#[ts(export, export_to = "../src/bindings/")]
pub struct RoomSummary {
    pub id: String,
    pub name: Option<String>,
    pub unread: u64,
    /// Whether this room is a bridged chat. Placeholder for now; a real
    /// implementation inspects room state for the bridge's marker events.
    pub is_bridged: bool,
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

    let rooms = client
        .rooms()
        .into_iter()
        .map(|room| RoomSummary {
            id: room.room_id().to_string(),
            name: room.name(), // VERIFY: returns Option<String> in current SDK
            // VERIFY: real unread count via room.unread_notification_counts();
            // left as 0 here to keep the skeleton compiling without guessing.
            unread: 0,
            is_bridged: false,
        })
        .collect();

    Ok(rooms)
}

/// Log out and drop the client.
#[tauri::command]
pub async fn logout(state: tauri::State<'_, MatrixState>) -> Result<(), String> {
    if let Some(client) = state.client.write().await.take() {
        let _ = client.matrix_auth().logout().await;
    }
    Ok(())
}

//! Application wiring.
//!
//! This file does three things:
//!   1. Holds shared, thread-safe state (the Matrix client) via `.manage(...)`.
//!   2. Registers the command surface the React frontend may call via `invoke()`.
//!   3. Boots the Tauri runtime.
//!
//! The `#[cfg_attr(mobile, ...)]` attribute is what lets this same entry point
//! serve desktop AND mobile builds — the single-codebase property that made us
//! pick Tauri over Electron.

#![recursion_limit = "512"]
// ^ matrix-sdk's instrumented `sync()` future is deeply nested; proving it
//   `Send` for `tauri::async_runtime::spawn` overflows the default (128) limit.

// TEMP(ai): re-enable with AI
// mod ai;
mod matrix;

use matrix::MatrixState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Desktop notifications (fired from matrix.rs on incoming messages).
        .plugin(tauri_plugin_notification::init())
        // The window can open minimized if focus shifts during a (long) dev
        // build — force it visible + focused on startup so it never gets lost.
        .setup(|app| {
            use tauri::Manager;
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
            }
            Ok(())
        })
        // Shared holder for the logged-in Matrix client (see matrix.rs).
        .manage(MatrixState::default())
        // TEMP(ai): re-enable with AI
        // Brain layer: provider-agnostic AI (AMD / Qwen Cloud / bring-your-own).
        // .manage(ai::AiState::default())
        // The Rust <-> TS boundary: every command the UI can invoke.
        .invoke_handler(tauri::generate_handler![
            matrix::login,
            matrix::restore_session,
            matrix::list_rooms,
            matrix::list_accounts,
            matrix::logout,
            matrix::room_messages,
            matrix::send_message,
            matrix::room_avatar,
            matrix::fetch_media,
            matrix::join_room,
            matrix::accept_all_invites,
            matrix::subscribe_room,
            matrix::set_pinned,
            matrix::set_archived,
            matrix::set_muted,
            matrix::send_media,
            matrix::search_messages,
            matrix::send_reaction,
            matrix::edit_message,
            matrix::delete_message,
            matrix::mark_read,
            matrix::typing,
            // Live open-room Timeline (SDK local echo + event cache).
            matrix::open_room_timeline,
            matrix::close_room_timeline,
            matrix::paginate_room_timeline,
            matrix::send_message_timeline,
            // TEMP(ai): re-enable with AI
            // ai::ai_set_provider,
            // ai::ai_active_provider,
            // ai::ai_summarize_room,
            // ai::ai_ask,
        ])
        .run(tauri::generate_context!())
        .expect("error while running beep-beep");
}

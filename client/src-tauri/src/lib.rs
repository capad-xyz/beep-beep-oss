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
        // Shared holder for the logged-in Matrix client (see matrix.rs).
        .manage(MatrixState::default())
        // TEMP(ai): re-enable with AI
        // Brain layer: provider-agnostic AI (AMD / Qwen Cloud / bring-your-own).
        // .manage(ai::AiState::default())
        // The Rust <-> TS boundary: every command the UI can invoke.
        .invoke_handler(tauri::generate_handler![
            matrix::login,
            matrix::list_rooms,
            matrix::logout,
            matrix::room_messages,
            matrix::send_message,
            // TEMP(ai): re-enable with AI
            // ai::ai_set_provider,
            // ai::ai_active_provider,
            // ai::ai_summarize_room,
            // ai::ai_ask,
        ])
        .run(tauri::generate_context!())
        .expect("error while running beep-beep");
}

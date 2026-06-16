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

mod matrix;

use matrix::MatrixState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Shared holder for the logged-in Matrix client (see matrix.rs).
        .manage(MatrixState::default())
        // The Rust <-> TS boundary: every command the UI can invoke.
        .invoke_handler(tauri::generate_handler![
            matrix::login,
            matrix::list_rooms,
            matrix::logout,
        ])
        .run(tauri::generate_context!())
        .expect("error while running beep-beep");
}

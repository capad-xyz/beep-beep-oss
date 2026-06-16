// Tauri desktop/mobile entry point.
//
// Deliberately tiny: all real logic lives in lib.rs so the mobile targets
// (iOS/Android) can share the exact same code. `cargo tauri` calls into `run()`.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    beep_beep_lib::run();
}

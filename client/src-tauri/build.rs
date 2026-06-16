// Tauri's build script: generates the context (config, icons, capabilities)
// that `tauri::generate_context!()` consumes at compile time.
fn main() {
    tauri_build::build();
}

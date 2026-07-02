import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev-server port and that Vite doesn't clear the screen
// (so Tauri's own CLI output stays visible).
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // Never watch the Rust project or its build output: on Windows the linker
      // locks target/*.pdb mid-build, which crashes Vite's fs watcher (EBUSY).
      ignored: ["**/src-tauri/**"],
    },
  },
});

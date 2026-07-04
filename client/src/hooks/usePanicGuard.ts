import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

// Watches the Rust panic guard's "rust-panic" events. A cache-class panic
// (matrix-sdk #5416, linked_chunk) poisons the persisted event cache: sync
// self-heals and the room list keeps updating, but OPEN conversation timelines
// silently freeze. The guard has already scheduled an event-cache wipe for the
// next launch — so a restart fully recovers. This hook flips a `degraded` flag
// the shell surfaces as a restart banner, turning a silent breakage into a
// visible, one-click fix.
export function usePanicGuard(): boolean {
  const [degraded, setDegraded] = useState(false);
  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    listen<{ cache_class: boolean }>("rust-panic", (e) => {
      if (alive && e.payload.cache_class) setDegraded(true);
    }).then((fn) => {
      if (alive) unlisten = fn;
      else fn();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);
  return degraded;
}

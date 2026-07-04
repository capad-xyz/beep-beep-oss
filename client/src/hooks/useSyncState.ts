import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

// Health of the sliding-sync engine, from the Rust "sync-state" event. Attached
// once for the app's lifetime (not gated on login) so a state change during the
// initial post-login sync is never missed. null = running/healthy.
export function useSyncState(): string | null {
  const [syncState, setSyncState] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    listen<string>("sync-state", (e) => {
      setSyncState(e.payload === "running" ? null : e.payload);
    }).then((fn) => {
      if (alive) unlisten = fn;
      else fn();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);
  return syncState;
}

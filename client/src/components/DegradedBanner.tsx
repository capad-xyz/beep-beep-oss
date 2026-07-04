import { useState } from "react";
import { restartApp } from "@/api";

// Shown after a cache-class panic (matrix-sdk #5416): the event cache is
// poisoned, so open conversations may be frozen on stale content even though
// the inbox keeps updating. A restart applies the guard's scheduled cache wipe
// and recovers cleanly. Full-width, under the sync banner — deliberately
// prominent because the failure it covers is otherwise silent.
export function DegradedBanner() {
  const [restarting, setRestarting] = useState(false);
  return (
    <div className="flex h-9 flex-none items-center justify-center gap-3 border-b border-warn bg-warn px-4 text-white">
      <span className="micro">
        A sync glitch may be freezing open conversations — restart to refresh
      </span>
      <button
        type="button"
        disabled={restarting}
        onClick={() => {
          setRestarting(true);
          restartApp().catch(() => setRestarting(false));
        }}
        className="micro rounded-full bg-white/20 px-3 py-0.5 font-semibold transition-colors hover:bg-white/30 disabled:opacity-60"
      >
        {restarting ? "Restarting…" : "Restart"}
      </button>
    </div>
  );
}

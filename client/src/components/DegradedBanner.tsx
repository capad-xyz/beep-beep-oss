import { useState } from "react";
import { restartApp } from "@/api";
import { Icon } from "@/components/Icon";

// Shown after a cache-class panic (matrix-sdk #5416): the event cache is
// poisoned, so open conversations may be frozen on stale content even though
// the inbox keeps updating. A restart applies the guard's scheduled cache wipe
// and recovers cleanly.
//
// Deliberately NON-demanding: it's a dismissible heads-up, not a modal "you
// must restart now". Composer drafts are persisted per-room (see lib/drafts),
// so restarting never loses what you were typing — the whole reason the old
// restart-prompt was bad UX.
export function DegradedBanner() {
  const [restarting, setRestarting] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="flex h-9 flex-none items-center justify-center gap-3 border-b border-warn/60 bg-warn/15 px-4 text-[#8a5f1d]">
      <span className="micro">
        Some conversations may be out of date — refresh when you're ready
      </span>
      <button
        type="button"
        disabled={restarting}
        title="Your drafts are saved and will survive the restart"
        onClick={() => {
          setRestarting(true);
          restartApp().catch(() => setRestarting(false));
        }}
        className="micro rounded-full bg-warn/25 px-3 py-0.5 font-semibold transition-colors hover:bg-warn/40 disabled:opacity-60"
      >
        {restarting ? "Refreshing…" : "Refresh now"}
      </button>
      <button
        type="button"
        title="Dismiss"
        onClick={() => setDismissed(true)}
        className="flex h-5 w-5 items-center justify-center rounded-full text-[#8a5f1d]/70 hover:bg-warn/25 hover:text-[#8a5f1d]"
      >
        <Icon name="close" size={13} />
      </button>
    </div>
  );
}

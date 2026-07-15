import { useEffect, useState } from "react";

// Prominent full-width sync-health banner, directly under the titlebar.
// `state` is the raw "sync-state" payload (null when running = hidden).
// "terminated" and "reconnecting" both read as actively recovering.
//
// DEBOUNCED: sliding sync flaps running↔offline for a beat around server
// restarts and network blips; showing every blip strobes the banner. An
// unhealthy state must persist SHOW_DELAY_MS before the banner appears —
// recovery still hides it instantly (good news needs no debounce).
const SHOW_DELAY_MS = 1500;

export function SyncBanner({ state }: { state: string | null }) {
  const [shown, setShown] = useState<string | null>(null);

  useEffect(() => {
    if (!state) {
      setShown(null); // healthy → hide immediately
      return;
    }
    if (shown) {
      setShown(state); // already visible → track the label without delay
      return;
    }
    const t = setTimeout(() => setShown(state), SHOW_DELAY_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `shown` guards entry only
  }, [state]);

  if (!shown) return null;
  const offline = shown === "offline";
  return (
    <div
      className={
        "micro relative flex h-8 flex-none items-center justify-center gap-2 overflow-hidden border-b text-white backdrop-blur-md " +
        (offline ? "bg-danger/90 border-danger/60" : "bg-warn/90 border-warn/60")
      }
    >
      <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/20 to-transparent" />
      {!offline && (
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-white/40 border-t-white" />
      )}
      {offline ? "Offline — will reconnect when the network returns" : "Reconnecting…"}
    </div>
  );
}

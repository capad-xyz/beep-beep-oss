// Prominent full-width sync-health banner, directly under the titlebar.
// `state` is the raw "sync-state" payload (null when running = hidden).
// "terminated" and "reconnecting" both read as actively recovering.
export function SyncBanner({ state }: { state: string | null }) {
  if (!state) return null;
  const offline = state === "offline";
  return (
    <div
      className={
        "micro flex h-8 flex-none items-center justify-center gap-2 border-b text-white " +
        (offline ? "bg-danger border-danger" : "bg-warn border-warn")
      }
    >
      {!offline && (
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-white/40 border-t-white" />
      )}
      {offline ? "Offline — will reconnect when the network returns" : "Reconnecting…"}
    </div>
  );
}

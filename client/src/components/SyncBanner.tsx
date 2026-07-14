// Prominent full-width sync-health banner, directly under the titlebar.
// `state` is the raw "sync-state" payload (null when running = hidden).
// "terminated" and "reconnecting" both read as actively recovering.
export function SyncBanner({ state }: { state: string | null }) {
  if (!state) return null;
  const offline = state === "offline";
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

import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { ChatLine } from "@/bindings/ChatLine";
import { whatsappStartLogin, openRoomTimeline, closeRoomTimeline, subscribeRoom } from "@/api";
import { MessageImage } from "@/components/conversation/MessageImage";
import { Icon } from "@/components/Icon";

// WhatsApp QR-link panel — onboarding step 2 AND "add another account" from
// Settings. The bridge has no dedicated QR API: you message the bridge bot
// "login qr" and the QR arrives (and refreshes) as image messages in the bot
// DM. Crucially, the bot room is resolved SAFELY on the backend
// (`whatsapp_start_login`): by the bot's deterministic mxid, with a hard
// assertion that the room contains no one but you and the bot before anything
// is sent. The old client-side fuzzy name-matching once sprayed "login qr"
// into real contact chats — that path is gone for good.
export function LinkWhatsApp({
  accountCount,
  onDone,
}: {
  accountCount: number; // number of linked WhatsApp accounts (live)
  onDone: () => void;
}) {
  // "Done" = a NEW account appeared since we opened this panel. Works for both
  // the first link (baseline 0 → 1) and adding a second (1 → 2).
  const baseline = useRef(accountCount);
  const done = accountCount > baseline.current;

  const [lines, setLines] = useState<ChatLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"starting" | "waiting">("starting");
  const [attempt, setAttempt] = useState(0); // bump to retry

  // Kick off the login once per attempt, then stream the bot DM's timeline to
  // catch the QR image. The backend guarantees the target is a bot-only DM.
  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    setPhase("starting");
    setError(null);

    (async () => {
      try {
        const roomId = await whatsappStartLogin(); // backend picks + verifies the bot DM
        if (!alive) return;
        setPhase("waiting");
        subscribeRoom(roomId).catch(() => {});
        listen<{ room_id: string; lines: ChatLine[] }>("timeline-items", (e) => {
          if (!alive || e.payload.room_id !== roomId) return;
          setLines(e.payload.lines);
        }).then((fn) => {
          if (alive) unlisten = fn;
          else fn();
        });
        const initial = await openRoomTimeline(roomId);
        if (alive) setLines((cur) => (cur.length > 0 ? cur : initial));
      } catch (err) {
        if (alive) setError(String(err));
      }
    })();

    return () => {
      alive = false;
      unlisten?.();
      closeRoomTimeline().catch(() => {});
    };
  }, [attempt]);

  // Freshest QR image + the bot's latest status line. The bridge reposts the QR
  // as it expires, so always render the LAST image in the timeline.
  const lastImage = [...lines].reverse().find((l) => l.image);
  const lastText = [...lines].reverse().find((l) => !l.image && l.body && l.sender !== "");

  if (done) {
    return (
      <div className="flex flex-col items-center gap-4">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success/10 text-success">
          <Icon name="check" size={26} strokeWidth={2.4} />
        </span>
        <div className="text-center">
          <div className="text-[15px] font-semibold">WhatsApp linked</div>
          <div className="mt-1 text-[13px] text-mut">
            Importing your chats and history — this can take a minute.
          </div>
        </div>
        <button
          type="button"
          onClick={onDone}
          className="rounded-full bg-oxblood px-6 py-2.5 text-sm font-semibold text-white shadow-sh1 hover:opacity-90"
        >
          Open your inbox
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex h-[264px] w-[264px] items-center justify-center overflow-hidden rounded-lg border border-border bg-white p-2 shadow-sh1">
        {lastImage?.image ? (
          <MessageImage source={lastImage.image} alt="WhatsApp login QR" />
        ) : error ? (
          <div className="flex flex-col items-center gap-2 px-4 text-center">
            <Icon name="alert" size={22} className="text-danger" />
            <span className="text-[12px] text-danger">Couldn't reach the bridge</span>
          </div>
        ) : (
          <span className="micro text-mut">
            {phase === "starting" ? "Contacting bridge…" : "Waiting for QR…"}
          </span>
        )}
      </div>
      <div className="max-w-[380px] text-center text-[13px] leading-relaxed text-mut">
        On your phone: WhatsApp → Settings → <b>Linked devices</b> → <b>Link a device</b>,
        then scan this code. It refreshes automatically.
      </div>
      {lastText && (
        <div className="max-w-[380px] truncate text-center font-mono text-[11px] text-faint">
          {lastText.body}
        </div>
      )}
      {error && (
        <div className="max-w-[380px] text-center text-[13px] text-danger">
          {error}{" "}
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className="underline">
            Retry
          </button>
        </div>
      )}
      <button type="button" onClick={onDone} className="micro-sm text-mut hover:text-ink">
        Skip for now
      </button>
    </div>
  );
}

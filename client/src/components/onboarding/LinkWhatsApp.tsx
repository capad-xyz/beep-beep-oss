import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { RoomSummary } from "@/bindings/RoomSummary";
import type { ChatLine } from "@/bindings/ChatLine";
import { openRoomTimeline, closeRoomTimeline, sendMessage, subscribeRoom, joinRoom } from "@/api";
import { displayName } from "@/lib/format";
import { MessageImage } from "@/components/conversation/MessageImage";
import { Icon } from "@/components/Icon";

// WhatsApp QR-link panel, used as onboarding step 2 and from Settings' "Add
// another network". The mautrix bridge has no dedicated QR API: you message the
// bridge-bot room "login qr" and the QR arrives (and refreshes) as image
// messages in that room's timeline. We drive the room's SDK Timeline directly —
// callers must make sure no other conversation Timeline is open (it's a single
// global slot on the backend).
export function findBridgeBotRoom(rooms: RoomSummary[]): RoomSummary | undefined {
  return (
    rooms.find((r) => displayName(r) === "WhatsApp bridge bot") ??
    rooms.find((r) => /whatsapp.*(bridge|bot)/i.test(displayName(r)))
  );
}

export function LinkWhatsApp({
  rooms,
  linked,
  onDone,
}: {
  rooms: RoomSummary[];
  linked: boolean; // flips true when a WhatsApp account shows up in "accounts"
  onDone: () => void;
}) {
  const botRoom = useMemo(() => findBridgeBotRoom(rooms), [rooms]);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const startedFor = useRef<string | null>(null);

  // Open the bot room's timeline and kick off the QR login once per room.
  useEffect(() => {
    if (!botRoom || startedFor.current === botRoom.id) return;
    startedFor.current = botRoom.id;
    let alive = true;
    let unlisten: (() => void) | undefined;
    setStarting(true);

    (async () => {
      try {
        if (botRoom.membership === "invited") await joinRoom(botRoom.id);
        subscribeRoom(botRoom.id).catch(() => {});
        listen<{ room_id: string; lines: ChatLine[] }>("timeline-items", (e) => {
          if (!alive || e.payload.room_id !== botRoom.id) return;
          setLines(e.payload.lines);
        }).then((fn) => {
          if (alive) unlisten = fn;
          else fn();
        });
        const initial = await openRoomTimeline(botRoom.id);
        if (alive) setLines((cur) => (cur.length > 0 ? cur : initial));
        await sendMessage(botRoom.id, "login qr");
      } catch (err) {
        if (alive) setError(String(err));
      } finally {
        if (alive) setStarting(false);
      }
    })();

    return () => {
      alive = false;
      unlisten?.();
      closeRoomTimeline().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botRoom?.id]);

  // The freshest QR image + the bot's latest status line. The bridge reposts
  // the QR as it expires, so always render the LAST image in the timeline.
  const lastImage = [...lines].reverse().find((l) => l.image);
  const lastText = [...lines].reverse().find((l) => !l.image && l.body && l.sender !== "");

  return (
    <div className="flex flex-col items-center gap-4">
      {linked ? (
        <>
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success/10 text-success">
            <Icon name="check" size={26} strokeWidth={2.4} />
          </span>
          <div className="text-center">
            <div className="text-[15px] font-semibold">WhatsApp linked</div>
            <div className="mt-1 text-[13px] text-mut">Your chats are syncing in.</div>
          </div>
          <button
            type="button"
            onClick={onDone}
            className="rounded-full bg-oxblood px-6 py-2.5 text-sm font-semibold text-white shadow-sh1 hover:opacity-90"
          >
            Open your inbox
          </button>
        </>
      ) : !botRoom ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <span className="micro text-mut">Waiting for the bridge…</span>
          <span className="max-w-[360px] text-[13px] text-faint">
            The WhatsApp bridge-bot chat hasn't synced in yet. It appears automatically —
            this usually takes a few seconds after first sign-in.
          </span>
        </div>
      ) : (
        <>
          <div className="flex h-[264px] w-[264px] items-center justify-center overflow-hidden rounded-lg border border-border bg-white p-2 shadow-sh1">
            {lastImage?.image ? (
              <MessageImage source={lastImage.image} alt="WhatsApp login QR" />
            ) : (
              <span className="micro text-mut">
                {starting ? "Requesting QR…" : "Waiting for QR…"}
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
            <div className="max-w-[380px] text-center text-[13px] text-danger">{error}</div>
          )}
          <button type="button" onClick={onDone} className="micro-sm text-mut hover:text-ink">
            Skip for now
          </button>
        </>
      )}
    </div>
  );
}

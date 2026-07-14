import { useMemo, useState } from "react";
import type { RoomSummary } from "@/bindings/RoomSummary";
import { displayName } from "@/lib/format";
import { Icon } from "@/components/Icon";
import { RoomAvatar } from "@/components/chats/RoomAvatar";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

type NetFilter = "all" | "whatsapp" | "matrix";

// "New chat" modal (Dispatch spec): search + network chips + recent people.
// True new-chat creation has no backend API yet, so this is a fast-open
// switcher over existing conversations — selecting a row opens that room.
export function NewChatModal({
  open,
  onOpenChange,
  rooms,
  onOpenRoom,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rooms: RoomSummary[];
  onOpenRoom: (r: RoomSummary) => void;
}) {
  const [query, setQuery] = useState("");
  const [net, setNet] = useState<NetFilter>("all");

  const people = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rooms
      .filter((r) => !r.archived)
      .filter((r) => (net === "whatsapp" ? r.is_bridged : net === "matrix" ? !r.is_bridged : true))
      .filter((r) => !q || displayName(r).toLowerCase().includes(q))
      .sort((a, b) => (b.last_ts ?? 0) - (a.last_ts ?? 0))
      .slice(0, 30);
  }, [rooms, query, net]);

  const chip = (on: boolean) =>
    "micro flex items-center gap-1.5 rounded-full px-[11px] py-1.5 transition-colors " +
    (on ? "bg-ink text-white" : "border border-border bg-elevated text-mut hover:text-ink");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Height must never exceed the viewport: on a short window a fixed
          660px pushed the header (and its close button) off-screen. */}
      <DialogContent className="flex max-h-[min(660px,85vh)] w-[min(520px,92vw)] flex-col gap-0 overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-border px-6 pb-4 pt-5">
          <DialogTitle className="text-lg font-semibold">New chat</DialogTitle>
        </div>
        <div className="px-6 pb-3 pt-4">
          <div className="flex items-center gap-2 rounded-md border border-border bg-panel px-3.5 py-[11px]">
            <span className="flex text-faint">
              <Icon name="search" size={16} />
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name"
              autoFocus
              className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
            />
          </div>
        </div>
        <div className="flex gap-2 px-6 pb-4">
          <button type="button" className={chip(net === "all")} onClick={() => setNet("all")}>
            <span className="h-[7px] w-[7px] rounded-full bg-current opacity-70" /> All
          </button>
          <button type="button" className={chip(net === "whatsapp")} onClick={() => setNet("whatsapp")}>
            <span className="h-[7px] w-[7px] rounded-full bg-net-whatsapp" /> WhatsApp
          </button>
          <button type="button" className={chip(net === "matrix")} onClick={() => setNet("matrix")}>
            <span className="h-[7px] w-[7px] rounded-full bg-[#0dbd8b]" /> Matrix
          </button>
        </div>
        <div className="micro-sm px-6 pb-1.5 pt-1 text-mut">Recent</div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {people.length === 0 && (
            <p className="px-3 py-8 text-center text-[13px] text-mut">
              {query ? `No chats match "${query.trim()}".` : "No chats yet."}
            </p>
          )}
          {people.map((r) => {
            const label = displayName(r);
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  onOpenRoom(r);
                }}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-panel"
              >
                <RoomAvatar id={r.id} label={label} size={42} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{label}</span>
                  <span className="block truncate text-xs text-mut">{r.last_message ?? " "}</span>
                </span>
                <span
                  className={
                    "micro-sm flex-none rounded-full border border-border px-2 py-1 " +
                    (r.is_bridged ? "text-net-whatsapp" : "text-[#0dbd8b]")
                  }
                >
                  {r.is_bridged ? "WA" : "MX"}
                </span>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

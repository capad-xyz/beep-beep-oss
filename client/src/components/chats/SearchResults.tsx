import type { SearchHit } from "@/bindings/SearchHit";
import type { RoomSummary } from "@/bindings/RoomSummary";
import { relTime } from "@/lib/format";

// Full-text search hits across all chats (server-side), replacing the room
// list while active. Clicking a hit opens its room.
export function SearchResults({
  hits,
  query,
  rooms,
  onOpen,
  onClear,
}: {
  hits: SearchHit[];
  query: string;
  rooms: RoomSummary[];
  onOpen: (r: RoomSummary) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-3">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="micro-sm text-mut">
          {hits.length} message{hits.length === 1 ? "" : "s"} · “{query}”
        </span>
        <button type="button" onClick={onClear} className="micro-sm text-oxblood hover:underline">
          Clear
        </button>
      </div>
      {hits.length === 0 && (
        <p className="px-3 py-6 text-center text-[13px] text-mut">No messages found.</p>
      )}
      {hits.map((h, i) => {
        const room = rooms.find((r) => r.id === h.room_id);
        return (
          <button
            key={i}
            type="button"
            disabled={!room}
            onClick={() => room && onOpen(room)}
            className="flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-left transition-colors hover:bg-elevated disabled:opacity-60"
          >
            <span className="flex items-center gap-2">
              <span className="flex-1 truncate text-[14px] font-semibold">
                {h.room_name ?? h.sender_name}
              </span>
              <span className="font-mono text-[11px] text-faint">{relTime(h.ts)}</span>
            </span>
            <span className="truncate text-[13px] text-mut">
              {h.sender_name}: {h.body}
            </span>
          </button>
        );
      })}
    </div>
  );
}

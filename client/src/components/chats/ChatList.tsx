import { useState } from "react";
import type { RoomSummary } from "@/bindings/RoomSummary";
import type { SearchHit } from "@/bindings/SearchHit";
import type { RoomFilter } from "@/hooks/useRooms";
import { searchMessages } from "@/api";
import { Icon } from "@/components/Icon";
import { RoomRow } from "@/components/chats/RoomRow";
import { SearchResults } from "@/components/chats/SearchResults";
import { displayName } from "@/lib/format";

// 360px conversation-list pane (Dispatch spec): header + search + filter chips
// + rows. Typing filters chats locally; Enter runs the server-side full-text
// search across all chats (results overlay the list).
export function ChatList({
  rooms,
  visibleRooms,
  filter,
  onFilter,
  unreadTotal,
  archivedCount,
  openRoomId,
  onOpen,
  onToggleFlag,
  onCompose,
}: {
  rooms: RoomSummary[];
  visibleRooms: RoomSummary[];
  filter: RoomFilter;
  onFilter: (f: RoomFilter) => void;
  unreadTotal: number;
  archivedCount: number;
  openRoomId: string | null;
  onOpen: (r: RoomSummary) => void;
  onToggleFlag: (r: RoomSummary, kind: "pin" | "mute" | "archive") => void;
  onCompose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? visibleRooms.filter(
        (r) =>
          displayName(r).toLowerCase().includes(q) ||
          (r.last_message ?? "").toLowerCase().includes(q)
      )
    : visibleRooms;

  async function runGlobalSearch() {
    const term = query.trim();
    if (!term) {
      setSearchHits(null);
      return;
    }
    try {
      setSearchError(null);
      setSearchHits(await searchMessages(term, 20));
    } catch (err) {
      setSearchError(String(err));
    }
  }

  const chip = (on: boolean) =>
    "micro rounded-full px-[11px] py-1.5 transition-colors " +
    (on
      ? "bg-ink text-white"
      : "border border-border bg-elevated text-mut hover:text-ink");

  return (
    <div className="flex w-[360px] flex-none flex-col border-r border-border bg-panel min-h-0">
      <div className="flex flex-col gap-4 px-5 pb-4 pt-5">
        <div className="flex items-center justify-between">
          <span className="text-xl font-semibold tracking-[-0.01em]">Chats</span>
          <div className="flex gap-2">
            <button
              type="button"
              title="New chat"
              onClick={onCompose}
              className="flex h-[34px] w-[34px] items-center justify-center rounded-md bg-oxblood text-white shadow-sh1"
            >
              <Icon name="compose" size={17} />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-md border border-border bg-elevated px-3 py-[9px] shadow-sh1">
          <span className="flex text-faint">
            <Icon name="search" size={16} />
          </span>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!e.target.value.trim()) {
                setSearchHits(null);
                setSearchError(null);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") runGlobalSearch();
            }}
            placeholder="Search all networks"
            className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
          />
        </div>
        <div className="flex gap-2">
          <button type="button" className={chip(filter === "all")} onClick={() => onFilter("all")}>
            All
          </button>
          <button type="button" className={chip(filter === "unread")} onClick={() => onFilter("unread")}>
            Unread
            {unreadTotal > 0 && (
              <span className={filter === "unread" ? "ml-1 text-white/80" : "ml-1 text-oxblood"}>
                {unreadTotal}
              </span>
            )}
          </button>
          <button type="button" className={chip(filter === "groups")} onClick={() => onFilter("groups")}>
            Groups
          </button>
          {archivedCount > 0 && (
            <button
              type="button"
              className={chip(filter === "archived")}
              onClick={() => onFilter(filter === "archived" ? "all" : "archived")}
            >
              Archived
            </button>
          )}
        </div>
      </div>

      {searchError && (
        <p className="mx-5 mb-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">
          {searchError}
        </p>
      )}

      {searchHits !== null ? (
        <SearchResults
          hits={searchHits}
          query={query.trim()}
          rooms={rooms}
          onOpen={onOpen}
          onClear={() => setSearchHits(null)}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3">
          {rooms.length === 0 && (
            <p className="px-3 py-6 text-center text-[13px] text-mut">
              No chats yet — sync may still be running.
            </p>
          )}
          {rooms.length > 0 && filtered.length === 0 && (
            <p className="px-3 py-6 text-center text-[13px] text-mut">
              {q ? `No chats match "${query.trim()}".` : "Nothing here."}
            </p>
          )}
          {filtered.map((r) => (
            <RoomRow
              key={r.id}
              room={r}
              active={openRoomId === r.id}
              onOpen={onOpen}
              onToggleFlag={onToggleFlag}
            />
          ))}
        </div>
      )}
    </div>
  );
}

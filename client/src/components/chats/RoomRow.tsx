import type { RoomSummary } from "@/bindings/RoomSummary";
import { displayName, relTime } from "@/lib/format";
import { RoomAvatar } from "@/components/chats/RoomAvatar";
import { Icon } from "@/components/Icon";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger,
} from "@/components/ui/context-menu";

// One conversation row (Dispatch spec): 46px avatar + network dot, name/time,
// preview/unread pill. Pin/mute/archive live in a right-click context menu.
export function RoomRow({
  room,
  active,
  onOpen,
  onToggleFlag,
}: {
  room: RoomSummary;
  active: boolean;
  onOpen: (r: RoomSummary) => void;
  onToggleFlag: (r: RoomSummary, kind: "pin" | "mute" | "archive") => void;
}) {
  const label = displayName(room);
  const joined = room.membership === "joined";
  const unread = Number(room.unread);
  const hasUnread = unread > 0 && !room.muted;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          onClick={() => onOpen(room)}
          className={
            "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors " +
            (active ? "bg-oxblood-tint" : "hover:bg-elevated")
          }
        >
          <span className="relative flex-none">
            <RoomAvatar id={room.id} label={label} />
            {room.is_bridged && (
              <span
                className={
                  "absolute -bottom-px -right-px h-[15px] w-[15px] rounded-full border-[2.5px] bg-net-whatsapp " +
                  (active ? "border-oxblood-tint" : "border-panel")
                }
              />
            )}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <span className="flex items-center gap-2">
              <span
                className={
                  "flex-1 truncate text-[15px] " + (hasUnread ? "font-bold" : "font-medium")
                }
              >
                {room.pinned && (
                  <Icon name="pin" size={12} className="mr-1 inline-block text-faint" />
                )}
                {label}
                {room.muted && (
                  <Icon name="block" size={12} className="ml-1 inline-block text-faint" />
                )}
              </span>
              {joined && room.last_ts != null && (
                <span
                  className={
                    "font-mono text-[11px] " + (hasUnread ? "text-oxblood" : "text-faint")
                  }
                >
                  {relTime(room.last_ts)}
                </span>
              )}
            </span>
            <span className="flex items-center gap-2">
              <span
                className={
                  "flex-1 truncate text-[13px] " +
                  (hasUnread ? "font-medium text-ink-soft" : "text-mut")
                }
              >
                {!joined ? "Tap to accept invite" : room.last_message ?? " "}
              </span>
              {!joined && (
                <span className="micro-sm flex-none rounded-full border border-warn px-1.5 py-px text-warn">
                  invite
                </span>
              )}
              {joined && unread > 0 && (
                <span
                  className={
                    "flex h-[18px] min-w-[18px] flex-none items-center justify-center rounded-full px-[5px] font-mono text-[10px] font-semibold text-white " +
                    (room.muted ? "bg-faint" : "bg-oxblood")
                  }
                >
                  {unread}
                </span>
              )}
            </span>
          </span>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onToggleFlag(room, "pin")}>
          <Icon name="pin" size={15} /> {room.pinned ? "Unpin" : "Pin"}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onToggleFlag(room, "mute")}>
          <Icon name="bell" size={15} /> {room.muted ? "Unmute" : "Mute"}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onToggleFlag(room, "archive")}>
          <Icon name="archive" size={15} /> {room.archived ? "Unarchive" : "Archive"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

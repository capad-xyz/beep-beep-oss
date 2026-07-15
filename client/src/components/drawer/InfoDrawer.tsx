import type { RoomSummary } from "@/bindings/RoomSummary";
import { displayName } from "@/lib/format";
import { Icon } from "@/components/Icon";
import { RoomAvatar } from "@/components/chats/RoomAvatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// 300px info drawer (Dispatch spec), toggled from the conversation header.
// Rows are limited to what the data layer actually supports: mute / pin /
// archive — no fake media counts or presence.
export function InfoDrawer({
  room,
  onClose,
  onToggleFlag,
  overlay,
}: {
  room: RoomSummary;
  onClose: () => void;
  onToggleFlag: (r: RoomSummary, kind: "pin" | "mute" | "archive") => void;
  overlay: boolean; // narrow windows: float over the pane instead of docking
}) {
  const label = displayName(room);

  const rows: {
    icon: React.ComponentProps<typeof Icon>["name"];
    label: string;
    value: string;
    onClick: () => void;
  }[] = [
    {
      icon: "bell",
      label: "Mute notifications",
      value: room.muted ? "On" : "Off",
      onClick: () => onToggleFlag(room, "mute"),
    },
    {
      icon: "pin",
      label: "Pin to top",
      value: room.pinned ? "On" : "Off",
      onClick: () => onToggleFlag(room, "pin"),
    },
    {
      icon: "archive",
      label: room.archived ? "Unarchive" : "Archive",
      value: "",
      onClick: () => onToggleFlag(room, "archive"),
    },
  ];

  return (
    <div
      className={
        "flex w-[300px] flex-none flex-col border-l border-border bg-panel min-h-0 " +
        (overlay ? "absolute inset-y-0 right-0 z-20 shadow-sh3" : "")
      }
    >
      <div className="flex h-16 flex-none items-center gap-2 border-b border-border px-4">
        <span className="flex-1 text-sm font-semibold">
          {room.is_bridged ? "Contact info" : "Room info"}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-md text-mut hover:bg-elevated hover:text-ink"
            >
              <Icon name="close" size={16} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Close</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-6">
        <div className="flex flex-col items-center gap-1.5">
          <RoomAvatar id={room.id} label={label} size={84} />
          <div className="mt-1 text-lg font-semibold">{label}</div>
          <div
            className={
              "micro-sm " + (room.is_bridged ? "text-net-whatsapp" : "text-[#0dbd8b]")
            }
          >
            {room.is_bridged ? "WhatsApp" : "Matrix"}
          </div>
          <div className="max-w-full truncate font-mono text-[10px] text-faint">{room.id}</div>
        </div>

        <div className="overflow-hidden rounded-md border border-border bg-elevated">
          {rows.map((r, i) => (
            <button
              key={r.label}
              type="button"
              onClick={r.onClick}
              className={
                "flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-panel " +
                (i < rows.length - 1 ? "border-b border-border" : "")
              }
            >
              <span className="flex text-mut">
                <Icon name={r.icon} size={17} />
              </span>
              <span className="flex-1 text-sm">{r.label}</span>
              {r.value && <span className="font-mono text-[11px] text-mut">{r.value}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

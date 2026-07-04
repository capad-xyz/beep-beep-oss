import type { RoomSummary } from "@/bindings/RoomSummary";
import type { ChatLine } from "@/bindings/ChatLine";
import { displayName } from "@/lib/format";
import { Icon } from "@/components/Icon";
import { RoomAvatar } from "@/components/chats/RoomAvatar";
import { MessageList } from "@/components/conversation/MessageList";
import { Composer } from "@/components/conversation/Composer";
import { TimelineErrorState } from "@/components/conversation/TimelineErrorState";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// The conversation pane: header (avatar/name/network + actions), the dot-grid
// wallpaper message area, and the composer. With no room open it shows the
// resting empty state.
export function ConversationPane(props: {
  room: RoomSummary | null;
  messages: ChatLine[];
  userId: string;
  loadingMsgs: boolean;
  openError: string | null;
  actionError: string | null;
  onDismissActionError: () => void;
  onRetryOpen: () => void;
  loadingOlder: boolean;
  reachedStart: boolean;
  onLoadOlder: () => void;
  draft: string;
  onDraft: (t: string) => void;
  onSend: () => void;
  replyTo: ChatLine | null;
  editing: ChatLine | null;
  onReply: (m: ChatLine) => void;
  onEdit: (m: ChatLine) => void;
  onCancelContext: () => void;
  onDelete: (m: ChatLine) => void;
  onReact: (m: ChatLine, key: string) => void;
  typingNames: string[];
  uploading: boolean;
  onAttach: (file: File) => void;
  onBack: () => void;      // single-pane (narrow) back affordance
  showBack: boolean;
  onToggleDrawer: () => void;
  drawerOpen: boolean;
}) {
  const { room } = props;

  if (!room) {
    return (
      <div className="wallpaper-dots flex min-w-0 flex-1 flex-col items-center justify-center gap-3">
        <span className="flex h-16 w-16 items-center justify-center rounded-[18px] bg-oxblood text-white shadow-sh2">
          <Icon name="chat" size={30} />
        </span>
        <div className="micro text-mut">Select a conversation</div>
      </div>
    );
  }

  const label = displayName(room);

  return (
    <div className="wallpaper-dots flex min-w-0 flex-1 flex-col">
      {/* header */}
      <div className="flex h-16 flex-none items-center gap-3 border-b border-border bg-panel px-5">
        {props.showBack && (
          <button
            type="button"
            title="Back to chats"
            onClick={props.onBack}
            className="flex h-9 w-9 flex-none items-center justify-center rounded-md text-oxblood hover:bg-oxblood-tint"
          >
            <Icon name="back" size={22} strokeWidth={2.2} />
          </button>
        )}
        <RoomAvatar id={room.id} label={label} size={40} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold">{label}</div>
          <div
            className={
              "micro-sm " + (room.is_bridged ? "text-net-whatsapp" : "text-[#0dbd8b]")
            }
          >
            {room.is_bridged ? "WhatsApp" : "Matrix"}
            {room.muted ? " · muted" : ""}
          </div>
        </div>
        <div className="flex items-center gap-1 text-ink-soft">
          <Tooltip>
            <TooltipTrigger className="flex h-9 w-9 items-center justify-center rounded-md text-faint">
              <Icon name="phone" />
            </TooltipTrigger>
            <TooltipContent>Calls aren't wired up yet</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger className="flex h-9 w-9 items-center justify-center rounded-md text-faint">
              <Icon name="video" />
            </TooltipTrigger>
            <TooltipContent>Calls aren't wired up yet</TooltipContent>
          </Tooltip>
          <button
            type="button"
            title="Conversation info"
            onClick={props.onToggleDrawer}
            className={
              "flex h-9 w-9 items-center justify-center rounded-md transition-colors " +
              (props.drawerOpen ? "bg-oxblood-tint text-oxblood" : "hover:bg-elevated")
            }
          >
            <Icon name="info" />
          </button>
        </div>
      </div>

      {props.actionError && (
        <div className="flex items-center gap-2 border-b border-danger/20 bg-danger/10 px-5 py-2 text-[13px] text-danger">
          <span className="min-w-0 flex-1 truncate">{props.actionError}</span>
          <button type="button" onClick={props.onDismissActionError} className="micro-sm hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {/* body */}
      {props.openError ? (
        <TimelineErrorState detail={props.openError} onRetry={props.onRetryOpen} />
      ) : props.loadingMsgs && props.messages.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <span className="micro text-mut">Loading messages…</span>
        </div>
      ) : props.messages.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2">
          <span className="micro text-mut">No messages yet</span>
          <span className="text-[13px] text-faint">Say hello — messages appear here.</span>
        </div>
      ) : (
        <MessageList
          messages={props.messages}
          userId={props.userId}
          loadingOlder={props.loadingOlder}
          reachedStart={props.reachedStart}
          onLoadOlder={props.onLoadOlder}
          onReply={props.onReply}
          onEdit={props.onEdit}
          onDelete={props.onDelete}
          onReact={props.onReact}
        />
      )}

      <Composer
        draft={props.draft}
        onDraft={props.onDraft}
        onSend={props.onSend}
        replyTo={props.replyTo}
        editing={props.editing}
        onCancelContext={props.onCancelContext}
        typingNames={props.typingNames}
        uploading={props.uploading}
        onAttach={props.onAttach}
      />
    </div>
  );
}

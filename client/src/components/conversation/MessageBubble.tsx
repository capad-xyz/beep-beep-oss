import { useState } from "react";
import type { ChatLine } from "@/bindings/ChatLine";
import { formatTime } from "@/lib/format";
import { Icon } from "@/components/Icon";
import { MessageImage } from "@/components/conversation/MessageImage";

const QUICK_EMOJI = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

// One message bubble (Dispatch spec): incoming = paper white, outgoing = warm
// tint aligned right; inline mono meta (time + delivery state) bottom-right;
// reply-quote block inside the bubble; reactions pill row; hover action bar.
export function MessageBubble({
  m,
  own,
  grouped,
  showSender,
  onReply,
  onEdit,
  onDelete,
  onReact,
}: {
  m: ChatLine;
  own: boolean;
  grouped: boolean;
  showSender: boolean;
  onReply: (m: ChatLine) => void;
  onEdit: (m: ChatLine) => void;
  onDelete: (m: ChatLine) => void;
  onReact: (m: ChatLine, key: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const meta = (
    <span className="ml-1.5 inline-flex flex-none items-center gap-[3px] self-end whitespace-nowrap font-mono text-[10px] text-faint">
      {m.edited && <span>edited ·</span>}
      {m.failed ? (
        <span className="flex items-center gap-0.5 text-danger">
          <Icon name="alert" size={11} strokeWidth={2.2} /> failed
        </span>
      ) : m.pending ? (
        <Icon name="clock" size={11} strokeWidth={2.2} />
      ) : (
        <>
          {formatTime(m.ts)}
          {own &&
            (m.read_by_other ? (
              <span className="ml-0.5 text-oxblood" title="Read">
                <Icon name="checks" size={15} strokeWidth={2} />
              </span>
            ) : (
              <span className="ml-0.5 text-mut" title="Sent">
                <Icon name="check" size={13} strokeWidth={2.2} />
              </span>
            ))}
        </>
      )}
    </span>
  );

  return (
    <div
      className={
        "group relative flex max-w-[62%] flex-col " +
        (own ? "items-end self-end" : "items-start self-start") +
        (grouped ? " mt-[2px]" : " mt-2")
      }
    >
      {showSender && !own && (
        <span className="micro-sm mb-0.5 ml-1 text-mut normal-case tracking-normal">
          {m.sender_name}
        </span>
      )}
      <div
        className={
          "relative flex flex-wrap items-end gap-x-1.5 gap-y-0.5 rounded-lg px-[11px] py-[7px] text-sm leading-[1.4] text-ink shadow-bub " +
          (own
            ? "bg-bubble-out" + (grouped ? "" : " rounded-tr-sm")
            : "bg-bubble-in" + (grouped ? "" : " rounded-tl-sm")) +
          (m.pending ? " opacity-70" : "") +
          (m.failed ? " ring-1 ring-danger/40" : "")
        }
      >
        <span className="flex min-w-0 flex-col gap-1">
          {m.reply_to && (
            <span className="block rounded-sm border-l-[3px] border-oxblood bg-ink/5 px-2.5 py-1.5">
              <span className="block text-[12px] font-semibold leading-tight text-oxblood-ink">
                {m.reply_to.sender_name || "Replied message"}
              </span>
              <span className="block max-w-[280px] truncate text-[13px] text-mut">
                {m.reply_to.body}
              </span>
            </span>
          )}
          {m.image ? (
            <span className="flex flex-col gap-1">
              <MessageImage source={m.image} alt={m.body} />
              {m.body && m.body !== "[image]" && <span>{m.body}</span>}
            </span>
          ) : (
            <span className="whitespace-pre-wrap break-words">{m.body}</span>
          )}
        </span>
        {meta}
      </div>

      {m.reactions.length > 0 && (
        <span className={"z-[1] -mt-2 flex gap-1 " + (own ? "mr-2" : "ml-2")}>
          {m.reactions.map((g) => (
            <button
              key={g.key}
              type="button"
              title={g.senders.join(", ")}
              onClick={() => onReact(m, g.key)}
              className={
                "flex items-center gap-1 rounded-full border px-2 py-px shadow-sh1 transition-colors " +
                (g.reacted_by_me
                  ? "border-oxblood bg-oxblood-tint"
                  : "border-border bg-elevated hover:border-border-strong")
              }
            >
              <span className="text-[12px]">{g.key}</span>
              {g.senders.length > 1 && (
                <span className="font-mono text-[10px] text-mut">{g.senders.length}</span>
              )}
            </button>
          ))}
        </span>
      )}

      {/* Hover actions — only for confirmed (server-acked) messages. */}
      {m.event_id && (
        <div
          className={
            "absolute -top-3 z-[2] hidden items-center gap-0.5 rounded-full border border-border bg-elevated px-1 py-0.5 shadow-sh2 group-hover:flex " +
            (own ? "right-2" : "left-2")
          }
        >
          <BubbleAction title="React" onClick={() => setPickerOpen((v) => !v)}>
            <Icon name="emoji" size={14} />
          </BubbleAction>
          <BubbleAction title="Reply" onClick={() => onReply(m)}>
            <Icon name="back" size={14} />
          </BubbleAction>
          {own && (
            <BubbleAction title="Edit" onClick={() => onEdit(m)}>
              <Icon name="compose" size={14} />
            </BubbleAction>
          )}
          {own && (
            <BubbleAction
              title={confirmDelete ? "Click again to delete" : "Delete"}
              danger={confirmDelete}
              onClick={() => {
                if (confirmDelete) {
                  setConfirmDelete(false);
                  onDelete(m);
                } else {
                  setConfirmDelete(true);
                  setTimeout(() => setConfirmDelete(false), 2500);
                }
              }}
            >
              <Icon name="close" size={14} />
            </BubbleAction>
          )}
        </div>
      )}

      {pickerOpen && m.event_id && (
        <div
          className={
            "absolute -top-12 z-[3] flex gap-0.5 rounded-full border border-border bg-elevated px-1.5 py-1 shadow-sh2 " +
            (own ? "right-2" : "left-2")
          }
        >
          {QUICK_EMOJI.map((k) => (
            <button
              key={k}
              type="button"
              className="rounded-full px-1 text-[15px] transition-transform hover:scale-125"
              onClick={() => {
                setPickerOpen(false);
                onReact(m, k);
              }}
            >
              {k}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BubbleAction({
  title,
  onClick,
  danger,
  children,
}: {
  title: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={
        "flex h-6 w-6 items-center justify-center rounded-full transition-colors " +
        (danger ? "bg-danger text-white" : "text-mut hover:bg-oxblood-tint hover:text-oxblood")
      }
    >
      {children}
    </button>
  );
}

import { Fragment, useEffect, useRef } from "react";
import type { ChatLine } from "@/bindings/ChatLine";
import { formatDay, sameDay } from "@/lib/format";
import { MessageBubble } from "@/components/conversation/MessageBubble";

// The scrolling message area: day pills, sender grouping (consecutive messages
// from one sender within 5 minutes pack tight), load-older at the top, and
// stay-pinned-to-bottom behavior that never yanks you mid-scroll.
export function MessageList({
  messages,
  userId,
  loadingOlder,
  reachedStart,
  onLoadOlder,
  onReply,
  onEdit,
  onDelete,
  onReact,
}: {
  messages: ChatLine[];
  userId: string;
  loadingOlder: boolean;
  reachedStart: boolean;
  onLoadOlder: () => void;
  onReply: (m: ChatLine) => void;
  onEdit: (m: ChatLine) => void;
  onDelete: (m: ChatLine) => void;
  onReact: (m: ChatLine, key: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Keep the conversation pinned to the newest message — but only when the list
  // grows (open / new message), so a live re-fetch doesn't yank you mid-scroll.
  const prevLenRef = useRef(0);
  useEffect(() => {
    if (messages.length > prevLenRef.current) bottomRef.current?.scrollIntoView();
    prevLenRef.current = messages.length;
  }, [messages]);

  // Reaching the top auto-paginates backwards (plus the explicit control).
  function onScroll() {
    const el = scrollRef.current;
    if (el && el.scrollTop < 60 && !loadingOlder && !reachedStart && messages.length > 0) {
      onLoadOlder();
    }
  }

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      // pt clears the pane's floating glass header (h-16) — content scrolls
      // under the frost, which is the whole point of the glass chrome.
      className="flex min-h-0 flex-1 flex-col overflow-y-auto px-8 pb-6 pt-[84px]"
    >
      {messages.length > 0 && (
        <div className="mb-2 self-center">
          {reachedStart ? (
            <span className="micro-sm text-faint">Start of conversation</span>
          ) : (
            <button
              type="button"
              disabled={loadingOlder}
              onClick={onLoadOlder}
              className="micro-sm glass-float rounded-full border border-border/60 px-3 py-1 text-mut transition-colors hover:text-ink disabled:opacity-60"
            >
              {loadingOlder ? "Loading…" : "Load older"}
            </button>
          )}
        </div>
      )}
      {messages.map((m, i) => {
        const own = m.sender === userId;
        const prev = i > 0 ? messages[i - 1] : null;
        const showDay = !prev || !sameDay(prev.ts, m.ts);
        // Group consecutive messages from the same sender within 5 minutes.
        const grouped =
          !!prev && !showDay && prev.sender === m.sender && m.ts - prev.ts < 300_000;
        return (
          <Fragment key={m.event_id ?? `local-${i}`}>
            {showDay && (
              <div className="micro-sm glass-float my-2 self-center rounded-full border border-border/60 px-3 py-1 text-mut">
                {formatDay(m.ts)}
              </div>
            )}
            <MessageBubble
              m={m}
              own={own}
              grouped={grouped}
              showSender={!own && !grouped}
              onReply={onReply}
              onEdit={onEdit}
              onDelete={onDelete}
              onReact={onReact}
            />
          </Fragment>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}

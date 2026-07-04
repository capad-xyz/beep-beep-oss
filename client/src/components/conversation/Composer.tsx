import { useRef } from "react";
import type { ChatLine } from "@/bindings/ChatLine";
import { Icon } from "@/components/Icon";

// Composer bar (Dispatch spec): plus (attach) · pill input · accent send circle.
// The reply/edit context banner and typing line sit directly above it.
export function Composer({
  draft,
  onDraft,
  onSend,
  replyTo,
  editing,
  onCancelContext,
  typingNames,
  uploading,
  onAttach,
}: {
  draft: string;
  onDraft: (text: string) => void;
  onSend: () => void;
  replyTo: ChatLine | null;
  editing: ChatLine | null;
  onCancelContext: () => void;
  typingNames: string[];
  uploading: boolean;
  onAttach: (file: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const context = editing ?? replyTo;

  return (
    <div className="flex-none border-t border-border bg-panel">
      {typingNames.length > 0 && (
        <div className="micro-sm px-5 pt-2 text-mut normal-case tracking-normal">
          {typingNames.join(", ")} {typingNames.length === 1 ? "is" : "are"} typing…
        </div>
      )}
      {context && (
        <div className="mx-5 mt-3 flex items-center gap-3 rounded-md border-l-[3px] border-oxblood bg-oxblood/5 px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-semibold text-oxblood-ink">
              {editing ? "Editing" : `Replying to ${replyTo!.sender_name}`}
            </div>
            <div className="truncate text-[13px] text-mut">{context.body.slice(0, 120)}</div>
          </div>
          <button
            type="button"
            title="Cancel"
            onClick={onCancelContext}
            className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-mut hover:bg-oxblood-tint hover:text-ink"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      <form
        className="flex items-center gap-3 px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
      >
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ""; // allow re-picking the same file
            if (file) onAttach(file);
          }}
        />
        <button
          type="button"
          title="Attach a file"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          className="flex h-10 w-10 flex-none items-center justify-center rounded-md text-mut transition-colors hover:bg-elevated hover:text-ink disabled:opacity-50"
        >
          {uploading ? (
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-[1.5px] border-mut/40 border-t-mut" />
          ) : (
            <Icon name="plus" />
          )}
        </button>
        <div className="flex flex-1 items-center rounded-full border border-border-strong bg-elevated px-4 py-[11px] shadow-sh1">
          <input
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            placeholder={editing ? "Edit message…" : "Type a message…"}
            autoFocus
            className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
          />
          <span className="flex text-faint">
            <Icon name="emoji" size={17} />
          </span>
        </div>
        <button
          type="submit"
          title={editing ? "Save" : "Send"}
          disabled={!draft.trim()}
          className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-oxblood text-white shadow-sh1 transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {editing ? <Icon name="check" size={18} /> : <Icon name="send" size={18} />}
        </button>
      </form>
    </div>
  );
}

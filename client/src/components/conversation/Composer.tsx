import { useRef } from "react";
import type { ChatLine } from "@/bindings/ChatLine";
import { Icon } from "@/components/Icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
    <div className="glass relative z-10 flex-none border-t border-border/60">
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
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Cancel"
                onClick={onCancelContext}
                className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-mut hover:bg-oxblood-tint hover:text-ink"
              >
                <Icon name="close" size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Cancel</TooltipContent>
          </Tooltip>
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
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Attach a file"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="flex h-10 w-10 flex-none items-center justify-center rounded-md text-mut hover:bg-elevated hover:text-ink disabled:opacity-50"
            >
              {uploading ? (
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-[1.5px] border-mut/40 border-t-mut" />
              ) : (
                <Icon name="plus" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>{uploading ? "Uploading…" : "Attach a file"}</TooltipContent>
        </Tooltip>
        <div className="flex flex-1 items-center rounded-full border border-border-strong/70 bg-elevated/75 px-4 py-[11px] shadow-sh1 backdrop-blur-md transition-shadow focus-within:border-oxblood/40 focus-within:shadow-[0_0_0_3px_rgba(143,59,69,0.12)]">
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
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="submit"
              aria-label={editing ? "Save" : "Send"}
              disabled={!draft.trim()}
              className="relative flex h-11 w-11 flex-none items-center justify-center overflow-hidden rounded-full bg-gradient-to-b from-[#a34a55] to-oxblood-ink text-white shadow-sh2 hover:opacity-90 disabled:opacity-40"
            >
              <span className="absolute inset-x-0 top-0 h-1/2 rounded-t-full bg-gradient-to-b from-white/30 to-transparent" />
              {editing ? <Icon name="check" size={18} /> : <Icon name="send" size={18} />}
            </button>
          </TooltipTrigger>
          <TooltipContent>{editing ? "Save changes" : "Send"}</TooltipContent>
        </Tooltip>
      </form>
    </div>
  );
}

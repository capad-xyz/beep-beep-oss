import { Icon } from "@/components/Icon";

// Shown when openRoomTimeline() rejects — the room's timeline couldn't be
// built. Distinct from an empty-but-healthy room.
export function TimelineErrorState({ detail, onRetry }: { detail: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-8">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-danger/10 text-danger">
        <Icon name="alert" size={26} />
      </span>
      <div className="text-center">
        <div className="text-[15px] font-semibold">Couldn't load this conversation</div>
        <div className="mx-auto mt-1 max-w-[420px] break-words font-mono text-[11px] leading-relaxed text-mut">
          {detail}
        </div>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-full bg-oxblood px-5 py-2 text-sm font-semibold text-white shadow-sh1 hover:opacity-90"
      >
        Retry
      </button>
    </div>
  );
}

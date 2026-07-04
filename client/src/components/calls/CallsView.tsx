import { Icon } from "@/components/Icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Calls surface — spec layout, honest stub. There is no calling backend yet, so
// the list shows an empty state and every action is disabled with a tooltip.
export function CallsView() {
  return (
    <div className="flex min-w-0 flex-1">
      {/* calls list */}
      <div className="flex w-[380px] flex-none flex-col border-r border-border bg-panel min-h-0">
        <div className="flex items-center justify-between px-5 pb-4 pt-5">
          <span className="text-xl font-semibold tracking-[-0.01em]">Calls</span>
          <Tooltip>
            <TooltipTrigger className="flex h-[34px] w-[34px] items-center justify-center rounded-md bg-oxblood/40 text-white">
              <Icon name="phonePlus" size={17} />
            </TooltipTrigger>
            <TooltipContent>Calling isn't wired up yet</TooltipContent>
          </Tooltip>
        </div>
        <div className="px-5 pb-4">
          <Tooltip>
            <TooltipTrigger className="flex w-full items-center gap-3 rounded-md border border-border bg-elevated px-4 py-[11px] opacity-60 shadow-sh1">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-oxblood-tint text-oxblood-ink">
                <Icon name="link" size={17} />
              </span>
              <span className="flex-1 text-left">
                <span className="block text-sm font-semibold text-oxblood-ink">Create call link</span>
                <span className="block text-xs text-mut">Share a link for a Dispatch call</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>Calling isn't wired up yet</TooltipContent>
          </Tooltip>
        </div>
        <div className="micro-sm px-5 pb-2 pt-0.5 text-mut">Recent</div>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-8 pb-10">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-elevated text-faint shadow-sh1">
            <Icon name="phone" size={22} />
          </span>
          <span className="text-[13px] font-medium text-mut">No calls yet</span>
          <span className="text-center text-[12px] text-faint">
            Calling isn't wired up — this surface is ready for when it is.
          </span>
        </div>
      </div>
      {/* placeholder detail pane */}
      <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-4 bg-ground p-8">
        <span className="flex h-24 w-24 items-center justify-center rounded-full bg-panel text-faint shadow-sh1">
          <Icon name="video" size={38} />
        </span>
        <div className="text-center">
          <div className="text-lg font-semibold text-mut">Calls land here</div>
          <div className="micro-sm mt-1 text-faint">audio · video · call links</div>
        </div>
      </div>
    </div>
  );
}

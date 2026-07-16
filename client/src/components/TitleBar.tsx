import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Logo } from "@/components/Logo";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Custom titlebar (the window runs with decorations:false). Windows layout:
// glyph + wordmark on the left, drag region everywhere, min / max-restore /
// close on the right. Frosted-glass material with a specular top edge — the
// first line of the app's liquid-glass chrome.

const win = getCurrentWindow();

function ControlButton({
  onClick,
  danger,
  children,
  label,
}: {
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className={
            "flex h-7 w-10 items-center justify-center rounded-md text-mut " +
            (danger
              ? "hover:bg-danger hover:text-white active:bg-danger/90"
              : "hover:bg-ink/8 hover:text-ink")
          }
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const [focused, setFocused] = useState(true);

  useEffect(() => {
    let alive = true;
    win.isMaximized().then((m) => alive && setMaximized(m));
    const unResized = win.onResized(async () => {
      const m = await win.isMaximized();
      if (alive) setMaximized(m);
    });
    // Dim the chrome when the window loses focus — the OS-native cue.
    const unFocus = win.onFocusChanged(({ payload }) => {
      if (alive) setFocused(payload);
    });
    return () => {
      alive = false;
      unResized.then((fn) => fn());
      unFocus.then((fn) => fn());
    };
  }, []);

  return (
    <div
      data-tauri-drag-region
      className={
        "glass relative z-20 flex h-11 flex-none items-center border-b border-border/70 select-none duration-200 " +
        (focused ? "" : "opacity-75")
      }
    >
      {/* Brand: glyph with a soft specular shine + mono wordmark. */}
      <div data-tauri-drag-region className="pointer-events-none flex items-center gap-2.5 pl-3.5">
        <span className="relative flex h-6 w-6 items-center justify-center overflow-hidden rounded-[7px] bg-gradient-to-b from-[#a34a55] to-oxblood-ink text-white shadow-sh1">
          <span className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/35 to-transparent" />
          <Logo size={15} className="relative" />
        </span>
        <span className="micro text-ink-soft">
          Dooper
        </span>
      </div>

      {/* Centered whisper — status voice lives here later (search, presence). */}
      <div
        data-tauri-drag-region
        className="micro-sm pointer-events-none absolute inset-x-0 hidden text-center text-faint/80 sm:block"
      >
        {/* intentionally quiet */}
      </div>

      {/* Window controls: roomy hit targets, rounded hover pills, red close. */}
      <div className="ml-auto flex items-center gap-0.5 pr-2">
        <ControlButton label="Minimize" onClick={() => win.minimize()}>
          <svg width="11" height="11" viewBox="0 0 11 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
            <line x1="1" y1="5.5" x2="10" y2="5.5" />
          </svg>
        </ControlButton>
        <ControlButton label={maximized ? "Restore" : "Maximize"} onClick={() => win.toggleMaximize()}>
          {maximized ? (
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="3" width="7" height="7" rx="1.5" />
              <path d="M3.5 3V2.5A1.5 1.5 0 0 1 5 1h3.5A1.5 1.5 0 0 1 10 2.5V6a1.5 1.5 0 0 1-1.5 1.5H8" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.3">
              <rect x="1" y="1" width="9" height="9" rx="2" />
            </svg>
          )}
        </ControlButton>
        <ControlButton label="Close" danger onClick={() => win.close()}>
          <svg width="11" height="11" viewBox="0 0 11 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
            <path d="M1.5 1.5l8 8M9.5 1.5l-8 8" />
          </svg>
        </ControlButton>
      </div>
    </div>
  );
}

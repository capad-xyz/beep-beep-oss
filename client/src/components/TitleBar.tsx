import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Icon } from "@/components/Icon";

// Custom titlebar (the window runs with decorations:false). Windows layout:
// drag region across the bar, min / max-restore / close on the right. The
// centered mono app name matches the Dispatch spec's titlebar voice.

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
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={
        "flex h-10 w-[46px] items-center justify-center text-mut transition-colors " +
        (danger ? "hover:bg-danger hover:text-white" : "hover:bg-oxblood-tint hover:text-ink")
      }
    >
      {children}
    </button>
  );
}

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let alive = true;
    win.isMaximized().then((m) => alive && setMaximized(m));
    const unlisten = win.onResized(async () => {
      const m = await win.isMaximized();
      if (alive) setMaximized(m);
    });
    return () => {
      alive = false;
      unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <div
      data-tauri-drag-region
      className="relative flex h-10 flex-none items-center border-b border-border bg-panel select-none"
    >
      <div data-tauri-drag-region className="flex items-center gap-2 pl-3 pointer-events-none">
        <span className="flex h-5 w-5 items-center justify-center rounded-[6px] bg-oxblood text-white">
          <Icon name="chat" size={12} strokeWidth={2.2} />
        </span>
      </div>
      <div
        data-tauri-drag-region
        className="micro pointer-events-none absolute inset-x-0 text-center text-faint"
      >
        Dispatch
      </div>
      <div className="ml-auto flex">
        <ControlButton label="Minimize" onClick={() => win.minimize()}>
          <svg width="11" height="11" viewBox="0 0 11 11" stroke="currentColor" strokeWidth="1.2">
            <line x1="0.5" y1="5.5" x2="10.5" y2="5.5" />
          </svg>
        </ControlButton>
        <ControlButton label={maximized ? "Restore" : "Maximize"} onClick={() => win.toggleMaximize()}>
          {maximized ? (
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.2">
              <rect x="0.5" y="2.5" width="8" height="8" rx="1" />
              <path d="M2.5 2.5v-1a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-1" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.2">
              <rect x="0.5" y="0.5" width="10" height="10" rx="1.5" />
            </svg>
          )}
        </ControlButton>
        <ControlButton label="Close" danger onClick={() => win.close()}>
          <svg width="11" height="11" viewBox="0 0 11 11" stroke="currentColor" strokeWidth="1.2">
            <path d="M0.5 0.5l10 10M10.5 0.5l-10 10" />
          </svg>
        </ControlButton>
      </div>
    </div>
  );
}

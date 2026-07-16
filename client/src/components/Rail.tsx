import type { Account } from "@/bindings/Account";
import { Icon } from "@/components/Icon";
import { Logo } from "@/components/Logo";
import { initials } from "@/lib/format";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type Surface = "chats" | "calls" | "settings";

// 64px network/nav rail (Dispatch spec): logo, one circle per connected
// account (unread badge + active indicator), Chats/Calls nav, gear, user.
export function Rail({
  accounts,
  accountFilter,
  onAccountFilter,
  unreadByAccount,
  surface,
  onSurface,
  userId,
}: {
  accounts: Account[];
  accountFilter: string | null;
  onAccountFilter: (id: string | null) => void;
  unreadByAccount: Map<string, number>;
  surface: Surface;
  onSurface: (s: Surface) => void;
  userId: string;
}) {
  const userInitials = initials(userId.replace(/^@/, "").split(":")[0] || "?");

  return (
    <div className="flex w-16 flex-none flex-col items-center gap-3 border-r border-border bg-gradient-to-b from-panel to-ground py-4">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => {
              onSurface("chats");
              onAccountFilter(null);
            }}
            className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-[12px] bg-gradient-to-b from-[#a34a55] to-oxblood-ink text-white shadow-sh1 hover:shadow-sh2"
          >
            <span className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/30 to-transparent" />
            <Logo size={24} className="relative" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">All chats</TooltipContent>
      </Tooltip>
      <div className="my-0.5 h-px w-7 bg-border" />

      {accounts.map((a) => {
        const active = surface === "chats" && accountFilter === a.id;
        const unread = unreadByAccount.get(a.id) ?? 0;
        return (
          <Tooltip key={a.id}>
            <TooltipTrigger
              onClick={() => {
                onSurface("chats");
                onAccountFilter(active ? null : a.id);
              }}
              className="relative flex h-11 w-11 items-center justify-center"
            >
              {active && (
                <span className="absolute -left-2.5 top-[11px] h-[22px] w-[3px] rounded-full bg-oxblood" />
              )}
              <span
                className={
                  "relative flex h-[42px] w-[42px] items-center justify-center rounded-full font-mono text-xs font-semibold text-white bg-net-whatsapp shadow-sh1 transition-[opacity,box-shadow] duration-200 ease-out " +
                  (active
                    ? "ring-2 ring-oxblood/35 ring-offset-2 ring-offset-panel"
                    : "opacity-90 hover:opacity-100 hover:shadow-sh2")
                }
              >
                {initials(a.label)}
                {unread > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-panel bg-oxblood px-1 text-[9px] font-bold text-white">
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </span>
            </TooltipTrigger>
            <TooltipContent side="right">{a.label}</TooltipContent>
          </Tooltip>
        );
      })}

      <div className="my-0.5 h-px w-7 bg-border" />
      <RailNav icon="chat" label="Chats" active={surface === "chats"} onClick={() => onSurface("chats")} />
      <RailNav icon="phone" label="Calls" active={surface === "calls"} onClick={() => onSurface("calls")} />

      <div className="flex-1" />
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => onSurface("settings")}
            className={
              "flex h-10 w-10 items-center justify-center rounded-full " +
              (surface === "settings" ? "bg-oxblood-tint text-oxblood" : "text-mut hover:text-ink")
            }
          >
            <Icon name="gear" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Settings</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger className="flex h-9 w-9 items-center justify-center rounded-full bg-[#7b61a8] text-[13px] font-semibold text-white">
          {userInitials}
        </TooltipTrigger>
        <TooltipContent side="right">{userId}</TooltipContent>
      </Tooltip>
    </div>
  );
}

function RailNav({
  icon,
  label,
  active,
  onClick,
}: {
  icon: "chat" | "phone";
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className={
            "flex h-[42px] w-[42px] items-center justify-center rounded-md " +
            (active ? "bg-oxblood-tint text-oxblood" : "text-mut hover:text-ink")
          }
        >
          <Icon name={icon} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

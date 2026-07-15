import { useState } from "react";
import type { Account } from "@/bindings/Account";
import { Icon, type IconName } from "@/components/Icon";

type Section = "accounts" | "notifications" | "appearance" | "privacy" | "about";

const NAV: { id: Section; label: string; icon: IconName }[] = [
  { id: "accounts", label: "Accounts", icon: "grid" },
  { id: "notifications", label: "Notifications", icon: "bell" },
  { id: "appearance", label: "Appearance", icon: "sun" },
  { id: "privacy", label: "Privacy", icon: "lock" },
  { id: "about", label: "About", icon: "info" },
];

// Settings surface (Dispatch spec): 264px nav + detail column. Only Accounts
// and About have real content today; the other sections render honest
// placeholders so the nav shape matches the spec as features land.
export function SettingsView({
  accounts,
  userId,
  onAddNetwork,
  onSignOut,
}: {
  accounts: Account[];
  userId: string;
  onAddNetwork: () => void;
  onSignOut: () => void;
}) {
  const [section, setSection] = useState<Section>("accounts");

  return (
    <div className="flex min-w-0 flex-1 bg-ground">
      {/* nav */}
      <div className="flex w-[264px] flex-none flex-col gap-0.5 border-r border-border bg-panel px-4 py-6">
        <div className="micro px-3 pb-3 text-mut">Settings</div>
        {NAV.map((n) => {
          const on = section === n.id;
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => setSection(n.id)}
              className={
                "flex items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm " +
                (on ? "bg-elevated font-semibold text-ink shadow-sh1" : "font-medium text-mut hover:text-ink")
              }
            >
              <span className={"flex " + (on ? "text-oxblood" : "text-faint")}>
                <Icon name={n.icon} size={17} />
              </span>
              {n.label}
            </button>
          );
        })}
        <div className="flex-1" />
        <button
          type="button"
          onClick={onSignOut}
          className="flex items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm text-danger hover:bg-danger/10"
        >
          <Icon name="logout" size={17} /> Sign out
        </button>
      </div>

      {/* detail */}
      <div className="flex min-w-0 max-w-[760px] flex-1 flex-col gap-6 overflow-y-auto px-16 py-8">
        {section === "accounts" && (
          <>
            <div>
              <h3 className="m-0 mb-1 text-[22px] font-semibold tracking-[-0.01em]">
                Connected accounts
              </h3>
              <p className="m-0 text-[13px] leading-normal text-mut">
                Every network you link appears in one unified inbox. Sessions are stored
                locally — self-hosted, no relay.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              {/* Matrix account (the session itself) */}
              <AccountCard
                abbr="MX"
                color="#0dbd8b"
                name="Matrix"
                handle={userId}
                state="Connected"
                stateColor="text-success dot-success"
              />
              {accounts.map((a) => (
                <AccountCard
                  key={a.id}
                  abbr="WA"
                  color="#1fab54"
                  name="WhatsApp"
                  handle={a.label}
                  state="Connected"
                  stateColor="text-success"
                />
              ))}
              <button
                type="button"
                onClick={onAddNetwork}
                className="flex items-center justify-center gap-2 rounded-lg border-[1.5px] border-dashed border-border-strong p-4 text-sm font-medium text-oxblood hover:border-oxblood hover:bg-oxblood-tint"
              >
                <Icon name="plus" size={16} /> Add another network
              </button>
              <p className="micro-sm text-faint">
                Signal · Telegram · Instagram arrive later — same badge, same session states.
              </p>
            </div>
          </>
        )}

        {section === "about" && (
          <>
            <h3 className="m-0 text-[22px] font-semibold tracking-[-0.01em]">About</h3>
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-elevated p-4 shadow-sh1">
              <Row k="App" v="Dooper — Beeper, but open-source" />
              <Row k="Signed in as" v={userId} />
              <Row k="Stack" v="Tauri · matrix-rust-sdk · sliding sync · mautrix-whatsapp" />
            </div>
          </>
        )}

        {section !== "accounts" && section !== "about" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-24">
            <span className="micro text-mut">Coming soon</span>
            <span className="max-w-[380px] text-center text-[13px] text-faint">
              {section === "notifications" &&
                "Per-chat mute already works from a chat's context menu; global notification preferences land here."}
              {section === "appearance" &&
                "Warm paper is the only theme for now — dark mode drops in once it's designed."}
              {section === "privacy" &&
                "Read receipts and typing indicators are always on for now; toggles land here."}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function AccountCard({
  abbr,
  color,
  name,
  handle,
  state,
}: {
  abbr: string;
  color: string;
  name: string;
  handle: string;
  state: string;
  stateColor?: string;
}) {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-border bg-elevated p-4 shadow-sh1">
      <span
        className="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-md font-mono text-xs font-semibold text-white"
        style={{ background: color }}
      >
        {abbr}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">{name}</span>
        <span className="block truncate text-[13px] text-mut">{handle}</span>
      </span>
      <span className="micro-sm mr-3 flex items-center gap-1.5 text-success">
        <span className="h-[7px] w-[7px] rounded-full bg-success" />
        {state}
      </span>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="micro-sm w-28 flex-none text-mut">{k}</span>
      <span className="min-w-0 break-words text-sm">{v}</span>
    </div>
  );
}

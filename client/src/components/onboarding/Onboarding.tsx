import { useState } from "react";
import type { LoginError } from "@/hooks/useSession";
import { Icon } from "@/components/Icon";

const DEFAULT_HOMESERVER = "http://localhost:18008";

// First-run sign-in (onboarding step 1). The homeserver is baked in and lives
// behind an "Advanced" disclosure; errors are distinct, visible cards — never
// hidden behind the busy state. Step 2 (WhatsApp QR) renders at the App level
// once a session exists.
export function Onboarding({
  busy,
  loginError,
  sessionExpired,
  onLogin,
}: {
  busy: boolean;
  loginError: LoginError | null;
  sessionExpired: boolean;
  onLogin: (homeserver: string, username: string, password: string) => void;
}) {
  const [homeserver, setHomeserver] = useState(DEFAULT_HOMESERVER);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <OnboardingShell>
      <div className="flex flex-col items-center gap-1 text-center">
        <div className="text-[22px] font-semibold tracking-[-0.01em]">Welcome to Dooper</div>
        <div className="text-[13px] text-mut">All your chats, one quiet window.</div>
      </div>

      {sessionExpired && (
        <Notice tone="warn">Your session expired — sign in again to continue.</Notice>
      )}
      {loginError && (
        <Notice tone="danger">
          <div className="font-medium">{loginError.message}</div>
          {loginError.kind === "unknown" || loginError.kind === "unreachable" ? (
            <div className="mt-1 break-words font-mono text-[10px] leading-relaxed opacity-80">
              {loginError.detail}
            </div>
          ) : null}
        </Notice>
      )}

      <form
        className="flex w-full flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          onLogin(homeserver.trim(), username.trim(), password);
        }}
      >
        <Field label="Username">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoCapitalize="off"
            autoCorrect="off"
            className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
            placeholder="your username"
          />
        </Field>
        <Field label="Password">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
            placeholder="••••••••"
          />
        </Field>

        {showAdvanced ? (
          <Field label="Homeserver">
            <input
              value={homeserver}
              onChange={(e) => setHomeserver(e.target.value)}
              className="w-full bg-transparent font-mono text-[13px] outline-none placeholder:text-faint"
            />
          </Field>
        ) : (
          <button
            type="button"
            onClick={() => setShowAdvanced(true)}
            className="micro-sm self-start text-faint hover:text-mut"
          >
            Advanced · {homeserver}
          </button>
        )}

        <button
          type="submit"
          disabled={busy || !username.trim() || !password}
          className="mt-1 flex h-11 items-center justify-center gap-2 rounded-full bg-oxblood text-sm font-semibold text-white shadow-sh1 hover:opacity-90 disabled:opacity-50"
        >
          {busy && (
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-[1.5px] border-white/40 border-t-white" />
          )}
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </OnboardingShell>
  );
}

export function OnboardingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-ground px-6">
      <div className="flex w-full max-w-[400px] flex-col items-center gap-5 rounded-xl border border-border bg-elevated px-8 py-10 shadow-sh2">
        <span className="flex h-14 w-14 items-center justify-center rounded-[16px] bg-oxblood text-white shadow-sh2">
          <Icon name="chat" size={26} />
        </span>
        {children}
      </div>
    </div>
  );
}

export function RestoringSplash() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-ground">
      <span className="flex h-14 w-14 items-center justify-center rounded-[16px] bg-oxblood text-white shadow-sh2">
        <Icon name="chat" size={26} />
      </span>
      <span className="micro flex items-center gap-2 text-mut">
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-mut/40 border-t-mut" />
        Restoring session
      </span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="micro-sm text-mut">{label}</span>
      <span className="flex items-center rounded-md border border-border-strong bg-elevated px-3 py-[10px] shadow-sh1 focus-within:border-oxblood focus-within:ring-2 focus-within:ring-oxblood/20">
        {children}
      </span>
    </label>
  );
}

function Notice({ tone, children }: { tone: "warn" | "danger"; children: React.ReactNode }) {
  return (
    <div
      className={
        "w-full rounded-md border px-3 py-2.5 text-[13px] " +
        (tone === "danger"
          ? "border-danger/30 bg-danger/10 text-danger"
          : "border-warn/40 bg-warn/10 text-[#8a5f1d]")
      }
    >
      {children}
    </div>
  );
}

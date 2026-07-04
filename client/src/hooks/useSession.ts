import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { login as apiLogin, logout as apiLogout, restoreSession, closeRoomTimeline } from "@/api";

export type LoginError = {
  kind: "credentials" | "rate-limited" | "unreachable" | "unknown";
  message: string;
  detail: string; // the raw backend error, for the mono detail line
};

// Map the backend's stringly-typed errors to the distinct login states the
// design calls out (wrong password / rate-limited / can't reach server).
export function mapLoginError(err: unknown): LoginError {
  const detail = String(err);
  const lower = detail.toLowerCase();
  if (lower.includes("m_forbidden") || lower.includes("403") || lower.includes("invalid username or password"))
    return { kind: "credentials", message: "Wrong username or password.", detail };
  if (lower.includes("m_limit_exceeded") || lower.includes("429") || lower.includes("too many"))
    return { kind: "rate-limited", message: "Too many attempts — wait a moment and try again.", detail };
  if (
    lower.includes("connection refused") || lower.includes("timed out") ||
    lower.includes("network") || lower.includes("dns") || lower.includes("error sending request")
  )
    return { kind: "unreachable", message: "Can't reach the server.", detail };
  return { kind: "unknown", message: "Sign-in failed.", detail };
}

// Session lifecycle: restore-on-launch, login, logout, and the "auth-invalid"
// forced-logout event from the Rust core. `onAuthChange(userId)` fires on every
// transition so the caller can reset dependent state (rooms, open timeline).
export function useSession(onAuthChange: (userId: string | null) => void) {
  const [userId, setUserId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loginError, setLoginError] = useState<LoginError | null>(null);
  const onAuthChangeRef = useRef(onAuthChange);
  onAuthChangeRef.current = onAuthChange;

  // On launch, try to restore a saved session so we skip the login screen.
  // Three-way outcome: "restored" → inbox; "expired" → login with the expired
  // notice; "none" → plain login.
  useEffect(() => {
    (async () => {
      try {
        const outcome = await restoreSession();
        if (outcome.status === "restored" && outcome.user_id) {
          setUserId(outcome.user_id);
          onAuthChangeRef.current(outcome.user_id);
        } else if (outcome.status === "expired") {
          setSessionExpired(true);
        }
      } catch {
        /* unexpected restore error — fall through to the login screen */
      } finally {
        setRestoring(false);
      }
    })();
  }, []);

  // The server rejected our token mid-session: drop to the login screen with a
  // clear reason. The Rust side has already wiped the saved session file, but
  // can't reach the open room's Timeline — retire it here so the stale diff
  // task doesn't emit while we sit on the login screen.
  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    listen("auth-invalid", () => {
      closeRoomTimeline().catch(() => {});
      setUserId(null);
      setSessionExpired(true);
      onAuthChangeRef.current(null);
    }).then((fn) => {
      if (alive) unlisten = fn;
      else fn();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  async function login(homeserver: string, username: string, password: string) {
    setLoginError(null);
    setSessionExpired(false);
    setBusy(true);
    try {
      const id = await apiLogin(homeserver, username, password);
      setUserId(id);
      onAuthChangeRef.current(id);
      return true;
    } catch (err) {
      setLoginError(mapLoginError(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    closeRoomTimeline().catch(() => {});
    await apiLogout();
    setUserId(null);
    onAuthChangeRef.current(null);
  }

  return {
    userId,
    restoring,
    sessionExpired,
    busy,
    loginError,
    clearLoginError: () => setLoginError(null),
    login,
    logout,
  };
}

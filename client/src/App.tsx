import { useState } from "react";
import { login, listRooms, logout } from "./api";
import type { RoomSummary } from "./bindings/RoomSummary";

// Phase 1 inbox: log in to a homeserver, then show a unified room list.
// Message timeline, multi-account, and the AI layer come next.

const AVATAR_COLORS = [
  "#5b6cff", "#e0567a", "#2db88a", "#e6a23c",
  "#9b5bff", "#3aa0ff", "#ef6c4d", "#16b1a8",
];

// Deterministic colour from the room id so each chat keeps a stable avatar.
function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

// A human label for a room. matrix-sdk returns no name for many DMs/bridged
// rooms, where the raw `!id:server` is useless to a person — fall back cleanly.
function displayName(r: RoomSummary): string {
  const n = r.name?.trim();
  return n && n.length > 0 ? n : "Unnamed room";
}

function initials(label: string): string {
  const words = label.replace(/[^\p{L}\p{N} ]/gu, "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "#";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export default function App() {
  const [homeserver, setHomeserver] = useState("http://localhost:8008");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const id = await login(homeserver, username, password);
      setUserId(id);
      await refreshRooms();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function refreshRooms() {
    try {
      setRooms(await listRooms());
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleLogout() {
    await logout();
    setUserId(null);
    setRooms([]);
  }

  if (!userId) {
    return (
      <main className="center">
        <h1>beep-beep</h1>
        <p className="muted">Sign in to your homeserver</p>
        <form onSubmit={handleLogin} className="card">
          <label>
            Homeserver
            <input value={homeserver} onChange={(e) => setHomeserver(e.target.value)} />
          </label>
          <label>
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button disabled={busy} type="submit">
            {busy ? "Signing in…" : "Sign in"}
          </button>
          {error && <p className="error">{error}</p>}
        </form>
      </main>
    );
  }

  const totalUnread = rooms.reduce((sum, r) => sum + Number(r.unread), 0);

  // Unread chats float to the top, then alphabetical — a usable inbox order.
  const sorted = [...rooms].sort((a, b) => {
    const au = a.unread > 0 ? 1 : 0;
    const bu = b.unread > 0 ? 1 : 0;
    if (au !== bu) return bu - au;
    return displayName(a).localeCompare(displayName(b));
  });

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">bb</span> beep-beep
        </div>
        <div className="account">
          <span className="muted">{userId}</span>
          <button className="ghost" onClick={refreshRooms}>Refresh</button>
          <button className="ghost" onClick={handleLogout}>Sign out</button>
        </div>
      </header>

      <div className="inbox-head">
        <h2>Inbox</h2>
        <span className="muted">
          {rooms.length} chats{totalUnread > 0 ? ` · ${totalUnread} unread` : ""}
        </span>
      </div>

      {error && <p className="error">{error}</p>}

      <ul className="rooms">
        {rooms.length === 0 && (
          <li className="empty muted">No rooms yet — sync may still be running. Hit Refresh.</li>
        )}
        {sorted.map((r) => {
          const label = displayName(r);
          return (
            <li key={r.id} className="room">
              <span className="avatar" style={{ background: avatarColor(r.id) }}>
                {initials(label)}
              </span>
              <span className="room-name">{label}</span>
              {r.unread > 0 && <span className="badge">{r.unread}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

import { useState } from "react";
import { login, listRooms, logout, roomMessages } from "./api";
import type { RoomSummary } from "./bindings/RoomSummary";
import type { ChatLine } from "./bindings/ChatLine";

// Phase 1 inbox + read-only conversation view. Sending, multi-account, and the
// AI layer come next.

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

// A human label for a room; many DMs/bridged rooms carry no name.
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

// "@whatsapp_49…:localhost" -> "whatsapp_49…" — a readable sender handle.
function shortSender(id: string): string {
  return id.replace(/^@/, "").split(":")[0];
}

export default function App() {
  const [homeserver, setHomeserver] = useState("http://localhost:8008");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openRoom, setOpenRoom] = useState<RoomSummary | null>(null);
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

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
    setOpenRoom(null);
    setMessages([]);
  }

  async function openConversation(room: RoomSummary) {
    setOpenRoom(room);
    setMessages([]);
    setError(null);
    setLoadingMsgs(true);
    try {
      setMessages(await roomMessages(room.id, 50));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingMsgs(false);
    }
  }

  // ---- Login ----
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

  // ---- Conversation ----
  if (openRoom) {
    return (
      <div className="app">
        <header className="topbar">
          <button className="ghost" onClick={() => setOpenRoom(null)}>← Inbox</button>
          <strong className="convo-title">{displayName(openRoom)}</strong>
          <button className="ghost" onClick={() => openConversation(openRoom)}>Refresh</button>
        </header>
        {error && <p className="error">{error}</p>}
        <div className="convo">
          {loadingMsgs && <p className="muted">Loading messages…</p>}
          {!loadingMsgs && messages.length === 0 && (
            <p className="empty muted">No text messages to show.</p>
          )}
          {messages.map((m, i) => {
            const own = m.sender === userId;
            return (
              <div key={i} className={own ? "msg own" : "msg"}>
                {!own && <span className="msg-sender">{shortSender(m.sender)}</span>}
                <span className="msg-body">{m.body}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ---- Inbox ----
  const totalUnread = rooms.reduce((sum, r) => sum + Number(r.unread), 0);
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
            <li key={r.id} className="room" onClick={() => openConversation(r)}>
              <span className="avatar" style={{ background: avatarColor(r.id) }}>
                {initials(label)}
              </span>
              <span className="room-name">{label}</span>
              {r.unread > 0 && <span className="badge">{Number(r.unread)}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

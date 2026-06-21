import { Fragment, useEffect, useRef, useState } from "react";
import { login, listRooms, logout, roomMessages, sendMessage, roomAvatar, joinRoom } from "./api";
import { listen } from "@tauri-apps/api/event";
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

// origin_server_ts (ms) -> a short local clock time, e.g. "18:55".
function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Whether two epoch-ms timestamps fall on the same calendar day.
function sameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

// A day-separator label: "Today" / "Yesterday" / "Mon, Jun 16".
function formatDay(ms: number): string {
  const now = Date.now();
  if (sameDay(ms, now)) return "Today";
  if (sameDay(ms, now - 86_400_000)) return "Yesterday";
  return new Date(ms).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

// Compact relative time for inbox rows: "now" / "5m" / "3h" / "2d" / "Jun 16".
function relTime(ms: number): string {
  const mins = Math.floor((Date.now() - ms) / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
}

// Session-lifetime cache of resolved avatar data: URLs, keyed by room id.
// `null` = fetched but the room has no avatar (don't refetch); `undefined` = not fetched yet.
const avatarCache = new Map<string, string | null>();
const avatarInflight = new Map<string, Promise<string | null>>();

// Inbox avatar: shows initials immediately, then swaps to the room's real
// (WhatsApp) picture once room_avatar resolves. Fetches at most once per room id.
function RoomAvatar({ id, label }: { id: string; label: string }) {
  const [src, setSrc] = useState<string | null>(() => avatarCache.get(id) ?? null);

  useEffect(() => {
    let alive = true;
    const cached = avatarCache.get(id);
    if (cached !== undefined) {
      setSrc(cached);
      return;
    }
    let p = avatarInflight.get(id);
    if (!p) {
      p = roomAvatar(id)
        .then((url) => {
          avatarCache.set(id, url);
          return url;
        })
        .catch(() => {
          avatarCache.set(id, null);
          return null;
        })
        .finally(() => {
          avatarInflight.delete(id);
        });
      avatarInflight.set(id, p);
    }
    p.then((url) => {
      if (alive) setSrc(url);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  if (src) {
    return (
      <span className="avatar">
        <img src={src} alt="" />
      </span>
    );
  }
  return (
    <span className="avatar" style={{ background: avatarColor(id) }}>
      {initials(label)}
    </span>
  );
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
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Keep the conversation pinned to the newest message (on open + after send).
  useEffect(() => {
    bottomRef.current?.scrollIntoView();
  }, [messages]);

  // Esc closes the open conversation (back to the inbox).
  useEffect(() => {
    if (!openRoom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpenRoom(null); setError(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openRoom]);

  // LIVE INBOX: the backend emits "rooms-updated" after each sync touches a room;
  // re-pull the list so the inbox updates itself — no manual Refresh.
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    let unlisten: (() => void) | undefined;
    listen("rooms-updated", () => {
      refreshRooms();
    }).then((fn) => {
      if (alive) unlisten = fn;
      else fn();
    });
    // Initial-sync catch-up: the first sync's "rooms-updated" can fire before the
    // listener above attaches, so re-pull a few times over the first seconds
    // after login. Combined with the live listener → no manual Refresh.
    const timers = [1200, 3000, 6000].map((ms) =>
      setTimeout(() => {
        if (alive) refreshRooms();
      }, ms)
    );
    return () => {
      alive = false;
      unlisten?.();
      timers.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

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
    // Invited (bridge "ghost") rooms can't be read until accepted — accept first.
    if (room.membership === "invited") {
      try {
        await joinRoom(room.id);
        await refreshRooms();
      } catch (err) {
        setError(String(err));
        return;
      }
    }
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

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!openRoom || !userId || !body) return;
    setDraft("");
    // Optimistic echo: render the message instantly instead of waiting for a
    // full reload — sending should feel immediate. Rolled back if the send fails;
    // the next Refresh/open reconciles against the server copy.
    const optimistic: ChatLine = { sender: userId, sender_name: "You", body, ts: Date.now() };
    setMessages((prev) => [...prev, optimistic]);
    try {
      await sendMessage(openRoom.id, body);
    } catch (err) {
      setError(String(err));
      setDraft(body);
      setMessages((prev) => prev.filter((m) => m !== optimistic));
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
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
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
          <button className="ghost" onClick={() => { setOpenRoom(null); setError(null); }}>← Inbox</button>
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
            const prev = i > 0 ? messages[i - 1] : null;
            const showDay = !prev || !sameDay(prev.ts, m.ts);
            // Group consecutive messages from the same sender within 5 minutes.
            const grouped =
              !!prev && !showDay && prev.sender === m.sender && m.ts - prev.ts < 300_000;
            return (
              <Fragment key={i}>
                {showDay && (
                  <div className="day-sep">
                    <span>{formatDay(m.ts)}</span>
                  </div>
                )}
                <div className={`${own ? "msg own" : "msg"}${grouped ? " grouped" : ""}`}>
                  {!own && !grouped && (
                    <span className="msg-sender">{m.sender_name}</span>
                  )}
                  <span className="msg-body">{m.body}</span>
                  <span className="msg-time">{formatTime(m.ts)}</span>
                </div>
              </Fragment>
            );
          })}
          <div ref={bottomRef} />
        </div>
        <form className="composer" onSubmit={handleSend}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type a message…"
            autoFocus
          />
          <button type="submit" disabled={!draft.trim()}>Send</button>
        </form>
      </div>
    );
  }

  // ---- Inbox ----
  const totalUnread = rooms.reduce((sum, r) => sum + Number(r.unread), 0);
  const sorted = [...rooms].sort((a, b) => {
    const at = a.last_ts ?? 0;
    const bt = b.last_ts ?? 0;
    if (at !== bt) return bt - at; // most recent activity first
    return displayName(a).localeCompare(displayName(b));
  });
  const q = query.trim().toLowerCase();
  const filtered = q
    ? sorted.filter(
        (r) =>
          displayName(r).toLowerCase().includes(q) ||
          (r.last_message ?? "").toLowerCase().includes(q)
      )
    : sorted;

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

      <input
        className="search"
        placeholder="Search chats…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {error && <p className="error">{error}</p>}

      <ul className="rooms">
        {rooms.length === 0 && (
          <li className="empty muted">No rooms yet — sync may still be running. Hit Refresh.</li>
        )}
        {rooms.length > 0 && filtered.length === 0 && (
          <li className="empty muted">No chats match “{query}”.</li>
        )}
        {filtered.map((r) => {
          const label = displayName(r);
          const joined = r.membership === "joined";
          return (
            <li
              key={r.id}
              className={joined ? "room" : "room pending"}
              onClick={() => openConversation(r)}
            >
              <RoomAvatar id={r.id} label={label} />
              <div className="room-main">
                <span className="room-name">{label}</span>
                {!joined ? (
                  <span className="room-preview">Tap to accept invite</span>
                ) : (
                  r.last_message && <span className="room-preview">{r.last_message}</span>
                )}
              </div>
              <div className="room-meta">
                {!joined && <span className="badge invite">Invite</span>}
                {joined && r.last_ts != null && <span className="room-time">{relTime(r.last_ts)}</span>}
                {joined && r.unread > 0 && <span className="badge">{Number(r.unread)}</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

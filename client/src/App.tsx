import { Fragment, useEffect, useRef, useState } from "react";
import { login, listRooms, listAccounts, logout, roomMessages, sendMessage, sendReaction, editMessage, deleteMessage, markRead, setTyping, setPinned, setArchived, setMuted, sendMedia, searchMessages, roomAvatar, fetchMedia, joinRoom, acceptAllInvites, subscribeRoom, restoreSession } from "./api";
import { listen } from "@tauri-apps/api/event";
import type { RoomSummary } from "./bindings/RoomSummary";
import type { ChatLine } from "./bindings/ChatLine";
import type { Account } from "./bindings/Account";
import type { SearchHit } from "./bindings/SearchHit";

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

// Session cache of resolved message-image data: URLs, keyed by the media handle.
const mediaCache = new Map<string, string>();

// Lazily fetches and renders an image message (e.g. the WhatsApp bridge QR code),
// so opening a chat doesn't block on downloading every picture up front.
function MessageImage({ source, alt }: { source: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(() => mediaCache.get(source) ?? null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const cached = mediaCache.get(source);
    if (cached) { setSrc(cached); return; }
    let alive = true;
    fetchMedia(source)
      .then((url) => { mediaCache.set(source, url); if (alive) setSrc(url); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [source]);
  if (failed) return <span className="muted">[image unavailable]</span>;
  if (!src) return <span className="muted">Loading image…</span>;
  return <img className="msg-image" src={src} alt={alt} />;
}

// Unobtrusive topbar pill shown only when sync is NOT healthy. `state` is the
// raw "sync-state" payload from Rust (null when running = pill hidden).
function SyncPill({ state }: { state: string | null }) {
  if (!state) return null;
  // "offline" gets a dimmer look + its own label; "terminated" and "reconnecting"
  // both read as actively recovering, so they share the "Reconnecting…" label.
  const offline = state === "offline";
  return (
    <span className={offline ? "sync-pill offline" : "sync-pill"}>
      {offline ? "Offline" : "Reconnecting…"}
    </span>
  );
}

export default function App() {
  const [homeserver, setHomeserver] = useState("http://localhost:18008");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountFilter, setAccountFilter] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openRoom, setOpenRoom] = useState<RoomSummary | null>(null);
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [restoring, setRestoring] = useState(true);
  // Sync lifecycle: the Rust sync observer emits "sync-state" whenever the sliding
  // sync engine's health changes. "running" (or null) = healthy → no pill; the
  // other values render an unobtrusive status pill in the topbar. See matrix.rs.
  const [syncState, setSyncState] = useState<string | null>(null);
  // Set when a saved session was rejected by the server (or the token is revoked
  // mid-session): the login screen shows "Session expired, please log in again".
  const [sessionExpired, setSessionExpired] = useState(false);
  // Message being replied to / edited (null = plain send), who's typing in the
  // open room, and which message has its reaction picker open.
  const [replyTo, setReplyTo] = useState<ChatLine | null>(null);
  const [editing, setEditing] = useState<ChatLine | null>(null);
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const [reactFor, setReactFor] = useState<string | null>(null);
  // Archived-chats view toggle, global message-search results, upload state.
  const [showArchived, setShowArchived] = useState(false);
  const [searchHits, setSearchHits] = useState<SearchHit[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  // Latest open room, readable from the live-update listener without re-subscribing.
  const openRoomRef = useRef<RoomSummary | null>(null);
  openRoomRef.current = openRoom;

  // Keep the conversation pinned to the newest message — but only when the list
  // grows (open / new message), so a live re-fetch doesn't yank you mid-scroll.
  const prevLenRef = useRef(0);
  useEffect(() => {
    if (messages.length > prevLenRef.current) bottomRef.current?.scrollIntoView();
    prevLenRef.current = messages.length;
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

  // Open-room liveness: subscribe_room + "rooms-updated" is the fast path, but
  // it proved unreliable (probe messages never arrived), so a light 3s re-pull
  // of the open room is the guaranteed floor. Cheap: one /messages call for one
  // room, only while a conversation is open. Revisit in the sync-hardening pass.
  useEffect(() => {
    if (!openRoom) return;
    const id = setInterval(() => {
      roomMessages(openRoom.id, 50).then(setMessages).catch(() => {});
    }, 3000);
    return () => clearInterval(id);
  }, [openRoom]);

  // Live "X is typing…" for the open room, emitted by the Rust typing handler.
  useEffect(() => {
    if (!openRoom) {
      setTypingNames([]);
      return;
    }
    let alive = true;
    let unlisten: (() => void) | undefined;
    listen<{ room_id: string; names: string[] }>("typing", (e) => {
      const cur = openRoomRef.current;
      if (cur && e.payload.room_id === cur.id) setTypingNames(e.payload.names);
    }).then((fn) => {
      if (alive) unlisten = fn;
      else fn();
    });
    return () => {
      alive = false;
      unlisten?.();
      setTypingNames([]);
    };
  }, [openRoom]);

  // LIVE INBOX: the backend emits "rooms-updated" after each sync touches a room;
  // re-pull the list so the inbox updates itself — no manual Refresh.
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    let unlisten: (() => void) | undefined;
    listen("rooms-updated", () => {
      refreshRooms();
      // If a conversation is open, re-pull its messages too, so bot replies +
      // incoming messages appear live there as well (not just the inbox list).
      const cur = openRoomRef.current;
      if (cur) {
        roomMessages(cur.id, 50).then(setMessages).catch(() => {});
        // We're looking at this chat, so whatever just arrived is read.
        markRead(cur.id).catch(() => {});
      }
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

  // On launch, try to restore a saved session so we skip the login screen. The
  // outcome is three-way: "restored" → go straight to the inbox; "expired" → the
  // saved session was rejected, so show login with the expired message; "none" →
  // no saved session, plain login screen.
  useEffect(() => {
    (async () => {
      try {
        const outcome = await restoreSession();
        if (outcome.status === "restored" && outcome.user_id) {
          setUserId(outcome.user_id);
          await refreshRooms();
          acceptAllInvites().catch(() => {});
        } else if (outcome.status === "expired") {
          setSessionExpired(true);
        }
      } catch {
        /* unexpected restore error — fall through to the login screen */
      } finally {
        setRestoring(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync-lifecycle + auth-invalidation events from the Rust core. Attached once
  // for the app's lifetime (not gated on login) so a "sync-state" that fires
  // during the initial post-login sync is never missed.
  useEffect(() => {
    let alive = true;
    const unlisteners: (() => void)[] = [];
    const track = (p: Promise<() => void>) =>
      p.then((fn) => {
        if (alive) unlisteners.push(fn);
        else fn();
      });

    // Health of the sliding sync engine → drives the topbar status pill.
    track(
      listen<string>("sync-state", (e) => {
        setSyncState(e.payload === "running" ? null : e.payload);
      })
    );
    // The server rejected our token: drop to the login screen with a clear reason.
    // The Rust side has already wiped the saved session file by the time this fires.
    track(
      listen("auth-invalid", () => {
        setUserId(null);
        setRooms([]);
        setOpenRoom(null);
        setMessages([]);
        setSyncState(null);
        setSessionExpired(true);
      })
    );

    return () => {
      alive = false;
      unlisteners.forEach((fn) => fn());
    };
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSessionExpired(false);
    setBusy(true);
    try {
      const id = await login(homeserver, username, password);
      setUserId(id);
      await refreshRooms();
      // Auto-accept the bridge's chat/space invites so everything syncs without
      // tapping each one. Runs in the background; the inbox fills in live.
      acceptAllInvites().catch(() => {});
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function refreshRooms() {
    try {
      const [r, a] = await Promise.all([listRooms(), listAccounts()]);
      setRooms(r);
      setAccounts(a);
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

  // One-click "add account": open the bridge bot chat and kick off a QR login.
  // The QR renders inline (image support), so you just scan it with a new phone.
  async function addAccount() {
    const bot = rooms.find((r) => displayName(r) === "WhatsApp bridge bot");
    if (!bot) {
      setError("Couldn't find the WhatsApp bridge bot chat. Hit Refresh and try again.");
      return;
    }
    await openConversation(bot);
    try {
      await sendMessage(bot.id, "login qr");
    } catch (e) {
      setError(String(e));
    }
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
    // Stream this room live via sliding sync (replaces the old 2.5s poll).
    subscribeRoom(room.id).catch(() => {});
    setMessages([]);
    setError(null);
    setReplyTo(null);
    setEditing(null);
    setReactFor(null);
    setLoadingMsgs(true);
    try {
      setMessages(await roomMessages(room.id, 50));
      // Opening a chat reads it: clears our unread badge + shows read ticks.
      markRead(room.id).catch(() => {});
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
    setTyping(openRoom.id, false).catch(() => {});

    // Edit mode: replace the target message's text, no optimistic echo (the
    // edited bubble updates in place on the next live refresh).
    if (editing?.event_id) {
      const target = editing;
      setEditing(null);
      try {
        await editMessage(openRoom.id, target.event_id!, body);
        setMessages(await roomMessages(openRoom.id, 50));
      } catch (err) {
        setError(String(err));
        setDraft(body);
      }
      return;
    }

    const inReplyTo = replyTo?.event_id ?? undefined;
    setReplyTo(null);
    // Optimistic echo: render the message instantly instead of waiting for a
    // full reload — sending should feel immediate. Rolled back if the send fails;
    // the next Refresh/open reconciles against the server copy.
    const optimistic: ChatLine = {
      sender: userId, sender_name: "You", body, ts: Date.now(),
      image: null, event_id: null, edited: false, reactions: [],
    };
    setMessages((prev) => [...prev, optimistic]);
    try {
      await sendMessage(openRoom.id, body, inReplyTo);
    } catch (err) {
      setError(String(err));
      setDraft(body);
      setMessages((prev) => prev.filter((m) => m !== optimistic));
    }
  }

  // Group raw reaction keys into (emoji, count) pairs for display.
  function groupReactions(keys: string[]): [string, number][] {
    const m = new Map<string, number>();
    for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m.entries()];
  }

  const QUICK_EMOJI = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

  async function react(m: ChatLine, key: string) {
    if (!openRoom || !m.event_id) return;
    setReactFor(null);
    try {
      await sendReaction(openRoom.id, m.event_id, key);
      setMessages(await roomMessages(openRoom.id, 50));
    } catch (err) {
      setError(String(err));
    }
  }

  async function removeMessage(m: ChatLine) {
    if (!openRoom || !m.event_id) return;
    if (!window.confirm("Delete this message?")) return;
    try {
      await deleteMessage(openRoom.id, m.event_id);
      setMessages(await roomMessages(openRoom.id, 50));
    } catch (err) {
      setError(String(err));
    }
  }

  // Toggle a room flag (pin/mute/archive) then re-pull so the inbox reflects it.
  async function toggleRoomFlag(
    r: RoomSummary,
    kind: "pin" | "mute" | "archive",
  ) {
    try {
      if (kind === "pin") await setPinned(r.id, !r.pinned);
      if (kind === "mute") await setMuted(r.id, !r.muted);
      if (kind === "archive") await setArchived(r.id, !r.archived);
      await refreshRooms();
    } catch (err) {
      setError(String(err));
    }
  }

  // Attach a file: read it as base64 and hand it to the send queue.
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file || !openRoom) return;
    setUploading(true);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result as string);
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(file);
      });
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      await sendMedia(openRoom.id, file.name, file.type || "application/octet-stream", base64);
      setMessages(await roomMessages(openRoom.id, 50));
    } catch (err) {
      setError(String(err));
    } finally {
      setUploading(false);
    }
  }

  // Enter in the search box = full-text search across ALL chats (server-side).
  async function runGlobalSearch() {
    const q = query.trim();
    if (!q) {
      setSearchHits(null);
      return;
    }
    try {
      setSearchHits(await searchMessages(q, 20));
    } catch (err) {
      setError(String(err));
    }
  }

  // ---- Restoring saved session ----
  if (restoring) {
    return (
      <main className="center">
        <h1>beep-beep</h1>
        <p className="muted">Restoring session…</p>
      </main>
    );
  }

  // ---- Login ----
  if (!userId) {
    return (
      <main className="center">
        <h1>beep-beep</h1>
        <p className="muted">Sign in to your homeserver</p>
        {sessionExpired && (
          <p className="notice">Session expired, please log in again.</p>
        )}
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
          <span className="topbar-right">
            <SyncPill state={syncState} />
            <button className="ghost" onClick={() => openConversation(openRoom)}>Refresh</button>
          </span>
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
                  {m.image ? (
                    <>
                      <MessageImage source={m.image} alt={m.body} />
                      {m.body && m.body !== "[image]" && (
                        <span className="msg-body">{m.body}</span>
                      )}
                    </>
                  ) : (
                    <span className="msg-body">{m.body}</span>
                  )}
                  {m.reactions.length > 0 && (
                    <span className="msg-reactions">
                      {groupReactions(m.reactions).map(([k, n]) => (
                        <span key={k} className="reaction-chip">
                          {k}{n > 1 ? ` ${n}` : ""}
                        </span>
                      ))}
                    </span>
                  )}
                  <span className="msg-time">
                    {m.edited && <span className="edited">edited · </span>}
                    {formatTime(m.ts)}
                  </span>
                  {m.event_id && (
                    <span className="msg-actions">
                      <button type="button" onClick={() => setReactFor(reactFor === m.event_id ? null : m.event_id)}>React</button>
                      <button type="button" onClick={() => { setReplyTo(m); setEditing(null); }}>Reply</button>
                      {own && (
                        <button type="button" onClick={() => { setEditing(m); setReplyTo(null); setDraft(m.body); }}>Edit</button>
                      )}
                      {own && (
                        <button type="button" onClick={() => removeMessage(m)}>Del</button>
                      )}
                    </span>
                  )}
                  {m.event_id && reactFor === m.event_id && (
                    <span className="react-picker">
                      {QUICK_EMOJI.map((k) => (
                        <button key={k} type="button" onClick={() => react(m, k)}>{k}</button>
                      ))}
                    </span>
                  )}
                </div>
              </Fragment>
            );
          })}
          <div ref={bottomRef} />
        </div>
        {typingNames.length > 0 && (
          <p className="typing-line">
            {typingNames.join(", ")} {typingNames.length === 1 ? "is" : "are"} typing…
          </p>
        )}
        {(replyTo || editing) && (
          <div className="compose-context">
            <span>
              {editing ? "Editing" : `Replying to ${replyTo!.sender_name}`}:{" "}
              <span className="muted">{(editing ?? replyTo)!.body.slice(0, 80)}</span>
            </span>
            <button
              className="ghost"
              type="button"
              onClick={() => { if (editing) setDraft(""); setReplyTo(null); setEditing(null); }}
            >
              Cancel
            </button>
          </div>
        )}
        <form className="composer" onSubmit={handleSend}>
          <input ref={fileRef} type="file" style={{ display: "none" }} onChange={handleFile} />
          <button
            type="button"
            className="ghost attach"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            title="Send a file"
          >
            {uploading ? "…" : "+"}
          </button>
          <input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              // Typing notice; the SDK rate-limits repeats so per-keystroke is fine.
              if (openRoom) setTyping(openRoom.id, true).catch(() => {});
            }}
            placeholder={editing ? "Edit message…" : "Type a message…"}
            autoFocus
          />
          <button type="submit" disabled={!draft.trim()}>{editing ? "Save" : "Send"}</button>
        </form>
      </div>
    );
  }

  // ---- Inbox ----
  // Muted chats don't contribute to the unread total (that's the point of mute).
  const totalUnread = rooms.reduce((sum, r) => sum + (r.muted ? 0 : Number(r.unread)), 0);
  const accountLabel = new Map(accounts.map((a) => [a.id, a.label]));
  const archivedCount = rooms.filter((r) => r.archived).length;
  const sorted = [...rooms].sort((a, b) => {
    // Pinned chats first, then most recent activity.
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const at = a.last_ts ?? 0;
    const bt = b.last_ts ?? 0;
    if (at !== bt) return bt - at;
    return displayName(a).localeCompare(displayName(b));
  });
  // Archived chats live behind the Archived toggle; otherwise hidden.
  const byArchive = sorted.filter((r) => (showArchived ? r.archived : !r.archived));
  // Per-account filter (null = all accounts).
  const byAccount = accountFilter
    ? byArchive.filter((r) => r.account === accountFilter)
    : byArchive;
  const q = query.trim().toLowerCase();
  const filtered = q
    ? byAccount.filter(
        (r) =>
          displayName(r).toLowerCase().includes(q) ||
          (r.last_message ?? "").toLowerCase().includes(q)
      )
    : byAccount;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">bb</span> beep-beep
        </div>
        <div className="account">
          <SyncPill state={syncState} />
          <span className="muted">{userId}</span>
          <button className="ghost" onClick={addAccount}>+ Account</button>
          <button className="ghost" onClick={() => { acceptAllInvites().catch(() => {}); refreshRooms(); }}>Refresh</button>
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
        placeholder="Search chats… (Enter searches all messages)"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!e.target.value.trim()) setSearchHits(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") runGlobalSearch();
        }}
      />

      {accounts.length > 0 && (
        <div className="account-filter">
          <button
            className={accountFilter === null ? "chip active" : "chip"}
            onClick={() => setAccountFilter(null)}
          >
            All
          </button>
          {accounts.map((a) => (
            <button
              key={a.id}
              className={accountFilter === a.id ? "chip active" : "chip"}
              onClick={() => setAccountFilter(a.id)}
              title={a.id}
            >
              {a.label}
            </button>
          ))}
          {archivedCount > 0 && (
            <button
              className={showArchived ? "chip active" : "chip"}
              onClick={() => setShowArchived((v) => !v)}
            >
              Archived ({archivedCount})
            </button>
          )}
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {searchHits !== null && (
        <div className="hits">
          <div className="hits-head">
            <span className="muted">
              {searchHits.length} message{searchHits.length === 1 ? "" : "s"} matching "{query.trim()}"
            </span>
            <button className="ghost" onClick={() => setSearchHits(null)}>Clear</button>
          </div>
          {searchHits.map((h, i) => (
            <div
              key={i}
              className="hit"
              onClick={() => {
                const room = rooms.find((r) => r.id === h.room_id);
                if (room) openConversation(room);
              }}
            >
              <span className="hit-room">{h.room_name ?? h.sender_name}</span>
              <span className="hit-body">{h.body}</span>
              <span className="room-time">{relTime(h.ts)}</span>
            </div>
          ))}
        </div>
      )}

      <ul className="rooms">
        {rooms.length === 0 && (
          <li className="empty muted">No rooms yet — sync may still be running. Hit Refresh.</li>
        )}
        {rooms.length > 0 && filtered.length === 0 && (
          <li className="empty muted">
            {q ? `No chats match "${query}".` : "No chats for this account."}
          </li>
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
                <span className="room-name">
                  {r.pinned && <span className="flag-tag">PIN</span>}
                  {label}
                  {r.muted && <span className="flag-tag">MUTED</span>}
                  {accounts.length > 1 && r.account && (
                    <span className="acct-tag">{accountLabel.get(r.account) ?? "?"}</span>
                  )}
                </span>
                {!joined ? (
                  <span className="room-preview">Tap to accept invite</span>
                ) : (
                  r.last_message && <span className="room-preview">{r.last_message}</span>
                )}
              </div>
              <span className="row-actions" onClick={(e) => e.stopPropagation()}>
                <button type="button" onClick={() => toggleRoomFlag(r, "pin")}>
                  {r.pinned ? "Unpin" : "Pin"}
                </button>
                <button type="button" onClick={() => toggleRoomFlag(r, "mute")}>
                  {r.muted ? "Unmute" : "Mute"}
                </button>
                <button type="button" onClick={() => toggleRoomFlag(r, "archive")}>
                  {r.archived ? "Unarch" : "Arch"}
                </button>
              </span>
              <div className="room-meta">
                {!joined && <span className="badge invite">Invite</span>}
                {joined && r.last_ts != null && <span className="room-time">{relTime(r.last_ts)}</span>}
                {joined && r.unread > 0 && (
                  <span className={r.muted ? "badge dim" : "badge"}>{Number(r.unread)}</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Typed wrappers around the Rust command surface (see src-tauri/src/matrix.rs).
//
// This is the ONLY place the frontend talks to the Rust core. Everything goes
// through Tauri's `invoke()`. The bound types are GENERATED from Rust by ts-rs
// (see src/bindings/) — never edit those by hand; regenerate with `cargo test`.

import { invoke } from "@tauri-apps/api/core";
import type { RoomSummary } from "./bindings/RoomSummary";
import type { ChatLine } from "./bindings/ChatLine";
import type { Account } from "./bindings/Account";
import type { SearchHit } from "./bindings/SearchHit";
import type { RestoreOutcome } from "./bindings/RestoreOutcome";

/** Log in to a homeserver. Returns the full Matrix user id (@you:server). */
export async function login(
  homeserver: string,
  username: string,
  password: string
): Promise<string> {
  return invoke<string>("login", { homeserver, username, password });
}

/**
 * Try to restore a saved session on launch. Returns a `RestoreOutcome` telling
 * apart "restored" (with user_id), "none" (no saved session), and "expired" (the
 * saved session was rejected by the server) — so the login screen can show the
 * "session expired" message only in the last case.
 */
export async function restoreSession(): Promise<RestoreOutcome> {
  return invoke<RestoreOutcome>("restore_session");
}

/** Fetch the current room list. */
export async function listRooms(): Promise<RoomSummary[]> {
  return invoke<RoomSummary[]>("list_rooms");
}

/** Fetch the connected accounts (WhatsApp logins) for the per-account filter. */
export async function listAccounts(): Promise<Account[]> {
  return invoke<Account[]>("list_accounts");
}

/** Log out and drop the session. */
export async function logout(): Promise<void> {
  return invoke<void>("logout");
}

/**
 * Fetch recent text messages for a room, oldest-first, via a one-off server
 * `/messages` fetch. Used by search-result preview / the manual Refresh — the
 * OPEN conversation is driven live by `openRoomTimeline` instead (no polling).
 */
export async function roomMessages(roomId: string, limit = 50): Promise<ChatLine[]> {
  return invoke<ChatLine[]>("room_messages", { roomId, limit });
}

/**
 * Open a live SDK Timeline for a room. The backend emits an initial
 * "timeline-items" event with the current (cache-backed) messages, then re-emits
 * the full list on every change — so the open conversation stays live with no
 * polling and no per-refresh network call. Call `closeRoomTimeline` when leaving.
 */
export async function openRoomTimeline(roomId: string): Promise<void> {
  return invoke<void>("open_room_timeline", { roomId });
}

/** Close the open room's Timeline (retires its live diff stream). */
export async function closeRoomTimeline(): Promise<void> {
  return invoke<void>("close_room_timeline");
}

/**
 * Load older messages in the open room (Timeline backward-pagination). The new
 * messages arrive via the next "timeline-items" emission; the returned boolean is
 * true once the start of the room has been reached (nothing older to load).
 */
export async function paginateRoomTimeline(count = 50): Promise<boolean> {
  return invoke<boolean>("paginate_room_timeline", { count });
}

/**
 * Send a plain-text message through the OPEN Timeline, so it appears instantly as
 * an SDK local echo (pending) and reconciles to confirmed on its own — no manual
 * optimistic bubble. `replyTo` makes it a rich reply. Requires an open timeline.
 */
export async function sendMessageTimeline(body: string, replyTo?: string): Promise<void> {
  return invoke<void>("send_message_timeline", { body, replyTo: replyTo ?? null });
}

/**
 * Send a plain-text message to a room by id (NOT through the open timeline) —
 * used e.g. to kick off the WhatsApp bridge QR login in a room we then open.
 * `replyTo` makes it a rich reply.
 */
export async function sendMessage(roomId: string, body: string, replyTo?: string): Promise<void> {
  return invoke<void>("send_message", { roomId, body, replyTo: replyTo ?? null });
}

/** React to a message with an emoji. */
export async function sendReaction(roomId: string, eventId: string, key: string): Promise<void> {
  return invoke<void>("send_reaction", { roomId, eventId, key });
}

/** Edit one of our messages. */
export async function editMessage(roomId: string, eventId: string, body: string): Promise<void> {
  return invoke<void>("edit_message", { roomId, eventId, body });
}

/** Delete (redact) a message. */
export async function deleteMessage(roomId: string, eventId: string): Promise<void> {
  return invoke<void>("delete_message", { roomId, eventId });
}

/** Mark a room as read (sends a read receipt for its latest event). */
export async function markRead(roomId: string): Promise<void> {
  return invoke<void>("mark_read", { roomId });
}

/** Send or clear a typing notification. Safe to call on every keystroke. */
export async function setTyping(roomId: string, isTyping: boolean): Promise<void> {
  return invoke<void>("typing", { roomId, typing: isTyping });
}

/** Pin/unpin a chat (pinned chats sort first). */
export async function setPinned(roomId: string, pinned: boolean): Promise<void> {
  return invoke<void>("set_pinned", { roomId, pinned });
}

/** Archive/unarchive a chat (hidden behind the Archived filter). */
export async function setArchived(roomId: string, archived: boolean): Promise<void> {
  return invoke<void>("set_archived", { roomId, archived });
}

/** Mute/unmute a chat's notifications. */
export async function setMuted(roomId: string, muted: boolean): Promise<void> {
  return invoke<void>("set_muted", { roomId, muted });
}

/** Send a file/image (bytes as base64) to a room. */
export async function sendMedia(
  roomId: string, filename: string, mimeType: string, dataBase64: string,
): Promise<void> {
  return invoke<void>("send_media", { roomId, filename, mimeType, dataBase64 });
}

/** Full-text search across all chats, server-side. */
export async function searchMessages(query: string, limit = 20): Promise<SearchHit[]> {
  return invoke<SearchHit[]>("search_messages", { query, limit });
}

/** Fetch a room's avatar as a data: URL, or null if it has none. */
export async function roomAvatar(roomId: string): Promise<string | null> {
  return invoke<string | null>("room_avatar", { roomId });
}

/** Fetch a message image (by its opaque MediaSource handle) as a data: URL. */
export async function fetchMedia(source: string): Promise<string> {
  return invoke<string>("fetch_media", { source });
}

/** Accept a pending invite (or re-join a left room). */
export async function joinRoom(roomId: string): Promise<void> {
  return invoke<void>("join_room", { roomId });
}

/** Auto-accept all pending bridge invites so every chat syncs. Returns the count. */
export async function acceptAllInvites(): Promise<number> {
  return invoke<number>("accept_all_invites");
}

/** Subscribe the open room to sliding sync for live updates (retires the poll). */
export async function subscribeRoom(roomId: string): Promise<void> {
  return invoke<void>("subscribe_room", { roomId });
}

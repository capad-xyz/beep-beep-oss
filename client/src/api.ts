// Typed wrappers around the Rust command surface (see src-tauri/src/matrix.rs).
//
// This is the ONLY place the frontend talks to the Rust core. Everything goes
// through Tauri's `invoke()`. The bound types are GENERATED from Rust by ts-rs
// (see src/bindings/) — never edit those by hand; regenerate with `cargo test`.

import { invoke } from "@tauri-apps/api/core";
import type { RoomSummary } from "./bindings/RoomSummary";
import type { ChatLine } from "./bindings/ChatLine";

/** Log in to a homeserver. Returns the full Matrix user id (@you:server). */
export async function login(
  homeserver: string,
  username: string,
  password: string
): Promise<string> {
  return invoke<string>("login", { homeserver, username, password });
}

/** Fetch the current room list. */
export async function listRooms(): Promise<RoomSummary[]> {
  return invoke<RoomSummary[]>("list_rooms");
}

/** Log out and drop the session. */
export async function logout(): Promise<void> {
  return invoke<void>("logout");
}

/** Fetch recent text messages for a room, oldest-first. */
export async function roomMessages(roomId: string, limit = 50): Promise<ChatLine[]> {
  return invoke<ChatLine[]>("room_messages", { roomId, limit });
}

/** Send a plain-text message to a room. */
export async function sendMessage(roomId: string, body: string): Promise<void> {
  return invoke<void>("send_message", { roomId, body });
}

/** Fetch a room's avatar as a data: URL, or null if it has none. */
export async function roomAvatar(roomId: string): Promise<string | null> {
  return invoke<string | null>("room_avatar", { roomId });
}

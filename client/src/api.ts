// Typed wrappers around the Rust command surface (see src-tauri/src/matrix.rs).
//
// This is the ONLY place the frontend talks to the Rust core. Everything goes
// through Tauri's `invoke()`, which serializes args to the Rust command and
// deserializes the result back. The `RoomSummary` type is GENERATED from Rust by
// ts-rs (see src/bindings/) — never edit that type by hand; regenerate it.

import { invoke } from "@tauri-apps/api/core";
import type { RoomSummary } from "./bindings/RoomSummary";

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

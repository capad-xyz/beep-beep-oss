// This file is GENERATED from the Rust `RoomSummary` struct by ts-rs.
// Do not edit by hand — it will be overwritten. Regenerate with `cargo test`
// in src-tauri/ (see client/README.md). It's committed so the frontend
// type-checks before the first Rust build.
export type RoomSummary = {
  id: string;
  name: string | null;
  unread: number;
  is_bridged: boolean;
};

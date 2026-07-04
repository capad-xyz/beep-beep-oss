import type { RoomSummary } from "@/bindings/RoomSummary";

// Formatting/identity helpers moved verbatim from the pre-redesign App.tsx.

const AVATAR_COLORS = [
  "#7b61a8", "#3f7d6b", "#b06b3a", "#4a6ea8",
  "#a8557a", "#5a7d4a", "#8a7a55", "#6b6b73",
];

// Deterministic colour from the room id so each chat keeps a stable avatar.
// Palette comes from the Dispatch spec's sample avatars (muted, paper-friendly).
export function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

// A human label for a room; many DMs/bridged rooms carry no name.
export function displayName(r: RoomSummary): string {
  const n = r.name?.trim();
  return n && n.length > 0 ? n : "Unnamed room";
}

export function initials(label: string): string {
  const words = label.replace(/[^\p{L}\p{N} ]/gu, "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "#";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

// origin_server_ts (ms) -> a short local clock time, e.g. "18:55".
export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Whether two epoch-ms timestamps fall on the same calendar day.
export function sameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

// A day-separator label: "Today" / "Yesterday" / "Mon, Jun 16".
export function formatDay(ms: number): string {
  const now = Date.now();
  if (sameDay(ms, now)) return "Today";
  if (sameDay(ms, now - 86_400_000)) return "Yesterday";
  return new Date(ms).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

// Compact relative time for inbox rows: "now" / "5m" / "3h" / "2d" / "Jun 16".
export function relTime(ms: number): string {
  const mins = Math.floor((Date.now() - ms) / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
}

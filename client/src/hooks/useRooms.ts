import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { RoomSummary } from "@/bindings/RoomSummary";
import type { Account } from "@/bindings/Account";
import {
  listRooms, listAccounts, markRead, setPinned, setArchived, setMuted,
  acceptAllInvites,
} from "@/api";
import { displayName } from "@/lib/format";

export type RoomFilter = "all" | "unread" | "groups" | "archived";

// LIVE INBOX (sliding-sync-native): the backend's room-list task pushes the
// WHOLE mapped list over "room-list" on every sync burst, and the matching
// account list over "accounts" — computed entirely from local SDK state. We
// just replace our arrays (same replace-array model as "timeline-items").
// refreshRooms() is only for the initial paint after login/restore.
export function useRooms(userId: string | null, openRoomId: string | null) {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountFilter, setAccountFilter] = useState<string | null>(null);
  const [filter, setFilter] = useState<RoomFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const openRoomIdRef = useRef<string | null>(null);
  openRoomIdRef.current = openRoomId;

  useEffect(() => {
    if (!userId) {
      setRooms([]);
      setAccounts([]);
      setAccountFilter(null);
      return;
    }
    let alive = true;
    const unlisteners: (() => void)[] = [];
    const track = (p: Promise<() => void>) =>
      p.then((fn) => {
        if (alive) unlisteners.push(fn);
        else fn();
      });

    track(
      listen<RoomSummary[]>("room-list", (e) => {
        setRooms(e.payload);
        // The open conversation is driven live by "timeline-items"; here we only
        // keep the read-receipt current — whatever just arrived in the room
        // we're actively viewing counts as read.
        const cur = openRoomIdRef.current;
        if (cur) markRead(cur).catch(() => {});
      })
    );
    track(
      listen<Account[]>("accounts", (e) => {
        setAccounts(e.payload);
      })
    );

    // Initial paint + auto-accept the bridge's chat/space invites so everything
    // syncs without tapping each one. The inbox then fills in live.
    refreshRooms();
    acceptAllInvites().catch(() => {});

    return () => {
      alive = false;
      unlisteners.forEach((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function refreshRooms() {
    try {
      const [r, a] = await Promise.all([listRooms(), listAccounts()]);
      setRooms(r);
      setAccounts(a);
    } catch (err) {
      setError(String(err));
    }
  }

  // Toggle a room flag (pin/mute/archive) then re-pull so the inbox reflects it.
  async function toggleRoomFlag(r: RoomSummary, kind: "pin" | "mute" | "archive") {
    try {
      if (kind === "pin") await setPinned(r.id, !r.pinned);
      if (kind === "mute") await setMuted(r.id, !r.muted);
      if (kind === "archive") await setArchived(r.id, !r.archived);
      await refreshRooms();
    } catch (err) {
      setError(String(err));
    }
  }

  // Sorted + filtered view of the inbox: pinned first, then recency.
  const visibleRooms = useMemo(() => {
    const sorted = [...rooms].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const at = a.last_ts ?? 0;
      const bt = b.last_ts ?? 0;
      if (at !== bt) return bt - at;
      return displayName(a).localeCompare(displayName(b));
    });
    const byArchive = sorted.filter((r) => (filter === "archived" ? r.archived : !r.archived));
    const byAccount = accountFilter ? byArchive.filter((r) => r.account === accountFilter) : byArchive;
    if (filter === "unread") return byAccount.filter((r) => Number(r.unread) > 0 && !r.muted);
    // Heuristic: bridged group chats and Matrix rooms with a real name read as
    // "groups"; 1:1 WhatsApp portals carry the contact as the room name too, so
    // this is best-effort until the backend exposes member counts.
    if (filter === "groups") return byAccount.filter((r) => !r.is_bridged || (r.name ?? "").length > 24);
    return byAccount;
  }, [rooms, accountFilter, filter]);

  // Muted chats don't contribute to unread totals (that's the point of mute).
  const unreadTotal = useMemo(
    () => rooms.reduce((sum, r) => sum + (r.muted || r.archived ? 0 : Number(r.unread)), 0),
    [rooms]
  );
  const unreadByAccount = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rooms) {
      if (r.muted || r.archived || !r.account) continue;
      m.set(r.account, (m.get(r.account) ?? 0) + Number(r.unread));
    }
    return m;
  }, [rooms]);
  const archivedCount = useMemo(() => rooms.filter((r) => r.archived).length, [rooms]);

  return {
    rooms, accounts, visibleRooms,
    accountFilter, setAccountFilter,
    filter, setFilter,
    unreadTotal, unreadByAccount, archivedCount,
    refreshRooms, toggleRoomFlag,
    error, clearError: () => setError(null),
  };
}

import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { RoomSummary } from "@/bindings/RoomSummary";
import type { ChatLine } from "@/bindings/ChatLine";
import {
  openRoomTimeline, closeRoomTimeline, paginateRoomTimeline,
  sendMessageTimeline, toggleReaction, editMessage, deleteMessage,
  markRead, setTyping, sendMedia, joinRoom, subscribeRoom,
} from "@/api";

// Everything about the open conversation: the SDK Timeline lifecycle, live
// "timeline-items"/"typing" listeners, composing (send/reply/edit), reactions,
// deletion, pagination, and attachments. The backend drives an SDK Timeline for
// the open room and emits "timeline-items" (the full mapped message list) on
// every change — no polling, and sent messages reconcile via SDK local echo.
export function useTimeline(userId: string | null, onRoomJoined?: () => void) {
  const [openRoom, setOpenRoom] = useState<RoomSummary | null>(null);
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null); // timeline failed to build
  const [actionError, setActionError] = useState<string | null>(null); // send/edit/react failures
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reachedStart, setReachedStart] = useState(false);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<ChatLine | null>(null);
  const [editing, setEditing] = useState<ChatLine | null>(null);
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  // Latest open room, readable from listeners without re-subscribing.
  const openRoomRef = useRef<RoomSummary | null>(null);
  openRoomRef.current = openRoom;

  // Live message list for the open room. Guarded on room_id so a late emission
  // from a room we've left is ignored.
  useEffect(() => {
    if (!openRoom) return;
    const roomId = openRoom.id;
    let alive = true;
    let unlisten: (() => void) | undefined;
    listen<{ room_id: string; lines: ChatLine[] }>("timeline-items", (e) => {
      if (!alive) return;
      if (e.payload.room_id !== roomId) return;
      setMessages(e.payload.lines);
      setLoadingMsgs(false);
    }).then((fn) => {
      if (alive) unlisten = fn;
      else fn();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [openRoom]);

  // Live "X is typing…" for the open room.
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

  // Signed out: drop all open-room state.
  useEffect(() => {
    if (!userId) {
      setOpenRoom(null);
      setMessages([]);
      setOpenError(null);
      setActionError(null);
      setDraft("");
      setReplyTo(null);
      setEditing(null);
    }
  }, [userId]);

  async function openConversation(room: RoomSummary) {
    // Invited (bridge "ghost") rooms can't be read until accepted — accept first.
    if (room.membership === "invited") {
      try {
        await joinRoom(room.id);
        onRoomJoined?.();
      } catch (err) {
        setActionError(String(err));
        return;
      }
    }
    setOpenRoom(room);
    // Stream this room live via sliding sync (so its events reach the client),
    // then open its SDK Timeline: the invoke RESOLVES WITH the cache-backed
    // history (no event race), and every subsequent change arrives via the
    // "timeline-items" listener above. Do not change this contract.
    subscribeRoom(room.id).catch(() => {});
    setMessages([]);
    setOpenError(null);
    setActionError(null);
    setReplyTo(null);
    setEditing(null);
    setReachedStart(false);
    setLoadingMsgs(true);
    openRoomTimeline(room.id)
      .then((lines) => {
        // The user may have switched rooms while the timeline was being built.
        if (openRoomRef.current?.id !== room.id) return;
        // A live "timeline-items" emission can beat this resolution; it carries
        // the same-or-fresher full list, so never clobber a non-empty one.
        setMessages((cur) => (cur.length > 0 ? cur : lines));
        setLoadingMsgs(false);
      })
      .catch((err) => {
        if (openRoomRef.current?.id !== room.id) return;
        setOpenError(String(err));
        setLoadingMsgs(false);
      });
    // Opening a chat reads it: clears our unread badge + shows read ticks.
    markRead(room.id).catch(() => {});
  }

  // Retry after a failed timeline build (openError state).
  function retryOpen() {
    const room = openRoomRef.current;
    if (room) openConversation(room);
  }

  // Leaving the conversation: close the backend Timeline so its live diff
  // stream retires. Used by the back affordance and Esc alike.
  function closeConversation() {
    closeRoomTimeline().catch(() => {});
    setOpenRoom(null);
    setOpenError(null);
    setActionError(null);
  }

  // Paginate the open Timeline backwards. Older messages arrive via the next
  // "timeline-items" emission; we only track whether we hit the start.
  async function loadOlder() {
    if (loadingOlder || reachedStart) return;
    setLoadingOlder(true);
    try {
      const done = await paginateRoomTimeline(50);
      setReachedStart(done);
    } catch {
      /* best-effort; leave the control for a retry */
    } finally {
      setLoadingOlder(false);
    }
  }

  async function send() {
    const body = draft.trim();
    const room = openRoomRef.current;
    if (!room || !userId || !body) return;
    setDraft("");
    setTyping(room.id, false).catch(() => {});

    // Edit mode: replace the target message's text. No manual refetch — the open
    // Timeline folds the m.replace into the target item and re-emits.
    if (editing?.event_id) {
      const target = editing;
      setEditing(null);
      try {
        await editMessage(room.id, target.event_id!, body);
      } catch (err) {
        setActionError(String(err));
        setDraft(body);
      }
      return;
    }

    const inReplyTo = replyTo?.event_id ?? undefined;
    setReplyTo(null);
    // Send THROUGH the Timeline: the SDK adds the message as a local echo
    // instantly (pending:true, no event id), then reconciles on its own.
    try {
      await sendMessageTimeline(body, inReplyTo);
    } catch (err) {
      setActionError(String(err));
      setDraft(body);
    }
  }

  async function react(m: ChatLine, key: string) {
    const room = openRoomRef.current;
    if (!room || !m.event_id) return;
    try {
      // No refetch: the Timeline aggregates the reaction and re-emits.
      await toggleReaction(room.id, m.event_id, key);
    } catch (err) {
      setActionError(String(err));
    }
  }

  async function removeMessage(m: ChatLine) {
    const room = openRoomRef.current;
    if (!room || !m.event_id) return;
    try {
      // No refetch: the Timeline reflects the redaction via a diff.
      await deleteMessage(room.id, m.event_id);
    } catch (err) {
      setActionError(String(err));
    }
  }

  function updateDraft(text: string) {
    setDraft(text);
    // Typing notice; the SDK rate-limits repeats so per-keystroke is fine.
    const room = openRoomRef.current;
    if (room) setTyping(room.id, true).catch(() => {});
  }

  // Attach a file: read it as base64 and hand it to the send queue. The upload
  // lands as an event in the open Timeline, which re-emits "timeline-items".
  async function attachFile(file: File) {
    const room = openRoomRef.current;
    if (!room) return;
    setUploading(true);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result as string);
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(file);
      });
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      await sendMedia(room.id, file.name, file.type || "application/octet-stream", base64);
    } catch (err) {
      setActionError(String(err));
    } finally {
      setUploading(false);
    }
  }

  return {
    openRoom, messages, loadingMsgs, openError, actionError,
    loadingOlder, reachedStart,
    draft, updateDraft, setDraft,
    replyTo, setReplyTo, editing, setEditing,
    typingNames, uploading,
    openConversation, closeConversation, retryOpen,
    loadOlder, send, react, removeMessage, attachFile,
    clearActionError: () => setActionError(null),
  };
}

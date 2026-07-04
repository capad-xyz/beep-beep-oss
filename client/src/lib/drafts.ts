// Per-room composer drafts, persisted to localStorage.
//
// Two payoffs: (1) switching rooms no longer loses (or bleeds) what you were
// typing — each room keeps its own draft; (2) a draft survives an app restart,
// which is what makes recovery from a cache-poisoning panic NON-destructive
// (see DegradedBanner / panic_guard) — you can restart to refresh and your
// half-typed message is still there.

const KEY = "dispatch.drafts.v1";

function loadAll(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function saveAll(all: Record<string, string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* quota exceeded / private mode — drafts just won't persist this session */
  }
}

export function loadDraft(roomId: string): string {
  return loadAll()[roomId] ?? "";
}

/** Persist a room's draft; empty text removes the entry. */
export function saveDraft(roomId: string, text: string): void {
  const all = loadAll();
  if (text) all[roomId] = text;
  else delete all[roomId];
  saveAll(all);
}

// A Map with a hard size cap and least-recently-used eviction. The avatar/media
// caches hold resolved data: URLs (base64 blobs) keyed by room id / media handle;
// uncapped they grow for the app's lifetime — a slow leak that scales with how
// many rooms/images you scroll past. Every read or write marks the key
// most-recently-used (delete + re-set moves it to the end of Map's insertion
// order); past `max` we drop the oldest key. ~200 entries covers the visible
// inbox + recently-opened chats while bounding memory.
export class LruMap<K, V> {
  private m = new Map<K, V>();
  constructor(private max: number) {}
  get(k: K): V | undefined {
    const v = this.m.get(k);
    if (v !== undefined && this.m.delete(k)) this.m.set(k, v); // touch → most-recent
    return v;
  }
  has(k: K): boolean {
    return this.m.has(k);
  }
  set(k: K, v: V): void {
    if (this.m.has(k)) this.m.delete(k); // reinsert so it counts as most-recent
    this.m.set(k, v);
    if (this.m.size > this.max) {
      const oldest = this.m.keys().next().value; // first inserted = least-recent
      if (oldest !== undefined) this.m.delete(oldest);
    }
  }
  delete(k: K): boolean {
    return this.m.delete(k);
  }
}

// Session-lifetime cache of resolved avatar data: URLs, keyed by room id.
// `null` = fetched but the room has no avatar (don't refetch); `undefined` = not fetched yet.
export const avatarCache = new LruMap<string, string | null>(200);
export const avatarInflight = new Map<string, Promise<string | null>>();

// Session cache of resolved message-image data: URLs, keyed by the media handle.
// LRU-capped — image blobs are the heavier of the two caches.
export const mediaCache = new LruMap<string, string>(200);

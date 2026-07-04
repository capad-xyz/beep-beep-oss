import { useEffect, useState } from "react";
import { roomAvatar } from "@/api";
import { avatarCache, avatarInflight } from "@/lib/lru";
import { avatarColor, initials } from "@/lib/format";

// Inbox avatar: shows initials immediately, then swaps to the room's real
// (WhatsApp) picture once room_avatar resolves. Fetches at most once per room id.
export function RoomAvatar({ id, label, size = 46 }: { id: string; label: string; size?: number }) {
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

  const px = { width: size, height: size };
  if (src) {
    return (
      <span className="flex flex-none items-center justify-center overflow-hidden rounded-full" style={px}>
        <img src={src} alt="" className="h-full w-full object-cover" />
      </span>
    );
  }
  return (
    <span
      className="flex flex-none items-center justify-center rounded-full font-semibold text-white"
      style={{ ...px, background: avatarColor(id), fontSize: Math.round(size * 0.33) }}
    >
      {initials(label)}
    </span>
  );
}

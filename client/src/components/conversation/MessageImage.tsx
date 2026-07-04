import { useEffect, useState } from "react";
import { fetchMedia } from "@/api";
import { mediaCache } from "@/lib/lru";

// Lazily fetches and renders an image message (e.g. the WhatsApp bridge QR),
// so opening a chat doesn't block on downloading every picture up front.
export function MessageImage({ source, alt }: { source: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(() => mediaCache.get(source) ?? null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const cached = mediaCache.get(source);
    if (cached) { setSrc(cached); return; }
    let alive = true;
    fetchMedia(source)
      .then((url) => { mediaCache.set(source, url); if (alive) setSrc(url); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [source]);
  if (failed) return <span className="text-[13px] text-mut">[image unavailable]</span>;
  if (!src) return <span className="text-[13px] text-mut">Loading image…</span>;
  return <img className="max-h-[360px] max-w-full rounded-md" src={src} alt={alt} />;
}

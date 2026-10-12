// Whether an element is narrower than `limit` pixels, kept current as it is
// resized. Where the browser cannot watch sizes (a test), it is never narrow.

import { useEffect, useState, type RefObject } from "react";

export function useNarrow(ref: RefObject<HTMLElement | null>, limit = 640): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(([entry]) => setNarrow((entry?.contentRect.width ?? limit) < limit));
    watch.observe(el);
    return () => watch.disconnect();
  }, [ref, limit]);
  return narrow;
}

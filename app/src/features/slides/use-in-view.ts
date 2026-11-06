// Whether a card is near the window, so its thumbnail is drawn only then: a vault of a hundred decks opens as fast as one of ten.

import { type RefObject, useEffect, useState } from "react";

/** How far outside the scrolling area a card still counts as in view, so its picture is there before it is scrolled to. */
const MARGIN = "240px";

/**
 * True while the element is inside, or just outside, the scrolling area. Where the window cannot tell (no IntersectionObserver) every
 * card counts as in view, which is the old behaviour: all of them are drawn.
 */
export function useInView(target: RefObject<Element | null>): boolean {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const element = target.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const watcher = new IntersectionObserver((entries) => setSeen(entries[entries.length - 1]?.isIntersecting ?? false), { rootMargin: MARGIN });
    watcher.observe(element);
    return () => watcher.disconnect();
  }, [target]);
  return seen;
}

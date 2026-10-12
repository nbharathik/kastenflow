import { type JSX, type RefObject, useLayoutEffect, useRef } from "react";

import type { Drag } from "./reorder.ts";
import "./thumb.css";

/** The most thumbnails drawn in the hand, stacked; a handful of slides is a pile, and the count says how many. */
const PILE = 3;
/** How far each thumbnail of the pile stands off the one above it, in pixels. */
const STEP = 5;

/** The copies of the thumbnails, stacked with the first on top. They are copies of what the filmstrip drew, so nothing is drawn again. */
function Pile({ frames }: { frames: readonly HTMLElement[] }): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const shown = frames.slice(0, PILE);
    const first = shown[0];
    element.style.width = first?.style.width ? `calc(${first.style.width} + ${(shown.length - 1) * STEP}px)` : "";
    element.style.height = first?.style.height ? `calc(${first.style.height} + ${(shown.length - 1) * STEP}px)` : "";
    // Appended from the back, so that the first slide is the one on top.
    element.replaceChildren(
      ...[...shown].reverse().map((frame, i) => {
        const card = document.createElement("div");
        card.className = "ks-drag-card";
        card.style.setProperty("--n", String(shown.length - 1 - i));
        card.append(frame);
        return card;
      }),
    );
  }, [frames]);
  return <div ref={host} className="ks-drag-pile" />;
}

/**
 * What is in the hand while slides are dragged: their thumbnails, stacked, held where the pointer took hold of them, and the
 * number of them when there are several. It follows the pointer (the drag moves it); the view puts it down where the slides land.
 */
export function DragBadge({ drag, badge }: { drag: Drag | null; badge: RefObject<HTMLDivElement | null> }): JSX.Element | null {
  if (!drag) return null;
  const several = drag.ids.length > 1;
  const pile = drag.frames.length > 0;
  if (!several && !pile) return null;
  return (
    <div ref={badge} className={`ks-drag-ghost${pile ? " has-pile" : ""}${drag.copy ? " is-copy" : ""}`} aria-hidden="true">
      {pile ? <Pile frames={drag.frames} /> : null}
      {several ? <div className="ks-drag-badge">{drag.ids.length} slides</div> : null}
      {/* Alt or Ctrl is held: what is put down is a copy. */}
      {drag.copy ? <div className="ks-drag-copy">+</div> : null}
    </div>
  );
}

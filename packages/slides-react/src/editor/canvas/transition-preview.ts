// Playing a transition once on the canvas, so that picking one in the Transition dialog shows what it does. It
// is only a picture on the way to the slide as it is: nothing in the deck changes. The slide is drawn as it
// stands; the browser's animations move it (or, for Morph, the elements it shares with the slide before) to
// where it is. With the host's motion off, or in a browser that cannot animate, nothing plays.

import type { Element as DeckElement, Slide, Theme, TransitionKind } from "@kasten-slides/wasm";

import { boxOf } from "../../theme/index.ts";
import { play } from "../motion.ts";

/** How far a slide comes in from, as a share of its own width, for the slide transition. */
const FROM_SIDE = "30%";
const EASING = "cubic-bezier(0.2, 0, 0, 1)";

/** What Morph pairs an element by: its `morphId`, or its id. */
const keyOf = (element: DeckElement): string => element.morphId ?? element.id;

/**
 * Plays `kind` over `seconds` on the element that holds the slide (`root`). `before` is the slide it arrives from; Morph moves
 * the elements the two share, and fades in the rest. Answers the animations started, so the caller can stop them.
 */
export function playTransition(root: HTMLElement, kind: TransitionKind, seconds: number, before: Slide | null, slide: Slide, theme: Theme): Animation[] {
  const duration = Math.max(seconds, 0) * 1000;
  if (kind === "none" || duration === 0) return [];
  const started: Animation[] = [];
  const add = (node: Element, keyframes: Keyframe[]): void => {
    const animation = play(node, keyframes, { duration, easing: EASING });
    if (animation) started.push(animation);
  };
  if (kind === "fade") {
    add(root, [{ opacity: 0 }, { opacity: 1 }]);
  } else if (kind === "slide") {
    add(root, [{ translate: `${FROM_SIDE} 0`, opacity: 0 }, { translate: "0 0", opacity: 1 }]);
  } else {
    // Morph: elements that are in both slides go from their old box to their new one, and the others appear.
    const was = new Map((before?.elements ?? []).map((element) => [keyOf(element), boxOf(theme, before!.layout, element)]));
    let paired = 0;
    for (const element of slide.elements) {
      const node = root.querySelector(`[data-el="${element.id}"]`);
      if (!node) continue;
      const from = was.get(keyOf(element));
      const to = boxOf(theme, slide.layout, element);
      if (from && to && to.w > 0 && to.h > 0) {
        paired += 1;
        if (Math.abs(from.x - to.x) + Math.abs(from.y - to.y) + Math.abs(from.w - to.w) + Math.abs(from.h - to.h) < 0.5) continue;
        add(node, [
          { translate: `${from.x - to.x}px ${from.y - to.y}px`, scale: `${from.w / to.w} ${from.h / to.h}`, transformOrigin: "0 0" },
          { translate: "0 0", scale: "1 1", transformOrigin: "0 0" },
        ]);
      } else {
        add(node, [{ opacity: 0 }, { opacity: 1 }]);
      }
    }
    // Nothing in common to move: a morph of that is a fade.
    if (paired === 0) add(root, [{ opacity: 0 }, { opacity: 1 }]);
  }
  return started;
}

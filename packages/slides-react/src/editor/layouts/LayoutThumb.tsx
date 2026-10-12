import type { Deck, Layout } from "@kasten-slides/wasm";
import { type JSX, memo, useEffect, useMemo, useRef, useState } from "react";

import type { ImageUrl } from "../../render/index.ts";
import { thumbHeight } from "../filmstrip/model.ts";
import { SlideThumb } from "../filmstrip/SlideThumb.tsx";
import { sampleSlide } from "./sample.ts";
import "./layouts.css";

/** Whether the element has come into view. Where nothing can tell (a test, an old browser) it has: everything is drawn at once. */
function useShown(): [boolean, (element: HTMLElement | null) => void] {
  const [shown, setShown] = useState(typeof IntersectionObserver === "undefined");
  const watcher = useRef<IntersectionObserver | null>(null);
  useEffect(() => () => watcher.current?.disconnect(), []);
  return [
    shown,
    (element) => {
      watcher.current?.disconnect();
      watcher.current = null;
      if (!element || shown || typeof IntersectionObserver === "undefined") return;
      watcher.current = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            setShown(true);
            watcher.current?.disconnect();
          }
        },
        { rootMargin: "120px" },
      );
      watcher.current.observe(element);
    },
  ];
}

export interface LayoutThumbProps {
  /** What the layout is drawn with: its theme (master, colours, type), the slide's size and the slide-number setting. */
  deck: Deck;
  layout: Layout;
  /** The width it is drawn at, in CSS pixels. */
  width: number;
  imageUrl: ImageUrl;
}

/**
 * A layout as a small slide: drawn by the same renderer as the editor, with the deck's own theme, the layout's decoration and
 * background, and its slots holding a word or two. It is drawn when it comes into view, so a list of fifty layouts costs what is shown.
 */
export const LayoutThumb = memo(function LayoutThumb({ deck, layout, width, imageUrl }: LayoutThumbProps): JSX.Element {
  const slide = useMemo(() => sampleSlide(layout), [layout]);
  const [shown, watch] = useShown();
  return (
    <span ref={watch} className="ks-lt" style={{ width, height: thumbHeight(deck.size, width) }} aria-hidden="true">
      {shown ? <SlideThumb deck={deck} slide={slide} number={1} count={1} width={width} imageUrl={imageUrl} /> : null}
    </span>
  );
});

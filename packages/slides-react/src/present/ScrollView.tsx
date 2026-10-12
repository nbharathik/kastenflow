// The deck as one page that scrolls: every slide as it ends, one under the other, with its speaker notes under it. It is
// what a person reads, and the handout of the exported web page (`?view=scroll`).

import type { Deck, Slide } from "@kasten-slides/wasm";
import { type CSSProperties, type JSX, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

import { SlideView } from "../render/index.ts";
import type { ImageUrl } from "../render/index.ts";
import { Notes } from "./notes.tsx";
import { pageTheme } from "./page-theme.ts";
import { planOf, stepsOf } from "./plan.ts";
import "./scroll.css";

/** A slide at the width of its frame: the frame's height follows, and the slide is scaled to fit. */
export function Scaled({ deck, children }: { deck: Deck; children: ReactNode }): JSX.Element {
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const node = frame.current;
    if (!node) return;
    const measure = () => setScale(node.clientWidth > 0 ? node.clientWidth / deck.size.w : 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(measure);
    watch.observe(node);
    return () => watch.disconnect();
  }, [deck.size.w]);
  return (
    <div ref={frame} className="ks-show-scroll-frame" style={{ aspectRatio: `${deck.size.w} / ${deck.size.h}`, "--ks-ratio": deck.size.w / Math.max(deck.size.h, 1) } as CSSProperties}>
      <div className="ks-show-scroll-slide" style={{ width: deck.size.w, height: deck.size.h, transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}

export interface ScrollViewProps {
  deck: Deck;
  imageUrl: ImageUrl;
  /** Leaves the view: a button and Esc do it. Without it the page just scrolls. */
  onExit?: (() => void) | undefined;
}

export function ScrollView({ deck, imageUrl, onExit }: ScrollViewProps): JSX.Element {
  const plan = planOf(deck);
  const rows = plan.columns.flatMap((column) => column.slides);
  const page = useRef<HTMLDivElement>(null);
  // As the editor or the app is, else as the system is (the style sheet decides).
  const [theme] = useState(() => pageTheme());

  useEffect(() => {
    if (!onExit) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onExit();
    };
    window.addEventListener("keydown", key);
    page.current?.focus({ preventScroll: true });
    return () => window.removeEventListener("keydown", key);
  }, [onExit]);

  return (
    <div ref={page} className={onExit ? "ks-show-scroll is-overlay" : "ks-show-scroll"} data-theme={theme} tabIndex={-1} role="document" aria-label={`${deck.title}, all slides`}>
      <header className="ks-show-scroll-head">
        <h1>{deck.title}</h1>
        <p>{plan.count === 1 ? "1 slide" : `${plan.count} slides`}</p>
        {onExit ? (
          <button type="button" className="ks-show-scroll-close" onClick={onExit}>
            Close
          </button>
        ) : null}
      </header>
      {rows.map((slide: Slide) => (
        <article key={slide.id} className="ks-show-scroll-item" data-slide={slide.id}>
          <h2 className="ks-show-scroll-label">
            Slide {plan.numbers.get(slide.id)}
            {slide.backup ? <span className="ks-show-scroll-badge">Backup</span> : null}
          </h2>
          <Scaled deck={deck}>
            <SlideView deck={deck} slide={slide} number={plan.numbers.get(slide.id) ?? 0} count={plan.count} step={stepsOf(slide) > 0 ? stepsOf(slide) : undefined} mode="present" imageUrl={imageUrl} />
          </Scaled>
          {slide.notes && slide.notes.trim() !== "" ? <Notes markdown={slide.notes} /> : null}
        </article>
      ))}
    </div>
  );
}

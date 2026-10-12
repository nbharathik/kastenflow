import { SlideView } from "@kasten-slides/react";
import type { Deck } from "@kasten-slides/wasm";
import { memo, useLayoutEffect, useRef, useState } from "react";

import { fileUrl } from "../../lib/vault/file-url";

const imageUrl = (path: string) => fileUrl(path) ?? undefined;

/**
 * How a thumbnail sits in its space:
 * - `wide` (the default) a 16:9 frame at the width it is given;
 * - `fill` the whole box of its parent, whatever its shape;
 * - `deck` the deck's own shape, at the width it is given.
 * In the first two the slide is shown whole and centred on a matte, so a 4:3 or square deck
 * sits in the same frame as a 16:9 one and cards of any deck line up.
 */
export type ThumbFrame = "wide" | "fill" | "deck";

/** A slide of a deck (the first unless `index` says another), drawn to fit its frame. */
export const DeckThumb = memo(function DeckThumb({ deck, index = 0, frame = "wide" }: { deck: Deck | null; index?: number; frame?: ThumbFrame }) {
  const box = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const read = () => setRoom({ w: element.clientWidth, h: element.clientHeight });
    read();
    const watcher = new ResizeObserver(read);
    watcher.observe(element);
    return () => watcher.disconnect();
  }, []);
  const slide = deck?.slides[Math.min(index, (deck?.slides.length ?? 1) - 1)];
  const own = frame === "deck" && deck ? `${deck.size.w} / ${deck.size.h}` : "16 / 9";
  // The frame's height follows from its width unless the parent sets it (`fill`).
  const wide = room.w;
  const high = frame === "fill" ? room.h : wide * (frame === "deck" && deck ? deck.size.h / deck.size.w : 9 / 16);
  const scale = deck && wide > 0 && high > 0 ? Math.min(wide / deck.size.w, high / deck.size.h) : 0;
  const left = deck ? (wide - deck.size.w * scale) / 2 : 0;
  const top = deck ? (high - deck.size.h * scale) / 2 : 0;
  return (
    <div
      ref={box}
      className={`relative overflow-hidden ${frame === "fill" ? "size-full" : "w-full"} ${frame === "deck" ? "bg-canvas" : "bg-well"}`}
      style={frame === "fill" ? undefined : { aspectRatio: own }}
      aria-hidden="true"
    >
      {!deck || !slide ? (
        <div className="grid size-full place-items-center text-12 text-muted">{deck ? "Empty deck" : ""}</div>
      ) : scale > 0 ? (
        <div style={{ width: deck.size.w, height: deck.size.h, transform: `translate(${left}px, ${top}px) scale(${scale})`, transformOrigin: "0 0" }}>
          <SlideView deck={deck} slide={slide} number={deck.slides.indexOf(slide) + 1} count={deck.slides.length} mode="thumbnail" imageUrl={imageUrl} />
        </div>
      ) : null}
    </div>
  );
});

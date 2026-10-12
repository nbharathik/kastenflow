import { HANDLES, type Handle, type Item, type Rect } from "@kasten-slides/canvas";
import type { Element } from "@kasten-slides/wasm";
import { useRef } from "react";

import type { Preview } from "./controller.ts";
import { OUTLINE_LIMIT } from "./live-math.ts";
import { MoveHandles } from "./MoveHandle.tsx";

interface OverlayProps {
  /** Pixels on screen per slide unit. */
  zoom: number;
  /** The selected elements, where the slide has them: a drag in progress moves the frame round them by writing to it (see `live.ts`), not by drawing it again. */
  selected: readonly { item: Item; element: Element }[];
  /** The box round several selected elements. */
  group: Rect | null;
  hovered: Item | null;
  /** The boxes of the groups the person went into, outermost first. */
  entered: readonly Rect[];
  /** What the pointer is doing to the slide; the parts of the overlay that step aside change with it. */
  gesture: Preview["gesture"];
  /** The select tool is in hand, which is when the move handles are there to be grabbed. */
  active: boolean;
}

const CURSORS: Record<Handle, string> = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };
const AT: Record<Handle, [string, string]> = {
  nw: ["0%", "0%"],
  n: ["50%", "0%"],
  ne: ["100%", "0%"],
  e: ["100%", "50%"],
  se: ["100%", "100%"],
  s: ["50%", "100%"],
  sw: ["0%", "100%"],
  w: ["0%", "50%"],
};

const px = (n: number, zoom: number) => n * zoom;

/** The style of the frame of a box, in screen pixels from the top left of the slide. */
export function frame(item: { x: number; y: number; w: number; h: number; rotation?: number }, zoom: number) {
  return { left: px(item.x, zoom), top: px(item.y, zoom), width: px(item.w, zoom), height: px(item.h, zoom), transform: item.rotation ? `rotate(${item.rotation}deg)` : undefined } as const;
}

/**
 * The cursor for a handle on a box turned by `rotation` degrees: the arrow points along the way the handle pulls, which
 * turns with the box, so a handle that is a top left corner on an upright box is a different kind of arrow on a box turned a
 * quarter way round.
 */
export function cursorFor(handle: Handle, rotation: number): string {
  if (!rotation) return CURSORS[handle];
  // The eight directions go round the box in 45 degree steps from north.
  const order: Handle[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
  const step = Math.round((((rotation % 360) + 360) % 360) / 45);
  const turned = order[(order.indexOf(handle) + step) % 8] as Handle;
  return CURSORS[turned];
}

function Handles({ rotate, rotation }: { rotate: boolean; rotation: number }) {
  return (
    <>
      {HANDLES.map((handle) => {
        const [left, top] = AT[handle];
        return <span key={handle} className="ks-handle" data-handle={handle} style={{ left, top, cursor: cursorFor(handle, rotation) }} />;
      })}
      {rotate ? (
        <>
          <span className="ks-rotate-stem" />
          <span className="ks-handle ks-rotate" data-rotate="" />
        </>
      ) : null}
    </>
  );
}

/** A line's own two ends, where its box runs from top left to bottom right unless flipped. */
function Ends({ item, element, zoom }: { item: Item; element: Element; zoom: number }) {
  const fh = element.flipH ?? false;
  const fv = element.flipV ?? false;
  const dot = (end: "start" | "end", x: number, y: number) => <span key={end} className="ks-handle ks-end" data-end={end} data-chrome="" style={{ left: px(x, zoom), top: px(y, zoom) }} />;
  return (
    <>
      {dot("start", fh ? item.x + item.w : item.x, fv ? item.y + item.h : item.y)}
      {dot("end", fh ? item.x : item.x + item.w, fv ? item.y : item.y + item.h)}
    </>
  );
}

/**
 * The outline of the element under the pointer. It stays in the page once it has been shown and fades in and out, so that
 * moving over the slide is soft; it keeps the box it was last given while it fades.
 */
function HoverFrame({ item, zoom }: { item: Item | null; zoom: number }) {
  const last = useRef<Item | null>(null);
  if (item) last.current = item;
  const shown = item ?? last.current;
  if (!shown) return null;
  return <div className={`ks-outline is-hover${item ? " is-on" : ""}`} style={frame(shown, zoom)} />;
}

/**
 * Everything drawn over the slide that is not the slide and does not change with each step of the pointer: outlines,
 * handles and the chip that moves a block. Sized in screen pixels so lines and handles stay crisp at any zoom. What changes as
 * a gesture goes on (the guides, the selection rectangle, the readouts) is the gesture layer's; the frames here are written
 * to, in the same event as the slide, by `live.ts`.
 */
export function Overlay({ zoom, selected, group, hovered, entered, gesture, active }: OverlayProps) {
  const only = selected.length === 1 ? selected[0] : undefined;
  const isLine = only?.element.type === "line" || only?.element.type === "connector";
  const locked = selected.length > 0 && selected.every(({ item }) => item.locked);
  // A great many outlines say nothing the box round them does not, and cost a drawing each.
  const outlined = selected.length <= OUTLINE_LIMIT ? selected : [];
  return (
    <div className="ks-overlay" aria-hidden="true" data-gesture={gesture ?? undefined}>
      {entered.map((box, i) => (
        <div key={`in-${i}`} className="ks-outline is-entered" style={frame(box, zoom)} />
      ))}
      <HoverFrame item={hovered && !selected.some(({ item }) => item.id === hovered.id) ? hovered : null} zoom={zoom} />
      {outlined.map(({ item }) => (
        <div key={item.id} className={`ks-outline${item.locked ? " is-locked" : ""}${selected.length > 1 ? " is-member" : ""}`} data-frame={item.id} data-chrome="" style={frame(item, zoom)}>
          {only && !isLine && !item.locked ? <Handles rotate rotation={item.rotation ?? 0} /> : null}
        </div>
      ))}
      {only && isLine && !only.item.locked ? <Ends item={only.item} element={only.element} zoom={zoom} /> : null}
      {group && selected.length > 1 && !locked ? (
        <div className="ks-outline is-group" data-frame="*" data-chrome="" style={frame(group, zoom)}>
          <Handles rotate rotation={0} />
        </div>
      ) : null}
      <MoveHandles zoom={zoom} selected={selected.map(({ item }) => item)} group={group} hovered={hovered} gesture={gesture} active={active} />
    </div>
  );
}

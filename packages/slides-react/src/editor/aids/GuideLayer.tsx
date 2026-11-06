import type { Guide, Guides } from "@kasten-slides/wasm";
import { type JSX, type PointerEvent, useRef, useState } from "react";

import type { EditorSession } from "../session/session.ts";
import { rulerTicks, unitAt } from "./ruler.ts";
import "./aids.css";

/** How thick a ruler is, in screen pixels. */
const RULER = 18;

interface Drag {
  axis: Guide["axis"];
  /** The guide being moved, or null for a new one pulled out of a ruler. */
  index: number | null;
  /** Slide units; null while the pointer is off the slide. */
  at: number | null;
}

interface Props {
  session: EditorSession;
  guides: Guides | null | undefined;
  /** Screen pixels per slide unit. */
  zoom: number;
  width: number;
  height: number;
}

/**
 * The rulers along the top and left of the slide, the grid over it, and the guides dragged out of the rulers. A guide is pulled out of a
 * ruler, moved by its line, and put back on a ruler (or off the slide) to take it away; each is one step of undo, made when the pointer is
 * let go. They are for the editor only: the show and the exports never draw them.
 */
export function GuideLayer({ session, guides, zoom, width, height }: Props): JSX.Element | null {
  const [drag, setDrag] = useState<Drag | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const lines = guides?.lines ?? [];
  const grid = guides?.grid ?? 0;
  if (!guides || (!guides.rulers && !guides.showGrid && lines.length === 0)) return null;

  const slideUnits = (event: PointerEvent, axis: Guide["axis"]): number | null => {
    const rect = root.current?.getBoundingClientRect();
    if (!rect) return null;
    const at = axis === "vertical" ? unitAt(event.clientX, rect.left, zoom) : unitAt(event.clientY, rect.top, zoom);
    const limit = axis === "vertical" ? width / zoom : height / zoom;
    return at < 0 || at > limit ? null : at;
  };

  const begin = (event: PointerEvent, axis: Guide["axis"], index: number | null): void => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ axis, index, at: index === null ? null : (lines[index]?.at ?? null) });
  };
  const follow = (event: PointerEvent): void => {
    if (drag) setDrag({ ...drag, at: slideUnits(event, drag.axis) });
  };
  const finish = (event: PointerEvent): void => {
    if (!drag) return;
    const at = slideUnits(event, drag.axis);
    setDrag(null);
    if (drag.index === null) {
      if (at !== null) session.aids.addGuide(drag.axis, at);
    } else {
      session.aids.moveGuide(drag.index, at);
    }
  };

  const shown = drag ? lines.map((guide, i) => (i === drag.index ? { ...guide, at: drag.at ?? guide.at } : guide)) : lines;
  const preview = drag && drag.index === null && drag.at !== null ? { axis: drag.axis, at: drag.at } : null;
  const dragging = { onPointerMove: follow, onPointerUp: finish, onPointerCancel: () => setDrag(null) };

  return (
    <div ref={root} className="ks-aids" data-chrome="" onPointerDown={(event) => event.stopPropagation()}>
      {guides.showGrid && grid > 0 ? <div className="ks-grid" aria-hidden="true" style={{ backgroundSize: `${grid * zoom}px ${grid * zoom}px` }} /> : null}
      {[...shown, ...(preview ? [preview] : [])].map((guide, i) => {
        const vertical = guide.axis === "vertical";
        const mine = i < shown.length;
        return (
          <div
            key={i}
            className={`ks-guideline${mine ? "" : " is-new"}`}
            data-axis={guide.axis}
            role={mine ? "separator" : undefined}
            aria-orientation={vertical ? "vertical" : "horizontal"}
            style={vertical ? { left: guide.at * zoom, height } : { top: guide.at * zoom, width }}
            onPointerDown={mine ? (event) => begin(event, guide.axis, i) : undefined}
            {...(mine ? dragging : {})}
          />
        );
      })}
      {guides.rulers ? (
        <>
          <Ruler axis="horizontal" length={width / zoom} zoom={zoom} onPull={(event) => begin(event, "horizontal", null)} dragging={dragging} />
          <Ruler axis="vertical" length={height / zoom} zoom={zoom} onPull={(event) => begin(event, "vertical", null)} dragging={dragging} />
        </>
      ) : null}
    </div>
  );
}

interface RulerProps {
  /** The ruler along the top is `horizontal`: it makes horizontal guides when pulled down. */
  axis: Guide["axis"];
  length: number;
  zoom: number;
  onPull(event: PointerEvent): void;
  dragging: { onPointerMove(event: PointerEvent): void; onPointerUp(event: PointerEvent): void; onPointerCancel(): void };
}

function Ruler({ axis, length, zoom, onPull, dragging }: RulerProps): JSX.Element {
  const across = axis === "horizontal";
  return (
    <div className="ks-ruler" data-along={across ? "x" : "y"} style={across ? { height: RULER, width: length * zoom, top: -RULER } : { width: RULER, height: length * zoom, left: -RULER }} title="Drag out a guide" onPointerDown={onPull} {...dragging}>
      {rulerTicks(length, zoom).map((tick) => (
        <span key={tick.at} className={`ks-tick${tick.major ? " is-major" : ""}`} style={across ? { left: tick.at * zoom } : { top: tick.at * zoom }}>
          {tick.label}
        </span>
      ))}
    </div>
  );
}

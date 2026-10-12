import { type Rect, boundsOf } from "@kasten-slides/canvas";
import { type JSX, useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";

import type { EditorSession } from "../session/session.ts";
import { type CanvasController, type Preview } from "./controller.ts";
import { itemsOf } from "./geometry.ts";
import { GuideBoard, limitGuides } from "./guides-dom.ts";
import { frame } from "./Overlay.tsx";

const px = (n: number, zoom: number) => n * zoom;

/** The parts of a preview the gesture layer draws with React: the guides are drawn by the board, straight into the page. */
type GestureView = Pick<Preview, "gesture" | "angle" | "marquee" | "hits" | "drawing" | "overrides">;

const NO_BOXES: Preview["overrides"] = new Map();

/** What React draws from a preview: the boxes only where a readout is placed by them. */
export function viewOf(preview: Preview): GestureView {
  const { gesture, angle, marquee, hits, drawing } = preview;
  const placed = gesture === "resize" || gesture === "rotate";
  return { gesture, angle, marquee, hits, drawing, overrides: placed ? preview.overrides : NO_BOXES };
}

const sameRect = (a: Rect | null, b: Rect | null): boolean => a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);
const sameBoxes = (a: Preview["overrides"], b: Preview["overrides"]): boolean =>
  a === b ||
  (a.size === b.size &&
    [...a].every(([id, box]) => {
      const other = b.get(id);
      return other !== undefined && sameRect(box, other) && box.rotation === other.rotation;
    }));

/** Whether two views would be drawn the same. */
export function sameView(a: GestureView, b: GestureView): boolean {
  const drawing = a.drawing === b.drawing || (a.drawing !== null && b.drawing !== null && a.drawing.tool === b.drawing.tool && a.drawing.from.x === b.drawing.from.x && a.drawing.from.y === b.drawing.from.y && a.drawing.to.x === b.drawing.to.x && a.drawing.to.y === b.drawing.to.y);
  return (
    a.gesture === b.gesture &&
    a.angle === b.angle &&
    drawing &&
    sameRect(a.marquee, b.marquee) &&
    a.hits.length === b.hits.length &&
    a.hits.every((id, i) => id === b.hits[i]) &&
    sameBoxes(a.overrides, b.overrides)
  );
}

const union = (rects: readonly Rect[]): Rect | null => {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  return { x: left, y: top, w: Math.max(...rects.map((r) => r.x + r.w)) - left, h: Math.max(...rects.map((r) => r.y + r.h)) - top };
};

/** What a gesture says in numbers, beside what it is turning or sizing: the angle, or the size. Nothing for a move. */
export function readoutOf(preview: Pick<Preview, "gesture" | "angle" | "overrides">): { text: string; at: Rect } | null {
  const { gesture, angle, overrides } = preview;
  if (gesture !== "resize" && gesture !== "rotate") return null;
  const boxes = [...overrides.values()];
  const at = union(boxes.map((box) => boundsOf(box)));
  if (!at) return null;
  if (gesture === "rotate") return angle === null ? null : { text: `${Math.round(angle)}°`, at };
  // One box says its own size, as it is drawn; several say the size of the box round them.
  const own = boxes.length === 1 ? boxes[0] : undefined;
  return { text: `${Math.round(own ? own.w : at.w)} × ${Math.round(own ? own.h : at.h)}`, at };
}

/** The guides to draw for what a preview holds: the ones worth the eye, the gap marks nearest what is moved. */
function guidesOf(preview: Preview) {
  const around = preview.overrides.size === 0 ? null : union([...preview.overrides.values()].map((box) => boundsOf(box)));
  return limitGuides(preview.guides, around ? { x: around.x + around.w / 2, y: around.y + around.h / 2 } : null);
}

/**
 * What a gesture draws that comes and goes with it: the smart guides, the rectangle of a selection being dragged and what it
 * would take, the box of a shape being drawn, and the number beside what is being turned or sized. The guides are written
 * straight into the page (`GuideBoard`) and do not draw anything again; what React draws here changes only when the rectangle,
 * the readout or the shape does, so the steps of a plain move draw nothing at all.
 */
export function GestureLayer({ session, controller, zoom }: { session: EditorSession; controller: CanvasController; zoom: number }): JSX.Element {
  const kept = useRef<GestureView | null>(null);
  const read = useCallback((): GestureView => {
    const next = viewOf(controller.preview);
    if (kept.current && sameView(kept.current, next)) return kept.current;
    kept.current = next;
    return next;
  }, [controller]);
  const preview = useSyncExternalStore(controller.subscribe, read, read);

  const host = useRef<HTMLDivElement>(null);
  const board = useRef<GuideBoard | null>(null);
  const scale = useRef(zoom);
  scale.current = zoom;
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const guides = new GuideBoard(element);
    board.current = guides;
    const stop = controller.subscribe(() => guides.show(guidesOf(controller.preview), scale.current));
    return () => {
      stop();
      guides.dispose();
      board.current = null;
    };
  }, [controller]);
  // A new zoom puts the guides that are up where they now go.
  useLayoutEffect(() => {
    board.current?.show(guidesOf(controller.preview), zoom);
  }, [controller, zoom]);

  const hits = preview.hits.length === 0 ? [] : itemsOf(session).filter((item) => preview.hits.includes(item.id));
  const readout = readoutOf(preview);
  return (
    <div className="ks-overlay ks-gesture-layer" aria-hidden="true">
      <div ref={host} className="ks-overlay" />
      {hits.map((item) => (
        <div key={`hit-${item.id}`} className="ks-outline is-hover is-hit" style={frame(item, zoom)} />
      ))}
      {preview.marquee ? <div className="ks-marquee" style={frame(preview.marquee, zoom)} /> : null}
      {preview.drawing ? <Drawing drawing={preview.drawing} zoom={zoom} /> : null}
      {readout ? (
        <div className="ks-readout" style={{ left: px(readout.at.x + readout.at.w / 2, zoom), top: px(readout.at.y + readout.at.h, zoom) + 14 }}>
          {readout.text}
        </div>
      ) : null}
    </div>
  );
}

function Drawing({ drawing, zoom }: { drawing: NonNullable<Preview["drawing"]>; zoom: number }) {
  const { from, to, tool } = drawing;
  if (tool.startsWith("line:") || tool.startsWith("arrow:")) {
    return (
      <svg className="ks-drawing-line" width="100%" height="100%">
        <line x1={px(from.x, zoom)} y1={px(from.y, zoom)} x2={px(to.x, zoom)} y2={px(to.y, zoom)} />
      </svg>
    );
  }
  return <div className="ks-drawing" style={frame({ x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), w: Math.abs(to.x - from.x), h: Math.abs(to.y - from.y) }, zoom)} />;
}

import { type Rect, boundsOf } from "@kasten-slides/canvas";
import { type JSX, useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";

import type { EditorSession } from "../session/session.ts";
import { type CanvasController, type Preview } from "./controller.ts";
import { itemsOf } from "./geometry.ts";
import { GuideBoard, limitGuides } from "./guides-dom.ts";
import { frame } from "./Overlay.tsx";
import { Readout } from "./Readout.tsx";

const px = (n: number, zoom: number) => n * zoom;

/** The parts of a preview the gesture layer draws with React: the guides are drawn by the board, and the number beside the gesture by the readout, straight into the page. */
type GestureView = Pick<Preview, "gesture" | "marquee" | "hits" | "drawing">;

/** What React draws from a preview. */
export function viewOf(preview: Preview): GestureView {
  const { gesture, marquee, hits, drawing } = preview;
  return { gesture, marquee, hits, drawing };
}

const sameRect = (a: Rect | null, b: Rect | null): boolean => a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

/** Whether two views would be drawn the same. */
export function sameView(a: GestureView, b: GestureView): boolean {
  const drawing = a.drawing === b.drawing || (a.drawing !== null && b.drawing !== null && a.drawing.tool === b.drawing.tool && a.drawing.from.x === b.drawing.from.x && a.drawing.from.y === b.drawing.from.y && a.drawing.to.x === b.drawing.to.x && a.drawing.to.y === b.drawing.to.y);
  return a.gesture === b.gesture && drawing && sameRect(a.marquee, b.marquee) && a.hits.length === b.hits.length && a.hits.every((id, i) => id === b.hits[i]);
}

const union = (rects: readonly Rect[]): Rect | null => {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  return { x: left, y: top, w: Math.max(...rects.map((r) => r.x + r.w)) - left, h: Math.max(...rects.map((r) => r.y + r.h)) - top };
};

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
  return (
    <div className="ks-overlay ks-gesture-layer" aria-hidden="true">
      <div ref={host} className="ks-overlay" />
      {hits.map((item) => (
        <div key={`hit-${item.id}`} className="ks-outline is-hover is-hit" style={frame(item, zoom)} />
      ))}
      {preview.marquee ? <div className="ks-marquee" style={frame(preview.marquee, zoom)} /> : null}
      {preview.drawing ? <Drawing drawing={preview.drawing} zoom={zoom} /> : null}
      <Readout controller={controller} zoom={zoom} />
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

// The ink over a slide: its strokes, the stroke being drawn, and the other window's laser, in one picture the size of the slide. The picture
// is a unit wide and as tall as the slide's proportions say, so a stroke is the same shape at any size. While a pen is in hand, or the
// laser is on, the picture takes the pointer; otherwise it lets the show have it.

import { type JSX, type PointerEvent, useRef, useSyncExternalStore } from "react";

import type { Stroke } from "./model.ts";
import type { InkStore } from "./store.ts";
import "./ink.css";

export interface InkLayerProps {
  store: InkStore;
  /** The slide's height over its width. */
  aspect: number;
}

function Line({ stroke, aspect }: { stroke: Stroke; aspect: number }): JSX.Element {
  const points: string[] = [];
  for (let i = 0; i + 1 < stroke.points.length; i += 2) points.push(`${stroke.points[i]},${(stroke.points[i + 1] ?? 0) * aspect}`);
  return <polyline className="ks-ink-stroke" data-tool={stroke.tool} data-color={stroke.color} points={points.join(" ")} strokeWidth={stroke.width} />;
}

export function InkLayer({ store, aspect }: InkLayerProps): JSX.Element {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const down = useRef(false);
  const active = state.tool !== null || state.laser;

  const at = (event: PointerEvent<SVGSVGElement>): [number, number] | null => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return null;
    return [Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1), Math.min(Math.max((event.clientY - box.top) / box.height, 0), 1)];
  };
  const onDown = (event: PointerEvent<SVGSVGElement>): void => {
    if (event.button !== 0 || !state.tool) return;
    const where = at(event);
    if (!where) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    down.current = true;
    store.begin(...where);
  };
  const onMove = (event: PointerEvent<SVGSVGElement>): void => {
    const where = at(event);
    if (!where) return;
    if (down.current) store.extend(...where);
    else store.pointAt(...where);
  };
  const onUp = (): void => {
    if (!down.current) return;
    down.current = false;
    store.finish();
  };

  return (
    <svg
      className="ks-ink"
      data-active={active || undefined}
      data-tool={state.tool ?? (state.laser ? "laser" : undefined)}
      viewBox={`0 0 1 ${aspect}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onClick={(event) => active && event.stopPropagation()}
    >
      {state.strokes.map((stroke) => (
        <Line key={stroke.id} stroke={stroke} aspect={aspect} />
      ))}
      {state.live ? <Line stroke={state.live} aspect={aspect} /> : null}
      {state.remoteLaser ? <circle className="ks-ink-laser" cx={state.remoteLaser.x} cy={state.remoteLaser.y * aspect} r={0.009} /> : null}
    </svg>
  );
}

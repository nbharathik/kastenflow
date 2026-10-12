import { type KeyboardEvent, type PointerEvent, useRef } from "react";

import type { Hsv } from "./color-math.ts";

interface HsvAreaProps {
  hsv: Hsv;
  /** Called as the pointer or the keys move; nothing is committed until the person says so. */
  onChange(hsv: Hsv): void;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** A square for saturation (across) and value (up), and a bar for the hue: the custom colour picker of the palette. */
export function HsvArea({ hsv, onChange }: HsvAreaProps) {
  const square = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);

  const pointInSquare = (event: PointerEvent) => {
    const box = square.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return;
    onChange({ h: hsv.h, s: clamp01((event.clientX - box.left) / box.width), v: clamp01(1 - (event.clientY - box.top) / box.height) });
  };
  const pointOnBar = (event: PointerEvent) => {
    const box = bar.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    onChange({ ...hsv, h: clamp01((event.clientX - box.left) / box.width) * 360 });
  };
  /** A drag keeps going outside the element it began on. */
  const drag = (handler: (event: PointerEvent) => void) => (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // The element's own events do as well.
    }
    handler(event);
  };
  const dragging = (handler: (event: PointerEvent) => void) => (event: PointerEvent<HTMLDivElement>) => {
    if (event.buttons === 1) handler(event);
  };

  const onSquareKey = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 0.1 : 0.02;
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[event.key];
    if (!move) return;
    event.preventDefault();
    onChange({ h: hsv.h, s: clamp01(hsv.s + move[0]!), v: clamp01(hsv.v + move[1]!) });
  };
  const onBarKey = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 30 : 5;
    const delta = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -step : event.key === "ArrowRight" || event.key === "ArrowUp" ? step : 0;
    if (delta === 0) return;
    event.preventDefault();
    onChange({ ...hsv, h: (hsv.h + delta + 360) % 360 });
  };

  return (
    <div className="ks-hsv">
      <div
        ref={square}
        className="ks-hsv-square"
        style={{ background: `hsl(${Math.round(hsv.h)} 100% 50%)` }}
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuetext={`${Math.round(hsv.s * 100)}% saturation, ${Math.round(hsv.v * 100)}% brightness`}
        aria-valuenow={Math.round(hsv.s * 100)}
        onPointerDown={drag(pointInSquare)}
        onPointerMove={dragging(pointInSquare)}
        onKeyDown={onSquareKey}
      >
        <span className="ks-hsv-thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
      </div>
      <div
        ref={bar}
        className="ks-hsv-hue"
        role="slider"
        tabIndex={0}
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        onPointerDown={drag(pointOnBar)}
        onPointerMove={dragging(pointOnBar)}
        onKeyDown={onBarKey}
      >
        <span className="ks-hsv-thumb" style={{ left: `${(hsv.h / 360) * 100}%`, top: "50%" }} />
      </div>
    </div>
  );
}

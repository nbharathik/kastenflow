// The width of the filmstrip, chosen by the person: dragged by the edge between it and the slide, or moved with the arrow keys when the
// edge has the focus. It is kept in this browser (`ks-filmstrip-width`), as the notes' height is, and starts at 208 when nothing was kept.

import { type CSSProperties, type JSX, type KeyboardEvent, type PointerEvent, type ReactNode, useCallback, useRef, useState } from "react";

import { FILMSTRIP_WIDTH_KEY, readNumber, writeNumber } from "../ui-prefs.ts";
import { FILMSTRIP_MAX, FILMSTRIP_MIN, FILMSTRIP_W } from "./model.ts";

/** What an arrow key moves the edge by, and what it moves it by with Shift held. */
const STEP = 16;
const BIG_STEP = 48;

/** The width the filmstrip has now, and how to change it (`keep` false while it is being dragged: the last value is kept when it stops). */
export function useFilmstripWidth(): { width: number; set(next: number, keep?: boolean): void; keep(): void } {
  const [width, setWidth] = useState(() => readNumber(FILMSTRIP_WIDTH_KEY, FILMSTRIP_W, FILMSTRIP_MIN, FILMSTRIP_MAX));
  const latest = useRef(width);
  const set = useCallback((next: number, keep = true) => {
    const clamped = Math.min(Math.max(Math.round(next), FILMSTRIP_MIN), FILMSTRIP_MAX);
    latest.current = clamped;
    setWidth(clamped);
    if (keep) writeNumber(FILMSTRIP_WIDTH_KEY, clamped);
  }, []);
  const keep = useCallback(() => writeNumber(FILMSTRIP_WIDTH_KEY, latest.current), []);
  return { width, set, keep };
}

export interface FilmstripGripProps {
  width: number;
  onResize(next: number, keep?: boolean): void;
  /** The drag is over: keep the width it ended at. */
  onKeep(): void;
}

/** The filmstrip and the edge between it and the slide: the box that is as wide as the person made it. */
export function FilmstripFrame({ width, onResize, onKeep, children }: FilmstripGripProps & { children: ReactNode }): JSX.Element {
  return (
    <div className="ks-filmstrip-wrap" style={{ "--ks-filmstrip-w": `${width}px` } as CSSProperties}>
      {children}
      <FilmstripGrip width={width} onResize={onResize} onKeep={onKeep} />
    </div>
  );
}

/** The edge between the filmstrip and the slide. */
export function FilmstripGrip({ width, onResize, onKeep }: FilmstripGripProps): JSX.Element {
  const drag = useRef<{ x: number; width: number } | null>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? BIG_STEP : STEP;
    const next = event.key === "ArrowRight" ? width + step : event.key === "ArrowLeft" ? width - step : event.key === "Home" ? FILMSTRIP_MIN : event.key === "End" ? FILMSTRIP_MAX : null;
    if (next === null) return;
    // The edge's keys are its own; the slide's arrow keys must not also move something.
    event.preventDefault();
    event.stopPropagation();
    onResize(next);
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    drag.current = { x: event.clientX, width };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (drag.current) onResize(drag.current.width + (event.clientX - drag.current.x), false);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    onKeep();
  };

  return (
    <div
      className="ks-filmstrip-grip"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the filmstrip"
      aria-valuemin={FILMSTRIP_MIN}
      aria-valuemax={FILMSTRIP_MAX}
      aria-valuenow={width}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      // Double click puts it back to the usual width.
      onDoubleClick={() => onResize(FILMSTRIP_W)}
    />
  );
}

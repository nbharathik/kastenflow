import type { Rect } from "@kasten-slides/canvas";
import { type JSX, useEffect, useState } from "react";

import { type Gap, gapsBetween } from "./distances.ts";

/** Whether Alt is held down. A window that loses the focus with Alt down never hears it let go, so it counts as let go then. */
export function useAltHeld(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const down = (event: KeyboardEvent): void => {
      if (event.key === "Alt") setHeld(true);
    };
    const up = (event: KeyboardEvent): void => {
      if (event.key === "Alt") setHeld(false);
    };
    const away = (): void => setHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", away);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", away);
    };
  }, []);
  return held;
}

/** One gap as a line with a short stroke across each end, and its size in the middle. */
function Mark({ gap, zoom }: { gap: Gap; zoom: number }): JSX.Element {
  const length = gap.size * zoom;
  const along = gap.axis === "x";
  return (
    <div
      className="ks-distance"
      data-axis={gap.axis}
      style={along ? { left: gap.from * zoom, top: gap.at * zoom, width: length } : { left: gap.at * zoom, top: gap.from * zoom, height: length }}
    >
      <span className="ks-distance-label">{Math.round(gap.size)}</span>
    </div>
  );
}

/**
 * How far the selection is from the block the pointer is over, on each side that faces it: drawn while Alt is held. `from` is the box round
 * the selection and `to` the outline of the other block, in slide units.
 */
export function DistanceLabels({ from, to, zoom }: { from: Rect | null; to: Rect | null; zoom: number }): JSX.Element | null {
  if (!from || !to) return null;
  const gaps = gapsBetween(from, to);
  if (gaps.length === 0) return null;
  return (
    <div className="ks-overlay ks-distances" aria-hidden="true">
      {gaps.map((gap) => (
        <Mark key={`${gap.axis}:${gap.from}:${gap.at}`} gap={gap} zoom={zoom} />
      ))}
    </div>
  );
}

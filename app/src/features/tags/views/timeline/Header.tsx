// The scale across the top of a timeline (a band per month, small ticks under
// it), the faint lines the ticks draw down the grid, and the line for today.
// All of it is decoration for the eye: each bar says its own dates.

import { memo, useMemo } from "react";

import { DAY_WIDTH, bands, ticks, widthOf, xOf, type Scale, type Span } from "./layout";

interface ScaleProps {
  span: Span;
  scale: Scale;
}

export const Header = memo(function Header({ span, scale }: ScaleProps) {
  const big = useMemo(() => bands(span, scale), [span, scale]);
  const small = useMemo(() => ticks(span, scale), [span, scale]);
  return (
    <div className="kasten-tl-head" style={{ width: widthOf(span, scale) }} aria-hidden="true">
      <div className="kasten-tl-bands">
        {big.map((band) => (
          <span key={band.day} className="kasten-tl-band" style={{ left: band.x, width: band.width }}>
            <span className="kasten-tl-band-label">{band.label}</span>
          </span>
        ))}
      </div>
      <div className="kasten-tl-ticks">
        {small.map((tick) => (
          <span key={tick.day} className="kasten-tl-tick" data-strong={tick.strong ? "" : undefined} title={tick.title} style={{ left: tick.x }}>
            {tick.label}
          </span>
        ))}
      </div>
    </div>
  );
});

interface LinesProps extends ScaleProps {
  /** Today, YYYY-MM-DD; drawn only when the grid covers it. */
  today: string;
  /** Where the days begin across the grid: after the lane labels. */
  left: number;
}

/** Lines down the grid at the ticks, and the line for today. At the week
 * scale every day has a faint line from the stylesheet and only the
 * Mondays are drawn here, so a long timeline stays light. */
export const Lines = memo(function Lines({ span, scale, today, left }: LinesProps) {
  const all = useMemo(() => ticks(span, scale), [span, scale]);
  const small = scale === "week" ? all.filter((tick) => tick.strong) : all;
  const inside = today >= span.from && today <= span.to;
  return (
    <div className="kasten-tl-lines" data-scale={scale} aria-hidden="true" style={{ left, width: widthOf(span, scale) }}>
      {small.map((tick) => (
        <i key={tick.day} className="kasten-tl-line" data-strong={tick.strong ? "" : undefined} style={{ left: tick.x }} />
      ))}
      {inside && <i className="kasten-tl-today" data-today={today} style={{ left: xOf(today, span.from, scale) + DAY_WIDTH[scale] / 2 }} />}
    </div>
  );
});

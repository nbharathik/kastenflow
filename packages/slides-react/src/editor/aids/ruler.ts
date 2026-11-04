// The marks of a ruler. A deck's page is sized in inches (Slide > Page setup), so its rulers count inches:
// a slide unit is 1/96 inch.

/** Slide units to an inch. */
export const UNITS_PER_INCH = 96;

/** The distances between marks a ruler may use, in slide units: an eighth of an inch up to five inches. */
const STEPS = [12, 24, 48, 96, 192, 480];

/** The fewest screen pixels between two marks before they crowd each other. */
const LEAST_GAP = 10;

export interface Tick {
  /** Slide units from the ruler's start. */
  at: number;
  /** Whole inches are major marks, and the only ones with a number. */
  major: boolean;
  label?: string;
}

/** The distance between marks at a zoom (screen pixels per slide unit): the finest that does not crowd. */
export function stepAt(zoom: number): number {
  return STEPS.find((step) => step * zoom >= LEAST_GAP) ?? STEPS[STEPS.length - 1]!;
}

/** The text for a distance: inches, with a fraction only where a mark can be at one (`0`, `0.5`, `1`). */
export function inchesText(units: number): string {
  const inches = Math.round((units / UNITS_PER_INCH) * 1000) / 1000;
  return String(inches);
}

/** The marks along a ruler `length` slide units long, at a zoom. A number goes on every major mark that has room for one. */
export function rulerTicks(length: number, zoom: number): Tick[] {
  if (!(length > 0) || !(zoom > 0)) return [];
  const step = stepAt(zoom);
  const labelled = Math.max(UNITS_PER_INCH, step);
  const out: Tick[] = [];
  for (let at = 0; at <= length + 1e-6; at += step) {
    const major = at % UNITS_PER_INCH === 0;
    const numbered = at % labelled === 0 && (major || step >= UNITS_PER_INCH);
    out.push({ at, major, ...(numbered ? { label: inchesText(at) } : {}) });
  }
  return out;
}

/** Where on the slide a pointer is along one axis: the pixel it is at, less where the page starts, over the zoom. */
export function unitAt(clientPosition: number, pageStart: number, zoom: number): number {
  return (clientPosition - pageStart) / zoom;
}

// How the presenter's view is arranged: how wide the slide column is, how tall the next slide is against the notes, which panels
// are shown, and which side the slide is on. All of it is plain data and pure functions, so it can be checked without a window.

export type Panel = "now" | "next" | "notes";
export type PresetName = "balanced" | "bigNotes" | "bigSlides" | "notesOnly";

export interface Layout {
  /** The share of the width (or, when stacked, of the height) that the current slide's column takes, 0 to 1. */
  split: number;
  /** The share of the side column's height that the next slide takes, 0 to 1; the notes have the rest. */
  side: number;
  /** Which preset the sizes and panels came from; "custom" once they were changed by hand. */
  preset: PresetName | "custom";
  /** The current slide is on the right and the side column on the left. */
  swap: boolean;
  show: Record<Panel | "clock", boolean>;
  /** The next two steps or slides after the next one, as a small strip. */
  then: boolean;
}

export const SPLIT_MIN = 0.25;
export const SPLIT_MAX = 0.8;
export const SIDE_MIN = 0.15;
export const SIDE_MAX = 0.85;
/** One arrow key press moves a splitter by this share, and with Shift by the larger one. */
export const STEP = 0.02;
export const STEP_LARGE = 0.1;

export const PRESETS: readonly { name: PresetName; label: string }[] = [
  { name: "balanced", label: "Balanced" },
  { name: "bigNotes", label: "Big notes" },
  { name: "bigSlides", label: "Big slides" },
  { name: "notesOnly", label: "Notes only" },
];

const SIZES: Record<PresetName, { split: number; side: number }> = {
  balanced: { split: 0.62, side: 0.4 },
  bigNotes: { split: 0.45, side: 0.28 },
  bigSlides: { split: 0.78, side: 0.5 },
  notesOnly: { split: 0.62, side: 0.4 },
};

export function defaultLayout(): Layout {
  return { ...SIZES.balanced, preset: "balanced", swap: false, show: { now: true, next: true, notes: true, clock: true }, then: false };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** A preset's sizes and panels over the layout; the side the slide is on and the strip and clock rows stay as they were. */
export function applyPreset(layout: Layout, name: PresetName): Layout {
  const only = name === "notesOnly";
  return { ...layout, ...SIZES[name], preset: name, show: { ...layout.show, now: !only, next: !only, notes: true } };
}

/** Shows or hides a panel (or the clock row). The last panel on cannot be hidden. */
export function toggled(layout: Layout, what: Panel | "clock"): Layout {
  const on = !layout.show[what];
  const show = { ...layout.show, [what]: on };
  if (what !== "clock" && !show.now && !show.next && !show.notes) return layout;
  return { ...layout, show, preset: what === "clock" ? layout.preset : "custom" };
}

/** Whether a panel is the only one showing (its toggle is then off limits). */
export function isLastPanel(layout: Layout, panel: Panel): boolean {
  const { now, next, notes } = layout.show;
  return layout.show[panel] && Number(now) + Number(next) + Number(notes) === 1;
}

export function withSplit(layout: Layout, split: number): Layout {
  return { ...layout, split: clamp(split, SPLIT_MIN, SPLIT_MAX), preset: "custom" };
}

export function withSide(layout: Layout, side: number): Layout {
  return { ...layout, side: clamp(side, SIDE_MIN, SIDE_MAX), preset: "custom" };
}

/** The sizes a double-click on a splitter goes back to: the preset's own, else the balanced ones. */
export function resetSplit(layout: Layout): Layout {
  return { ...layout, split: SIZES[layout.preset === "custom" ? "balanced" : layout.preset].split };
}

export function resetSide(layout: Layout): Layout {
  return { ...layout, side: SIZES[layout.preset === "custom" ? "balanced" : layout.preset].side };
}

/** Where the handle between the slide column and the side column sits, as a share of the width: the slide's share, or the rest when swapped. */
export function handleOfSplit(layout: Layout): number {
  return layout.swap ? 1 - layout.split : layout.split;
}

export function splitOfHandle(layout: Layout, handle: number): number {
  return layout.swap ? 1 - handle : handle;
}

/** The width of a splitter's track, in pixels; the style sheet gives the bar the same. */
export const BAR = 12;

/** A grid's tracks: one, or two with a bar between them where the first has `first` of the room (0 to 1). */
export function tracks(first: number | null): string {
  if (first === null) return "minmax(0, 1fr)";
  const a = (first * 100).toFixed(2);
  const b = ((1 - first) * 100).toFixed(2);
  return `minmax(0, ${a}fr) ${BAR}px minmax(0, ${b}fr)`;
}

/** The handle's limits, for the splitter's own range. */
export function handleRange(layout: Layout): [number, number] {
  return layout.swap ? [1 - SPLIT_MAX, 1 - SPLIT_MIN] : [SPLIT_MIN, SPLIT_MAX];
}

/** Where a key moves a splitter's value, null for a key that is not for it. */
export function nudged(value: number, key: string, shift: boolean, min: number, max: number, forward: string, back: string): number | null {
  const step = shift ? STEP_LARGE : STEP;
  if (key === forward) return clamp(value + step, min, max);
  if (key === back) return clamp(value - step, min, max);
  if (key === "Home") return min;
  if (key === "End") return max;
  return null;
}

// ---- Storage -------------------------------------------------------------------------------------------------------------------

export const LAYOUT_KEY = "kasten-slides-presenter-layout-v1";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function share(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

const flag = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);

/** The layout that was stored, field by field: whatever is missing or out of range is the default, and at least one panel shows. */
export function parseLayout(raw: string | null): Layout {
  const base = defaultLayout();
  if (raw === null) return base;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return base;
  }
  if (!isRecord(data) || data.v !== 1) return base;
  const shown = isRecord(data.show) ? data.show : {};
  const show = { now: flag(shown.now, true), next: flag(shown.next, true), notes: flag(shown.notes, true), clock: flag(shown.clock, true) };
  if (!show.now && !show.next && !show.notes) Object.assign(show, { now: true, next: true, notes: true });
  const known = PRESETS.some((p) => p.name === data.preset);
  return {
    split: share(data.split, SPLIT_MIN, SPLIT_MAX, base.split),
    side: share(data.side, SIDE_MIN, SIDE_MAX, base.side),
    preset: known ? (data.preset as PresetName) : data.preset === "custom" ? "custom" : base.preset,
    swap: flag(data.swap, false),
    show,
    then: flag(data.then, false),
  };
}

export function serializeLayout(layout: Layout): string {
  return JSON.stringify({ v: 1, ...layout });
}

export function savedLayout(): Layout {
  try {
    return parseLayout(localStorage.getItem(LAYOUT_KEY));
  } catch {
    return defaultLayout();
  }
}

export function keepLayout(layout: Layout): void {
  try {
    localStorage.setItem(LAYOUT_KEY, serializeLayout(layout));
  } catch {
    // The layout is only not kept.
  }
}

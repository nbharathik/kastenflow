// The effects the Steps panel offers for what happens to an element at a step, and how a choice changes the effect that is kept.

import type { FxKind, FxStart, MotionDirection, StepFx } from "@kasten-slides/wasm";

export interface EffectChoice {
  value: FxKind;
  label: string;
  /** Where the picker lists it. */
  group: "Entrance and exit" | "Draws the eye" | "Motion";
  /** What it does, one line. */
  says: string;
}

export const EFFECTS: readonly EffectChoice[] = [
  { value: "appear", label: "Appear", group: "Entrance and exit", says: "Just there, with no motion." },
  { value: "fade", label: "Fade", group: "Entrance and exit", says: "Fades in, or out." },
  { value: "fadeUp", label: "Fade up", group: "Entrance and exit", says: "Fades in while rising a little." },
  { value: "grow", label: "Grow", group: "Entrance and exit", says: "Fades in while growing a little." },
  { value: "fly", label: "Fly in", group: "Entrance and exit", says: "Flies in from a side of the slide, or out to it." },
  { value: "zoom", label: "Zoom", group: "Entrance and exit", says: "Grows from a point, or shrinks to one." },
  { value: "wipe", label: "Wipe", group: "Entrance and exit", says: "Uncovered from a side." },
  { value: "float", label: "Float", group: "Entrance and exit", says: "Drifts in with a fade." },
  { value: "pop", label: "Pop", group: "Entrance and exit", says: "Grows from a little smaller, without a bounce." },
  { value: "pulse", label: "Pulse", group: "Draws the eye", says: "Swells and settles back." },
  { value: "colour", label: "Colour change", group: "Draws the eye", says: "A wash of colour that fades." },
  { value: "path", label: "Motion path", group: "Motion", says: "Comes in along a straight line from where you set. One for each element." },
];

export const GROUPS: readonly EffectChoice["group"][] = ["Entrance and exit", "Draws the eye", "Motion"];

/** The kinds that come from a side. */
const SIDED: ReadonlySet<FxKind> = new Set<FxKind>(["fly", "wipe", "float"]);
export const hasSide = (kind: FxKind): boolean => SIDED.has(kind);

export const SIDES: readonly { value: MotionDirection; label: string }[] = [
  { value: "down", label: "Bottom" },
  { value: "up", label: "Top" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
];

export const STARTS: readonly { value: FxStart; label: string }[] = [
  { value: "with", label: "With previous" },
  { value: "after", label: "After previous" },
];

/** The theme colours a colour change can wash with. */
export const WASHES = ["accent1", "accent2", "accent3", "accent4", "accent5", "accent6"] as const;

export const LONGEST = 10;
export const USUAL_SECONDS = 0.4;
/** Where a motion path begins when it is first chosen: across, from the left. */
export const FIRST_PATH = { dx: -240, dy: 0 } as const;

export const labelOf = (kind: FxKind): string => EFFECTS.find((e) => e.value === kind)?.label ?? kind;

/**
 * The effect after the person picks `kind` for a step that has `old`: the time, wait and start stay, and what only the new kind
 * means is given a first value (a colour for a colour change, a place to begin for a path).
 */
export function withKind(old: StepFx | undefined, kind: FxKind): StepFx {
  const next: StepFx = { kind };
  if (old?.duration != null) next.duration = old.duration;
  if (old?.delay != null) next.delay = old.delay;
  if (old?.start != null) next.start = old.start;
  if (hasSide(kind) && old?.direction != null) next.direction = old.direction;
  if (kind === "colour") next.color = old?.color ?? "accent1";
  if (kind === "path") {
    next.dx = old?.dx ?? FIRST_PATH.dx;
    next.dy = old?.dy ?? FIRST_PATH.dy;
  }
  return next;
}

/** The effect with some of its fields changed; a field given as null is taken away. */
export function changed(fx: StepFx, patch: Partial<Record<"direction" | "duration" | "delay" | "start" | "color" | "dx" | "dy", unknown>>): StepFx {
  const next: Record<string, unknown> = { ...fx };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) delete next[key];
    else next[key] = value;
  }
  return next as unknown as StepFx;
}

/** An effect in words, for a cell's name: "Fly in from the left, 0.5 seconds". */
export function said(fx: StepFx): string {
  const side = hasSide(fx.kind) && fx.direction ? ` from the ${fx.direction}` : "";
  const seconds = fx.kind === "appear" ? "" : `, ${fx.duration ?? USUAL_SECONDS} seconds`;
  return `${labelOf(fx.kind)}${side}${seconds}`;
}

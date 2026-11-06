// What the transitions panel offers and says. A transition is how the slide arrives while presenting: nothing, a fade, a slide in, a
// morph that moves what the slide shares with the one before, or one of the motions below.

import type { MotionDirection, Slide, Transition, TransitionKind } from "@kasten-slides/wasm";

import type { IconName } from "../../ui/Icon.tsx";

export interface KindChoice {
  value: TransitionKind;
  label: string;
  icon: IconName;
  /** One line under the name. */
  says: string;
}

export const KINDS: readonly KindChoice[] = [
  { value: "none", label: "None", icon: "circle-x", says: "The slide just appears." },
  { value: "fade", label: "Fade", icon: "droplet", says: "The slide before fades into this one." },
  { value: "slide", label: "Slide", icon: "arrow-right", says: "This slide pushes in from the right." },
  { value: "morph", label: "Morph", icon: "wand-sparkles", says: "Elements that share an id move from where they were." },
  { value: "push", label: "Push", icon: "arrow-right", says: "This slide pushes the one before out." },
  { value: "wipe", label: "Wipe", icon: "arrow-right", says: "This slide is wiped in over the one before." },
  { value: "cover", label: "Cover", icon: "arrow-right", says: "This slide slides in over the one before." },
  { value: "uncover", label: "Uncover", icon: "arrow-right", says: "The slide before slides away and shows this one." },
  { value: "zoom", label: "Zoom", icon: "arrow-right", says: "This slide grows from the middle." },
  { value: "flip", label: "Flip", icon: "arrow-right", says: "The slide turns over to this one." },
  { value: "dissolve", label: "Dissolve", icon: "droplet", says: "A slow cross-fade." },
];

/** How long a transition takes when the slide does not say, in seconds. */
export const USUAL: Record<TransitionKind, number> = { none: 0, fade: 0.4, slide: 0.4, morph: 0.6, push: 0.5, wipe: 0.5, cover: 0.5, uncover: 0.5, zoom: 0.5, flip: 0.7, dissolve: 0.8 };

export const LONGEST = 10;

/** The kinds that come from a side. */
const SIDED: ReadonlySet<TransitionKind> = new Set<TransitionKind>(["push", "wipe", "cover", "uncover", "flip"]);

export const hasDirection = (kind: TransitionKind): boolean => SIDED.has(kind);

/** The sides, in the order the panel lists them: the side the new slide comes from. */
export const DIRECTIONS: readonly { value: MotionDirection; label: string }[] = [
  { value: "right", label: "From right" },
  { value: "left", label: "From left" },
  { value: "up", label: "From top" },
  { value: "down", label: "From bottom" },
];

/** The side a transition comes from when it names none. */
export const USUAL_SIDE: MotionDirection = "right";

/** The transition a slide arrives with: its own, or else the deck's. */
export function arrivesWith(slide: Pick<Slide, "transition"> | undefined, fallback: Transition | null | undefined): Transition | null {
  return slide?.transition ?? fallback ?? null;
}

/** A transition as a person is told it: "Push from the left, 0.5 seconds". */
export function said(transition: Pick<Transition, "kind"> & { duration?: number | null | undefined; direction?: MotionDirection | null | undefined }): string {
  if (transition.kind === "none") return "None";
  const label = KINDS.find((kind) => kind.value === transition.kind)?.label ?? transition.kind;
  const side = hasDirection(transition.kind) && transition.direction ? ` ${DIRECTIONS.find((d) => d.value === transition.direction)?.label.toLowerCase() ?? ""}` : "";
  return `${label}${side}, ${transition.duration ?? USUAL[transition.kind]} seconds`;
}

/** The transition to put on a slide for a kind, a time and a side: no time for none, and a side only for the kinds that have one. */
export function chosen(kind: TransitionKind, seconds: number, direction?: MotionDirection | null): { kind: TransitionKind; duration?: number; direction?: MotionDirection } {
  if (kind === "none") return { kind };
  return { kind, duration: Math.min(Math.max(seconds, 0), LONGEST), ...(hasDirection(kind) && direction ? { direction } : {}) };
}

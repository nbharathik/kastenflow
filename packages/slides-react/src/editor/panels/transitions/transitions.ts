// What the transitions panel offers and says. A transition is how the slide arrives while presenting: nothing, a fade, a slide in, or a
// morph that moves what the slide shares with the one before.

import type { Slide, Transition, TransitionKind } from "@kasten-slides/wasm";

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
];

/** How long a transition takes when the slide does not say, in seconds. */
export const USUAL: Record<TransitionKind, number> = { none: 0, fade: 0.4, slide: 0.4, morph: 0.6 };

export const LONGEST = 10;

/** The transition a slide arrives with: its own, or else the deck's. */
export function arrivesWith(slide: Pick<Slide, "transition"> | undefined, fallback: Transition | null | undefined): Transition | null {
  return slide?.transition ?? fallback ?? null;
}

/** A transition as a person is told it: "Fade, 0.4 seconds". */
export function said(transition: Pick<Transition, "kind"> & { duration?: number | null | undefined }): string {
  if (transition.kind === "none") return "None";
  const label = KINDS.find((kind) => kind.value === transition.kind)?.label ?? transition.kind;
  return `${label}, ${transition.duration ?? USUAL[transition.kind]} seconds`;
}

/** The transition to put on a slide for a kind and a time: no time for none. */
export function chosen(kind: TransitionKind, seconds: number): { kind: TransitionKind; duration?: number } {
  return kind === "none" ? { kind } : { kind, duration: Math.min(Math.max(seconds, 0), LONGEST) };
}

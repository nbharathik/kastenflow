/** The kinds of transition this file plays; reveal.js plays the others. */
export const KINDS: readonly string[];

export interface Frames {
  enter: Keyframe[];
  leave: Keyframe[];
  /** Which slide is drawn over the other while it plays. */
  top: "enter" | "leave";
  easing: string;
}

/** The keyframes of a transition, or null for a kind this file does not play. `back` turns the motion round; `less` makes it a cross-fade. */
export function framesOf(kind: string, direction: string | null | undefined, back: boolean, less: boolean): Frames | null;

export interface TransitionSpec {
  kind: string;
  direction?: string | null | undefined;
  seconds: number;
  back?: boolean | undefined;
}

/** Plays a transition between two slides once; answers the animations started. */
export function playTransition(entering: Element | null, leaving: Element | null, spec: TransitionSpec): Animation[];

/** What a section says about how it arrives; null for a kind reveal.js plays. */
export function specOf(section: Element): { kind: string; direction: string | null; seconds: number } | null;

/** The listener of reveal.js's "slidechanged". */
export function transitionListener(): (event: { indexh?: number; indexv?: number; currentSlide?: Element; previousSlide?: Element }) => Animation[];

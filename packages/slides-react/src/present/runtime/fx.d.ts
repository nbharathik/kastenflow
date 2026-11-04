/** Seconds an effect takes when it does not say. */
export const FX_SECONDS: number;

/** An effect as the runtime plays it: colours are already CSS colours. */
export interface PlayableFx {
  kind: string;
  direction?: string | null | undefined;
  duration?: number | null | undefined;
  delay?: number | null | undefined;
  start?: string | null | undefined;
  color?: string | null | undefined;
  dx?: number | null | undefined;
  dy?: number | null | undefined;
}

export type FxRole = "enter" | "exit" | "emph";

export interface FxEntry {
  id: string;
  role: FxRole;
  fx: PlayableFx;
}

/** The effects of a slide by the step that brings them, in the order the slide lists them. */
export type FxPlan = Record<number, FxEntry[]>;

export interface Reach {
  left: number;
  right: number;
  up: number;
  down: number;
}

/** The frame an element starts from when it comes in; null for an effect with nothing to see. */
export function startFrame(fx: PlayableFx, reach: Reach | null): Keyframe | null;

/** When each effect of one click begins and how long it takes, in milliseconds. */
export function schedule(effects: readonly PlayableFx[]): { at: number; ms: number }[];

export function reachOf(element: Element): Reach | null;

export interface FxItem {
  element: HTMLElement | null;
  role: FxRole;
  fx: PlayableFx;
  done?: () => void;
}

export function playFx(items: readonly FxItem[]): Animation[];

export interface Departure<T extends Element> {
  key: string;
  clone: T;
  parent: Element | null;
}

export function departures<T extends Element>(keyOf: (element: T) => string, wants: (key: string) => boolean): (now: readonly T[]) => Departure<T>[];

export function fxPlayer(plan: FxPlan | null | undefined): { play(drawn: readonly HTMLElement[], host: Element | null, step: number, live?: boolean): Set<string> };

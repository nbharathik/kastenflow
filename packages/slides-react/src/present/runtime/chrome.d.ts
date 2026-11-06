import type { RevealApi } from "reveal.js";

/** A key (or keys) and what it does, as the show's list says them. */
export type KeyRow = readonly [keys: string, what: string];

/** The keys of a presentation. The show's `?` list, the editor's shortcuts dialog and its "Presenting" card all read this one list. */
export const SHOW_KEYS: readonly KeyRow[];
/** P, H and E, listed when the show can draw on the slide. */
export const INK_KEYS: readonly KeyRow[];
/** S, listed when the presenter's view can be opened. */
export const PRESENTER_KEY: KeyRow;
/** Esc, listed when the show can be left. */
export const LEAVE_KEY: KeyRow;
/** The keys of the presenter's own window that time the talk. */
export const TIMER_KEYS: readonly KeyRow[];

export interface ChromeOptions {
  /** The column and row of a slide by its number, counted from 1; null when there is no such slide. */
  locate?: (number: number) => [number, number] | null;
  /** What Esc does when nothing else is open. */
  onExit?: () => void;
  /** What S does. */
  onPresenter?: () => void;
  /** What F does; the page's own full screen when left out. */
  fullscreen?: () => void;
  /** What the page's own full screen fills. */
  fullscreenTarget?: HTMLElement;
  /** The mouse toolbar at the bottom left, shown while the pointer moves. Off when left out (the exported page has none). */
  toolbar?: boolean;
  /** The displays the show may be on; with it the toolbar has a menu to swap or pick one. */
  screens?: ShowScreens;
  /** More keys and toolbar buttons (the app's pen and highlighter). A key list that names P takes the key from "back a slide". */
  extras?: ChromeExtras;
}

/** A toolbar button: its id, glyph, label, the key it is listed with, and what it does. */
export type ChromeTool = readonly [id: string, glyph: string, label: string, key: string, run: () => void];

export interface ChromeExtras {
  keys?: readonly (readonly [codes: readonly number[], run: (event: KeyboardEvent) => void])[];
  tools?: readonly ChromeTool[];
  /** Esc: returns true when it put something away (a pen that was up). */
  escape?: () => boolean;
}

/** One display, as the toolbar's menu lists it. */
export interface ShowScreen {
  label: string;
  primary?: boolean;
  /** The show is on it. */
  current?: boolean;
}

export interface ShowScreens {
  list(): Promise<ShowScreen[]>;
  /** The show goes to the other display. */
  swap(): void;
  /** The show goes to the display with this label. */
  moveTo(label: string): void;
  /** Flashes each display's number. */
  identify?(): void;
}

export interface Chrome {
  destroy(): void;
  laser(on?: boolean): boolean;
  /** The white screen, up or down (toggled when left out). */
  white(on?: boolean): boolean;
  /** Shows a toolbar button as pressed or not. */
  setPressed(id: string, on: boolean): void;
  hints(on?: boolean): boolean;
  lightboxOpen(): boolean;
}

/** Gives a running reveal.js the presentation's keys and tools, in `host`, an empty element inside the deck's window. */
export function attachChrome(reveal: RevealApi, host: HTMLElement, options?: ChromeOptions): Chrome;

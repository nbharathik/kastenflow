import type { RevealApi } from "reveal.js";

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
  hints(on?: boolean): boolean;
  lightboxOpen(): boolean;
}

/** Gives a running reveal.js the presentation's keys and tools, in `host`, an empty element inside the deck's window. */
export function attachChrome(reveal: RevealApi, host: HTMLElement, options?: ChromeOptions): Chrome;

// What the editor's chrome keeps besides the deck and the window state in `EditorUi`: how roomy the bars are, how wide the side panel
// is, which sections of the format options the person folded, and whether the menu search is open. The choices that are about taste
// are kept in this browser (see storage.ts); each editor has one `Chrome`, found with `chromeOf(ui)`.

import { useSyncExternalStore } from "react";

import type { EditorUi } from "../ui-state.ts";
import { isFlagMap, isNumber, readStored, writeStored } from "./storage.ts";

export type Density = "comfortable" | "compact";

/** The side panel's width: what it is at first, and the least and most it may be. */
export const PANEL_WIDTH = { start: 320, min: 264, max: 560 } as const;

export interface ChromeState {
  readonly density: Density;
  readonly panelWidth: number;
  /** Sections the person folded (true) or opened (false) against their default; a section not named is as it starts. */
  readonly folds: Readonly<Record<string, boolean>>;
  readonly menuSearch: boolean;
}

export const clampPanelWidth = (width: number): number => Math.round(Math.min(Math.max(width, PANEL_WIDTH.min), PANEL_WIDTH.max));

const isDensity = (value: unknown): value is Density => value === "comfortable" || value === "compact";

export class Chrome {
  private current: ChromeState = {
    density: readStored<Density>("density", "comfortable", isDensity),
    panelWidth: clampPanelWidth(readStored("panel-width", PANEL_WIDTH.start, isNumber)),
    folds: readStored<Record<string, boolean>>("folds", {}, isFlagMap),
    menuSearch: false,
  };
  private readonly listeners = new Set<() => void>();

  get state(): ChromeState {
    return this.current;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ChromeState => this.current;

  private patch(changes: Partial<ChromeState>): void {
    this.current = { ...this.current, ...changes };
    for (const listener of [...this.listeners]) listener();
  }

  setDensity(density: Density): void {
    if (density === this.current.density) return;
    writeStored("density", density);
    this.patch({ density });
  }

  toggleDensity(): void {
    this.setDensity(this.current.density === "compact" ? "comfortable" : "compact");
  }

  /** Sets the width of the side panel; `keep: false` is for the middle of a drag, which is not worth remembering until it ends. */
  setPanelWidth(width: number, keep = true): void {
    const next = clampPanelWidth(width);
    if (keep) writeStored("panel-width", next);
    if (next !== this.current.panelWidth) this.patch({ panelWidth: next });
  }

  /** Whether a section is folded away: what the person chose, else how it starts. */
  isFolded(id: string, startFolded = false): boolean {
    return this.current.folds[id] ?? startFolded;
  }

  toggleFold(id: string, startFolded = false): void {
    const folded = !this.isFolded(id, startFolded);
    const folds = { ...this.current.folds, [id]: folded };
    writeStored("folds", folds);
    this.patch({ folds });
  }

  openMenuSearch(open = true): void {
    if (open !== this.current.menuSearch) this.patch({ menuSearch: open });
  }
}

const chromes = new WeakMap<EditorUi, Chrome>();

/** The chrome of an editor: made the first time it is asked for. */
export function chromeOf(ui: EditorUi): Chrome {
  let chrome = chromes.get(ui);
  if (!chrome) chromes.set(ui, (chrome = new Chrome()));
  return chrome;
}

/** The chrome's state, and a re-render when it changes. */
export function useChrome(ui: EditorUi): ChromeState {
  const chrome = chromeOf(ui);
  return useSyncExternalStore(chrome.subscribe, chrome.getSnapshot, chrome.getSnapshot);
}

/** One part of the chrome's state; the view re-renders only when that part changes (the width of a panel being dragged is not the bar's concern). */
export function useChromeValue<T>(ui: EditorUi, select: (state: ChromeState) => T): T {
  const chrome = chromeOf(ui);
  return useSyncExternalStore(
    chrome.subscribe,
    () => select(chrome.getSnapshot()),
    () => select(chrome.getSnapshot()),
  );
}

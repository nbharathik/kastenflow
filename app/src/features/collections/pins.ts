// Collections pinned to Home or to a project's overview. A pin is a choice
// about this window (it lives in its preferences, like the pinned pages), not
// something in the vault: the collection itself is the file.

import { create } from "zustand";

/** Where a collection can be pinned: Home, or the overview of the project in this folder (under `projects/`). */
export type PinScope = { kind: "home" } | { kind: "project"; folder: string };

const KEY = "kasten.collection-pins";
/** The most pinned in one place. */
export const MAX_PINNED = 6;

interface Stored {
  home: string[];
  projects: Record<string, string[]>;
}

const isPaths = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === "string");

function read(): Stored {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (typeof saved === "object" && saved !== null) {
      const { home, projects } = saved as Record<string, unknown>;
      const folders: Record<string, string[]> = {};
      if (typeof projects === "object" && projects !== null) {
        for (const [folder, paths] of Object.entries(projects)) if (isPaths(paths)) folders[folder] = paths;
      }
      return { home: isPaths(home) ? home : [], projects: folders };
    }
  } catch {
    // Nothing pinned, as at the start.
  }
  return { home: [], projects: {} };
}

function write(next: Stored): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // The pins last until the window closes.
  }
}

/** The same empty list each time, so a view reading it does not see a change. */
const NONE: string[] = [];

/** The paths pinned in `scope`, in the order pinned. */
export const pinnedIn = (pins: Stored, scope: PinScope): string[] => (scope.kind === "home" ? pins.home : (pins.projects[scope.folder] ?? NONE));

function withPaths(pins: Stored, scope: PinScope, paths: string[]): Stored {
  if (scope.kind === "home") return { ...pins, home: paths };
  const projects = { ...pins.projects };
  if (paths.length === 0) delete projects[scope.folder];
  else projects[scope.folder] = paths;
  return { ...pins, projects };
}

/** `pins` with `path` pinned in `scope` (unchanged when it is, or the place is full). */
export function pin(pins: Stored, scope: PinScope, path: string): Stored {
  const now = pinnedIn(pins, scope);
  return now.includes(path) || now.length >= MAX_PINNED ? pins : withPaths(pins, scope, [...now, path]);
}

export const unpin = (pins: Stored, scope: PinScope, path: string): Stored => withPaths(pins, scope, pinnedIn(pins, scope).filter((p) => p !== path));

/** `pins` after a collection moved from `from` to `to` (renamed), wherever it was pinned. */
export function moved(pins: Stored, from: string, to: string): Stored {
  const swap = (paths: string[]) => paths.map((p) => (p === from ? to : p));
  return { home: swap(pins.home), projects: Object.fromEntries(Object.entries(pins.projects).map(([folder, paths]) => [folder, swap(paths)])) };
}

/** `pins` without a collection that is gone, wherever it was pinned. */
export function forget(pins: Stored, path: string): Stored {
  const keep = (paths: string[]) => paths.filter((p) => p !== path);
  const projects = Object.fromEntries(Object.entries(pins.projects).map(([folder, paths]) => [folder, keep(paths)] as const).filter(([, paths]) => paths.length > 0));
  return { home: keep(pins.home), projects };
}

interface PinState {
  pins: Stored;
  pin(scope: PinScope, path: string): void;
  unpin(scope: PinScope, path: string): void;
  moved(from: string, to: string): void;
  forget(path: string): void;
}

export const usePins = create<PinState>()((set, get) => {
  const apply = (next: Stored) => {
    if (next !== get().pins) {
      write(next);
      set({ pins: next });
    }
  };
  return {
    pins: read(),
    pin: (scope, path) => apply(pin(get().pins, scope, path)),
    unpin: (scope, path) => apply(unpin(get().pins, scope, path)),
    moved: (from, to) => apply(moved(get().pins, from, to)),
    forget: (path) => apply(forget(get().pins, path)),
  };
});

/** Starts again from what is stored (for tests). */
export function reloadPins(): void {
  usePins.setState({ pins: read() });
}

// The LaTeX editor's per-computer choices: build while typing (and how long
// to wait after the last key), and the width of the file tree and preview.
// Kept in the webview's storage; if that is unavailable the editor still works
// with the usual values.

import { create } from "zustand";

export const MIN_DELAY = 300;
export const MAX_DELAY = 2000;
export const USUAL_DELAY = 500;
export const USUAL_TREE = 200;
export const USUAL_PREVIEW = 480;

export interface LatexPrefs {
  /** Build a moment after typing stops. */
  autoBuild: boolean;
  /** How long to wait after the last key, in ms (300 to 2000). */
  delayMs: number;
  treeOpen: boolean;
  treeWidth: number;
  previewWidth: number;
}

const USUAL: LatexPrefs = { autoBuild: true, delayMs: USUAL_DELAY, treeOpen: true, treeWidth: USUAL_TREE, previewWidth: USUAL_PREVIEW };
const KEY = "kasten.latex.prefs";

/** A delay inside the allowed range; anything that is not a number is the usual one. */
export const clampDelay = (ms: unknown): number => (typeof ms === "number" && Number.isFinite(ms) ? Math.min(MAX_DELAY, Math.max(MIN_DELAY, Math.round(ms))) : USUAL_DELAY);

function width(value: unknown, usual: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(900, Math.max(120, Math.round(value))) : usual;
}

/** What storage holds, mended: wrong kinds fall back to the usual value. */
export function readPrefs(raw: string | null): LatexPrefs {
  let data: Partial<Record<keyof LatexPrefs, unknown>> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object") data = parsed as typeof data;
  } catch {
    // Unreadable: the usual values.
  }
  return {
    autoBuild: typeof data.autoBuild === "boolean" ? data.autoBuild : USUAL.autoBuild,
    delayMs: clampDelay(data.delayMs),
    treeOpen: typeof data.treeOpen === "boolean" ? data.treeOpen : USUAL.treeOpen,
    treeWidth: width(data.treeWidth, USUAL_TREE),
    previewWidth: width(data.previewWidth, USUAL_PREVIEW),
  };
}

function load(): LatexPrefs {
  try {
    return readPrefs(localStorage.getItem(KEY));
  } catch {
    return { ...USUAL };
  }
}

interface PrefsStore extends LatexPrefs {
  set(next: Partial<LatexPrefs>): void;
}

export const useLatexPrefs = create<PrefsStore>()((set, get) => ({
  ...load(),
  set(next) {
    const merged = { ...get(), ...next };
    const clean: LatexPrefs = { autoBuild: merged.autoBuild, delayMs: clampDelay(merged.delayMs), treeOpen: merged.treeOpen, treeWidth: width(merged.treeWidth, USUAL_TREE), previewWidth: width(merged.previewWidth, USUAL_PREVIEW) };
    set(clean);
    try {
      localStorage.setItem(KEY, JSON.stringify(clean));
    } catch {
      // Not kept; it still holds for this session.
    }
  },
}));

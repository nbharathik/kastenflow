// Zooming the whole window, as a browser does with Ctrl+= and Ctrl+-: the
// app's webview is scaled, so every view grows or shrinks together. Each
// display keeps its own level, because a laptop panel and a 4K monitor want
// different sizes: dragging the window to another display brings that
// display's level with it. Until someone picks a level, "Auto" chooses one
// from how wide the display is.

import { getCurrentWebview } from "@tauri-apps/api/webview";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { create } from "zustand";

import { inTauri } from "./api";

/** The levels Ctrl+= and Ctrl+- step through. */
export const LEVELS = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;
/** The levels Settings offers beside Auto. */
export const CHOICES = [0.9, 1, 1.1, 1.25, 1.5] as const;

/** A level picked by hand, or "auto" to follow the display's width. */
export type ZoomChoice = "auto" | number;

/** A display, told apart from the others by name, size and scale; `width`
 * is its width in logical pixels, which is what Auto looks at. */
export interface Display {
  key: string;
  width: number;
}

/** What Tauri says about a monitor. */
interface MonitorLike {
  name: string | null;
  size: { width: number; height: number };
  scaleFactor: number;
}

export function displayOf(monitor: MonitorLike): Display {
  const scale = monitor.scaleFactor > 0 ? monitor.scaleFactor : 1;
  const { width, height } = monitor.size;
  return { key: `${monitor.name ?? "display"} ${width}x${height} @${scale}`, width: Math.round(width / scale) };
}

/** The level Auto picks for a display `width` logical pixels wide. An
 * unknown width (a browser tab, which has its own zoom) stays at 100%. */
export function autoLevel(width: number): number {
  if (!(width > 0)) return 1;
  if (width < 1400) return 0.9;
  if (width <= 2200) return 1;
  return width <= 3000 ? 1.1 : 1.25;
}

/** The level a choice comes to on a display. */
export const levelOf = (choice: ZoomChoice, display: Display): number => (choice === "auto" ? autoLevel(display.width) : choice);

/** The level one step in `direction` from `level`, or 1 for 0. */
export function stepZoom(level: number, direction: -1 | 0 | 1): number {
  if (direction === 0) return 1;
  const at = LEVELS.findIndex((l) => l >= level);
  const here = at < 0 ? LEVELS.length - 1 : at;
  return LEVELS[Math.max(0, Math.min(LEVELS.length - 1, here + direction))]!;
}

// What is kept, in this browser's storage: a level or "auto" for each display;
// the level last shown, so a window can open at it before it has asked which
// display it is on; and the single level older versions kept for every display.
const BY_DISPLAY = "kasten.zoom.byDisplay";
const LAST = "kasten.zoom.last";
const OLD = "kasten.zoom";
/** Displays remembered; the longest-known go first when there are more. */
const KEPT = 24;

const isLevel = (value: unknown): value is number => typeof value === "number" && (LEVELS as readonly number[]).includes(value);
const isChoice = (value: unknown): value is ZoomChoice => value === "auto" || isLevel(value);

function read(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

function savedChoices(): Record<string, ZoomChoice> {
  const saved = read(BY_DISPLAY);
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
  return Object.fromEntries(Object.entries(saved).filter((entry): entry is [string, ZoomChoice] => isChoice(entry[1])));
}

/** The level an older version kept for every display, if it kept one. */
const oldLevel = (): number | null => {
  const level = read(OLD);
  return isLevel(level) ? level : null;
};

/** Remembers `choice` for a display. */
export function keepChoice(key: string, choice: ZoomChoice): void {
  const next = { ...savedChoices(), [key]: choice };
  const keys = Object.keys(next);
  for (const old of keys.slice(0, Math.max(0, keys.length - KEPT))) if (old !== key) delete next[old];
  try {
    localStorage.setItem(BY_DISPLAY, JSON.stringify(next));
  } catch {
    // The display starts again next time.
  }
}

/** What a display is set to. One that was never set takes the old single
 * level, once, and then keeps its own; with no old level it follows Auto. */
export function choiceFor(key: string): ZoomChoice {
  const saved = savedChoices()[key];
  if (saved !== undefined) return saved;
  const old = oldLevel();
  if (old === null) return "auto";
  keepChoice(key, old);
  return old;
}

/** Where to start before the display is known: the level shown last time. */
function startLevel(): number {
  const last = read(LAST);
  return isLevel(last) ? last : (oldLevel() ?? 1);
}

function rememberLevel(level: number): void {
  try {
    localStorage.setItem(LAST, JSON.stringify(level));
  } catch {
    // Opens at 100% until the display is known.
  }
}

/** What the window does for zoom: ask which display it is on, scale the
 * page, and say when it may have moved. Tauri's and the browser's differ. */
export interface ZoomHost {
  display(): Promise<Display>;
  apply(level: number): Promise<void>;
  /** Calls `changed` when the window may be on another display; resolves to the stop. */
  watch(changed: () => void): Promise<() => void>;
}

const browserHost: ZoomHost = {
  display: async () => ({ key: "browser", width: 0 }),
  apply: async (level) => {
    document.documentElement.style.setProperty("zoom", level === 1 ? "" : String(level));
  },
  watch: async () => () => {},
};

const tauriHost: ZoomHost = {
  async display() {
    const monitor = await currentMonitor().catch(() => null);
    return monitor ? displayOf(monitor) : browserHost.display();
  },
  apply: (level) => getCurrentWebview().setZoom(level),
  async watch(changed) {
    const win = getCurrentWindow();
    const stops = await Promise.all([win.onScaleChanged(changed), win.onMoved(changed)]);
    return () => stops.forEach((stop) => stop());
  },
};

const hostNow = (): ZoomHost => (inTauri() ? tauriHost : browserHost);

/** What this window shows: the choice for its display and the level it comes to. */
export const useZoom = create<{ choice: ZoomChoice; level: number; auto: number }>()(() => ({ choice: "auto", level: 1, auto: 1 }));

/** Moves of the window are many: it looks again once it has settled. */
const SETTLE_MS = 300;

export function createZoom(host: () => ZoomHost) {
  let shown: string | null = null;
  let applied = 1;
  let chain: Promise<unknown> = Promise.resolve();

  /** One at a time, so a move and a key press never cross. */
  const queued = <T>(job: () => Promise<T>): Promise<T> => {
    const run = chain.then(job);
    // The chain only keeps order; the caller of `run` gets its failure (Settings says it).
    chain = run.catch(() => {});
    return run;
  };

  async function show(display: Display, choice: ZoomChoice): Promise<number> {
    const level = levelOf(choice, display);
    if (level !== applied) {
      await host().apply(level);
      applied = level;
    }
    rememberLevel(level);
    useZoom.setState({ choice, level, auto: autoLevel(display.width) });
    return level;
  }

  /** Looks for the display the window is on, and shows its level. */
  const refresh = (force = false) =>
    queued(async () => {
      const display = await host().display();
      if (!force && display.key === shown) return;
      shown = display.key;
      await show(display, choiceFor(display.key));
    });

  /** Sets this display to `choice`, or with a function to what it makes of the level now. */
  const choose = (pick: ZoomChoice | ((now: number) => number)) =>
    queued(async () => {
      const display = await host().display();
      shown = display.key;
      const choice = typeof pick === "function" ? pick(levelOf(choiceFor(display.key), display)) : pick;
      keepChoice(display.key, choice);
      return show(display, choice);
    });

  return {
    refresh,
    /** Zooms in, out or back to 100% for the display the window is on, keeps the level and returns it. */
    zoomBy: (direction: -1 | 0 | 1) => choose((now) => stepZoom(now, direction)),
    /** Picks a level for the display the window is on, or Auto. */
    choose: (choice: ZoomChoice) => choose(choice),
    /** At start-up: the level of last time at once (before the first paint), then
     * the display's own; and a look again when the window moves or its scale changes. */
    start(): void {
      // Nobody asked for these at start-up: a window that cannot be scaled stays at 100%, and the
      // next look at the display (below) or a click in Settings tries again and says why.
      const last = startLevel();
      if (last !== 1) {
        void queued(async () => {
          await host().apply(last);
          applied = last;
        }).catch(() => {});
      }
      // The same look, at start and after the window settles on a display.
      void refresh().catch(() => {});
      let timer: ReturnType<typeof setTimeout> | undefined;
      const changed = () => {
        clearTimeout(timer);
        timer = setTimeout(() => void refresh().catch(() => {}), SETTLE_MS);
      };
      // Without the watch a moved window keeps its level until the next start.
      void host().watch(changed).catch(() => {});
    },
  };
}

const zoom = createZoom(hostNow);

export const zoomBy = zoom.zoomBy;
export const chooseZoom = zoom.choose;
export const startZoom = zoom.start;

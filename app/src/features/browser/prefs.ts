// What the person chose for the browser: the search engine, favourite sites,
// where web links in pages open, and, mirrored from the app, whether the
// browser is on at all (it is off until turned on in Settings). Kept in this
// window's storage; the switch itself is the app's (src-tauri/src/browser).

import { useEffect } from "react";
import { create } from "zustand";

import { browserBackend } from "./backend";

export interface Engine {
  name: string;
  /** The address of a search, with `%s` where the words go. */
  url: string;
}

export interface Favourite {
  title: string;
  url: string;
}

/** Where a web link in a page opens: the system's browser, or a Kasten browser tab to the right. */
export type WebLinks = "system" | "tab";

export const ENGINES: readonly Engine[] = [
  { name: "Google", url: "https://www.google.com/search?q=%s" },
  { name: "DuckDuckGo", url: "https://duckduckgo.com/?q=%s" },
  { name: "Bing", url: "https://www.bing.com/search?q=%s" },
  { name: "Brave", url: "https://search.brave.com/search?q=%s" },
  { name: "Wikipedia", url: "https://en.wikipedia.org/w/index.php?search=%s" },
];

interface Stored {
  engine: string;
  /** Engines the person added, beside the usual ones. */
  custom: Engine[];
  favourites: Favourite[];
  webLinks: WebLinks;
}

interface BrowserPrefs extends Stored {
  /** The browser is on (the app's switch, read at start and when it changes). */
  enabled: boolean;
  /** The switch has been read. */
  known: boolean;
  set(patch: Partial<Stored>): void;
  /** Reads the switch from the app. */
  refresh(): Promise<void>;
  /** Turns the browser on or off; says whether it is on after. */
  turn(on: boolean): Promise<boolean>;
}

const KEY = "kasten.browser";
const DEFAULTS: Stored = { engine: "Google", custom: [], favourites: [], webLinks: "system" };

const isText = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

/** An address with `%s` for the words, on the web. */
export function validEngineUrl(url: string): boolean {
  const text = url.trim();
  return /^https?:\/\/[^\s/]+\S*$/i.test(text) && text.split("%s").length === 2;
}

function readList<T>(value: unknown, read: (item: Record<string, unknown>) => T | null, most: number): T[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (item && typeof item === "object" ? read(item as Record<string, unknown>) : null))
    .filter((item): item is T => item !== null)
    .slice(0, most);
}

function load(): Stored {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Record<keyof Stored, unknown>>;
    return {
      engine: isText(saved.engine) ? saved.engine : DEFAULTS.engine,
      custom: readList(saved.custom, (e) => (isText(e.name) && isText(e.url) && validEngineUrl(e.url) ? { name: e.name.trim(), url: e.url.trim() } : null), 12),
      favourites: readList(saved.favourites, (f) => (isText(f.url) && /^https?:\/\//i.test(f.url.trim()) ? { title: isText(f.title) ? f.title.trim() : f.url.trim(), url: f.url.trim() } : null), 40),
      webLinks: saved.webLinks === "tab" ? "tab" : "system",
    };
  } catch {
    return DEFAULTS;
  }
}

function save({ engine, custom, favourites, webLinks }: Stored): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ engine, custom, favourites, webLinks }));
  } catch {
    // The choices fall back to the usual ones next time.
  }
}

export const useBrowserPrefs = create<BrowserPrefs>()((set, get) => ({
  ...load(),
  enabled: false,
  known: false,
  set(patch) {
    set(patch);
    save(get());
  },
  async refresh() {
    const enabled = await browserBackend().enabled().catch(() => false);
    set({ enabled, known: true });
  },
  async turn(on) {
    const enabled = await browserBackend().setEnabled(on);
    set({ enabled, known: true });
    return enabled;
  },
}));

/** Every engine the person can pick: the usual ones, then their own. */
export const enginesOf = (custom: readonly Engine[]): Engine[] => [...ENGINES, ...custom];

/** The engine named `name`, else the first. */
export const engineNamed = (custom: readonly Engine[], name: string): Engine => enginesOf(custom).find((e) => e.name === name) ?? ENGINES[0]!;

/** Whether the browser is on, for views that list it (the sidebar, the "+" menu); reads the switch once. */
export function useBrowserOn(): boolean {
  const enabled = useBrowserPrefs((s) => s.enabled);
  useEffect(() => {
    if (useBrowserPrefs.getState().known || loading) return;
    loading = true;
    void useBrowserPrefs.getState().refresh();
  }, []);
  return enabled;
}

let loading = false;

/** For tests: forgets that the switch was asked for. */
export function resetBrowserPrefs(): void {
  loading = false;
  useBrowserPrefs.setState({ ...load(), enabled: false, known: false });
}

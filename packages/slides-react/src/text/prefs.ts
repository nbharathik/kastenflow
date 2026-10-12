// What the editor corrects as words are typed. Each is a choice the person makes
// once and expects to find again in this browser; browser storage can be
// missing, full or refused (a private window), and then nothing is remembered.

export interface TextPrefs {
  /** `-` and `1.` at the start of a line begin a list. */
  autoLists: boolean;
  /** An address typed and followed by a space or Enter becomes a link. */
  autoLinks: boolean;
  /** `--`, `...`, `(c)`, `->` and `:smile:` become the sign they stand for. */
  autocorrect: boolean;
  /** Straight quotes become curly ones. */
  smartQuotes: boolean;
}

const KEY = "ks-text-prefs";

const DEFAULTS: TextPrefs = { autoLists: true, autoLinks: true, autocorrect: true, smartQuotes: true };

let current: TextPrefs | null = null;
const listeners = new Set<() => void>();

function read(): TextPrefs {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (stored === null || typeof stored !== "object") return { ...DEFAULTS };
    const flags = stored as Record<string, unknown>;
    const flag = (name: keyof TextPrefs): boolean => (typeof flags[name] === "boolean" ? (flags[name] as boolean) : DEFAULTS[name]);
    return { autoLists: flag("autoLists"), autoLinks: flag("autoLinks"), autocorrect: flag("autocorrect"), smartQuotes: flag("smartQuotes") };
  } catch {
    return { ...DEFAULTS };
  }
}

/** The corrections that are on. */
export function textPrefs(): TextPrefs {
  current ??= read();
  return current;
}

/** Changes some of them, and remembers it. */
export function setTextPrefs(change: Partial<TextPrefs>): void {
  current = { ...textPrefs(), ...change };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Nothing is remembered; the choice still holds for this window.
  }
  for (const listener of listeners) listener();
}

/** Calls `listener` whenever a choice changes; returns how to stop. */
export function subscribeTextPrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Every correction on, whatever is stored: what a test or a host that wants no choices uses. */
export const ALL_ON: Readonly<TextPrefs> = DEFAULTS;

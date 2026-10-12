// What the chrome (bars, panels, pickers) remembers in this browser: its density, the width of the side panel, which sections of
// the format options are folded, the fonts and colours used lately. Browser storage can be missing, full or refused (a private
// window, blocked site data): then nothing is kept and everything still works as it does at first.

const PREFIX = "ks-chrome-";

/** A value kept under `key`; `fallback` when there is none or it cannot be read, or `accept` does not like it. */
export function readStored<T>(key: string, fallback: T, accept: (value: unknown) => value is T): T {
  try {
    const text = localStorage.getItem(PREFIX + key);
    if (text === null) return fallback;
    const value: unknown = JSON.parse(text);
    return accept(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Not kept; the choice still holds for this window.
  }
}

export const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

export const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export const isFlagMap = (value: unknown): value is Record<string, boolean> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.values(value).every((flag) => typeof flag === "boolean");

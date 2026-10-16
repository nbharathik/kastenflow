// Window choices the person makes once and expects to find again in this browser. Browser storage can be missing, full or refused
// (a private window, blocked site data): then nothing is remembered and the editor works as it does at first.

/** Whether the filmstrip shows the badges that flag problems on its slides ("1" or "0"). */
export const LINT_BADGES_KEY = "ks-lint-badges";

/** Whether a new slide copies the layout of the slide shown ("1") or starts blank ("0"; blank is what it does until the person says otherwise). */
export const NEW_SLIDES_KEY = "ks-new-slides-like-current";

/** What a new slide starts from: "blank", "same" (the layout of the slide shown) or "mine" (the deck's own default layout). Older builds kept only the yes or no above. */
export const NEW_SLIDES_MODE_KEY = "ks-new-slides";

/** How wide the filmstrip is, in pixels. */
export const FILMSTRIP_WIDTH_KEY = "ks-filmstrip-width";

/** How wide the web preview is when it stands at the side, in pixels. */
export const WEB_PREVIEW_WIDTH_KEY = "ks-web-preview-width";

/** A whole number kept under `key`, held between `min` and `max`; `fallback` when there is none, or it cannot be read. */
export function readNumber(key: string, fallback: number, min: number, max: number): number {
  try {
    const stored = localStorage.getItem(key);
    const value = stored === null ? Number.NaN : Number(stored);
    return Number.isFinite(value) ? Math.min(Math.max(Math.round(value), min), max) : fallback;
  } catch {
    return fallback;
  }
}

export function writeNumber(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(Math.round(value)));
  } catch {
    // Nothing is remembered; the size still holds for this window.
  }
}

/** The word kept under `key` when it is one of `allowed`; `fallback` when there is none, or it cannot be read. */
export function readChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    return allowed.find((choice) => choice === stored) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeChoice(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Nothing is remembered; the choice still holds for this window.
  }
}

/** A yes or no kept under `key`; `fallback` when there is none, or it cannot be read. */
export function readFlag(key: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    return stored === "1" ? true : stored === "0" ? false : fallback;
  } catch {
    return fallback;
  }
}

export function writeFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    // Nothing is remembered; the choice still holds for this window.
  }
}

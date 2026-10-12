// How tall each embedded whiteboard was left, by its path: what the person
// sees in this browser, not part of the page, so it is kept here and never in
// the Markdown.

const STORAGE = "kasten.embedHeights";

/** The shortest and tallest an embedded whiteboard can be made, in pixels. */
export const MIN_HEIGHT = 200;
export const MAX_HEIGHT = 1200;
/** What a whiteboard that was never resized gets. */
export const DEFAULT_HEIGHT = 440;
/** Boards remembered at most; the one set longest ago is forgotten first. */
const MOST = 300;

export const clampHeight = (height: number) => Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, height)));

function read(): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** The height kept for the board at `path`, or the default. */
export function heightOf(path: string): number {
  const kept = read()[path];
  return typeof kept === "number" && Number.isFinite(kept) ? clampHeight(kept) : DEFAULT_HEIGHT;
}

/** Keeps `height` for the board at `path`. */
export function keepHeight(path: string, height: number): void {
  const kept = read();
  // Set again, a board goes to the end of the order, so the oldest are the ones forgotten.
  delete kept[path];
  kept[path] = clampHeight(height);
  const paths = Object.keys(kept);
  for (const old of paths.slice(0, Math.max(0, paths.length - MOST))) delete kept[old];
  try {
    localStorage.setItem(STORAGE, JSON.stringify(kept));
  } catch {
    // A convenience only.
  }
}

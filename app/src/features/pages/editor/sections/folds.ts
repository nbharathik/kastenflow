// Which sections of a page are folded is what the person was looking at, not
// part of the page: it is kept in this browser, per page, and the Markdown
// never learns of it. A page is told by its note id (its path while it is a
// draft); a section by its title and which time that title comes up, since
// its position moves as the page is written.

const STORAGE = "kasten.folds";
/** Pages whose folds are kept at most; the one used longest ago goes first. */
export const MOST_PAGES = 300;

/** A folded section's name: its title, and which of that name it is (0 first). */
export interface FoldName {
  title: string;
  nth: number;
}

type Kept = [page: string, folds: [title: string, nth: number][]][];

function read(): Kept {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE) ?? "[]");
    return Array.isArray(parsed) ? (parsed as Kept).filter((entry) => Array.isArray(entry) && typeof entry[0] === "string" && Array.isArray(entry[1])) : [];
  } catch {
    return [];
  }
}

function write(kept: Kept): void {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(kept.slice(-MOST_PAGES)));
  } catch {
    // A convenience only: nothing is lost but the folds.
  }
}

/** The folds kept for `page`, which counts as used just now. */
export function readFolds(page: string | null): FoldName[] {
  if (!page) return [];
  const kept = read();
  const at = kept.findIndex((entry) => entry[0] === page);
  if (at < 0) return [];
  const [entry] = kept.splice(at, 1);
  // Opening a page keeps it among those remembered.
  if (at !== kept.length) write([...kept, entry!]);
  return entry![1].map(([title, nth]) => ({ title: String(title), nth: Number(nth) || 0 }));
}

/** Keeps `folds` for `page`; none forgets it. */
export function writeFolds(page: string | null, folds: readonly FoldName[]): void {
  if (!page) return;
  const kept = read().filter((entry) => entry[0] !== page);
  if (folds.length > 0) kept.push([page, folds.map((f) => [f.title, f.nth])]);
  write(kept);
}

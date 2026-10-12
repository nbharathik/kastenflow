// Find and replace across a page and its sub-pages: the shapes of
// kasten-core's `find_under` and `replace_under` (serde, camelCase) and the
// two calls. The search reads the Markdown as written, so a phrase broken by
// formatting (`foo **bar**`) is not found as `foo bar`; the preview should
// say so.

/** What to look for. */
export interface FindSpec {
  /** 1 to 200 characters of one line. */
  query: string;
  /** Capitals must agree. */
  matchCase?: boolean;
  /** No letter, digit or underscore beside the match. */
  wholeWord?: boolean;
}

/** A match with the text around it on its line. */
export interface MatchSample {
  /** Line of the page's body, from 0. */
  line: number;
  /** Up to 40 characters before the match. */
  before: string;
  /** The matched text, as written. */
  text: string;
  /** Up to 40 characters after it. */
  after: string;
}

/** A page with matches, as the preview shows it. */
export interface NoteMatches {
  path: string;
  title: string;
  /** Passed back in `Expected`, so a page that changed since is noticed. */
  hash: string;
  /** Matches in the page's text (not its frontmatter or title). */
  count: number;
  /** The first few matches. */
  samples: MatchSample[];
  /** The title holds the text. Titles are not replaced (a rename rewrites
   * the links to the page): offer Rename instead. */
  titleHit: boolean;
  /** A locked page is never replaced in: leave it out of the request. */
  locked: boolean;
}

/** What the preview showed for a page. */
export interface Expected {
  path: string;
  hash: string;
  count: number;
}

/** Replace what the preview showed, in the pages under `root` (an id or a path). */
export interface ReplaceRequest {
  root: string;
  spec: FindSpec;
  /** 0 to 1,000 characters of one line. */
  with: string;
  expect: Expected[];
}

/** What a replace did. */
export interface Replaced {
  /** The commit it made: Undo takes it back whole (`undoCommit`). Null in the browser preview. */
  commit: string | null;
  /** The pages changed, with how many matches each held. */
  notes: [string, number][];
  total: number;
}

/** The limits the core keeps. */
export const REPLACE_LIMITS = { queryChars: 200, withChars: 1000, notes: 200, replacements: 5000 } as const;

/** What the core's refusal says when a page differs from the preview. */
const STALE = "changed since the preview";

/** Whether a failed replace was refused because pages changed since the
 * preview: nothing was written, and the person should look again. */
export function replaceWasStale(error: unknown): boolean {
  return (error instanceof Error ? error.message : String(error)).includes(STALE);
}

export interface ReplaceOps {
  /** The pages under `root` (the page and its sub-pages, all the way down;
   * an id or a path) whose text or title holds the text, at most `maxNotes`
   * (default 200: ask for one more than you show to know there are more).
   * Writes nothing. */
  findUnder(root: string, spec: FindSpec, maxNotes?: number): Promise<NoteMatches[]>;
  /** Replaces in the listed pages, all or none, as one change `undoCommit`
   * takes back. Refused if any page changed since the preview. Save open
   * pages first. */
  replaceUnder(request: ReplaceRequest): Promise<Replaced>;
}

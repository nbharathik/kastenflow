// The browser preview's comment and highlight files, as kasten-core's
// comments/ and text_highlights/ keep them: one JSON object kept as it was
// read (so keys the app does not know survive), with an entry to a line.
// Inside the app the core does all of this.

import { ANNOTATION_LIMITS, TEXT_HIGHLIGHT_COLORS, type CommentAnchor, type CommentResolved, type PageComment, type TextAnchor, type TextHighlight } from "../../../lib/vault/annotation-types";

export const COMMENTS = ".comments.json";
export const HIGHLIGHTS = ".highlights.json";
export const SUFFIXES = [COMMENTS, HIGHLIGHTS] as const;

export type Item = Record<string, unknown>;
export type Doc = Record<string, unknown>;

/** The file beside the Markdown note at `note`: `a/b.md` has `a/b.comments.json`. */
export function sidecarOf(note: string, suffix: string): string | null {
  return note.endsWith(".md") && note.length > ".md".length && !note.endsWith("/.md") ? `${note.slice(0, -".md".length)}${suffix}` : null;
}

/** Whether a path is one of the files that go with a page. */
export const isSidecar = (path: string) => SUFFIXES.some((suffix) => path.endsWith(suffix));

/** Whether an id can sit in a file name and a link as it is. */
export const plainId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);

const isObject = (value: unknown): value is Item => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (item: Item | undefined, key: string): string | undefined => (typeof item?.[key] === "string" ? (item[key] as string) : undefined);

/** A file in any JSON formatting, with its array of entries; `what` names it in the message when it is not one. */
export function parseDoc(text: string | undefined, key: string, format: string, what: string): Doc {
  if (text === undefined) return { format, [key]: [] };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    throw new Error(`Not ${what}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
  if (!isObject(value)) throw new Error(`Not ${what}: the top level is not an object`);
  if (value[key] === undefined) return { ...value, [key]: [] };
  if (!Array.isArray(value[key])) throw new Error(`Not ${what}: \`${key}\` is not an array`);
  return value;
}

/** The entries of a file. */
export const itemsOf = (doc: Doc, key: string): Item[] => doc[key] as Item[];

/** A file in the core's layout: an entry to a line. */
export function writeDoc(doc: Doc, key: string): string {
  const parts = Object.entries(doc).map(([k, value]) => {
    const items = value as Item[];
    return k === key && items.length > 0 ? `  ${JSON.stringify(k)}: [\n${items.map((item) => `    ${JSON.stringify(item)}`).join(",\n")}\n  ]` : `  ${JSON.stringify(k)}: ${JSON.stringify(value)}`;
  });
  return `{\n${parts.join(",\n")}\n}\n`;
}

const tooLong = (what: string, max: number) => new Error(`A comment's ${what} is at most ${max} characters`);

/** Why a comment's place cannot be kept, as the core says it. */
export function checkAnchor(anchor: CommentAnchor): void {
  const { section, nth, quote, prefix, suffix } = anchor;
  if ([...section].length > ANNOTATION_LIMITS.section) throw tooLong("section", ANNOTATION_LIMITS.section);
  // eslint-disable-next-line no-control-regex -- a section's title is on one line
  if (/[\u0000-\u001f\u007f-\u009f]/.test(section)) throw new Error("A section's title is on one line");
  if (!Number.isInteger(nth) || nth < 1 || nth > 100_000) throw new Error("Sections of the same title count from 1");
  if (quote !== undefined && [...quote].length > ANNOTATION_LIMITS.quote) throw tooLong("quote", ANNOTATION_LIMITS.quote);
  for (const [what, text] of [["context before the quote", prefix], ["context after the quote", suffix]] as const) {
    if (text !== undefined && [...text].length > ANNOTATION_LIMITS.context) throw tooLong(what, ANNOTATION_LIMITS.context);
  }
}

export function checkCommentText(text: string): void {
  if (!text.trim()) throw new Error("A comment needs some words");
  if ([...text].length > ANNOTATION_LIMITS.comment) throw tooLong("text", ANNOTATION_LIMITS.comment);
}

/** The JSON of a comment's place, keeping the keys `old` has that this does not know. */
export function anchorItem(anchor: CommentAnchor, old: Item = {}): Item {
  const out: Item = { ...old, section: anchor.section, nth: anchor.nth };
  for (const key of ["quote", "prefix", "suffix"] as const) {
    if (anchor[key] === undefined) delete out[key];
    else out[key] = anchor[key];
  }
  return out;
}

/** A comment from its JSON; null for an entry without a usable id. */
export function commentOf(item: Item): PageComment | null {
  if (!plainId(item.id)) return null;
  const at = isObject(item.anchor) ? item.anchor : undefined;
  const nth = typeof at?.nth === "number" && Number.isInteger(at.nth) && at.nth >= 1 ? at.nth : 1;
  const anchor: CommentAnchor = { section: str(at, "section") ?? "", nth };
  for (const key of ["quote", "prefix", "suffix"] as const) {
    const value = str(at, key);
    if (value !== undefined) anchor[key] = value;
  }
  let resolved: CommentResolved | null = null;
  if (isObject(item.resolved)) resolved = { at: str(item.resolved, "at") ?? "", by: str(item.resolved, "by") ?? "" };
  else if (item.resolved === true) resolved = { at: "", by: "" };
  return { id: item.id, anchor, text: str(item, "text") ?? "", author: str(item, "author") ?? "", created: str(item, "created") ?? null, resolved };
}

export function checkTextAnchor(anchor: TextAnchor): void {
  if (!anchor.quote.trim()) throw new Error("A highlight needs the words it marks");
  if ([...anchor.quote].length > ANNOTATION_LIMITS.highlightQuote) throw new Error(`A highlight marks at most ${ANNOTATION_LIMITS.highlightQuote} characters`);
  for (const [what, text] of [["context before the quote", anchor.prefix], ["context after the quote", anchor.suffix], ["section", anchor.section]] as const) {
    if (text !== undefined && [...text].length > ANNOTATION_LIMITS.context) throw new Error(`A highlight's ${what} is at most ${ANNOTATION_LIMITS.context} characters`);
  }
}

export function checkColor(color: string): void {
  if (!(TEXT_HIGHLIGHT_COLORS as readonly string[]).includes(color)) throw new Error(`A highlight is ${TEXT_HIGHLIGHT_COLORS.join(", ")}, not ${color}`);
}

export function checkCommentLength(comment: string): void {
  if ([...comment].length > ANNOTATION_LIMITS.comment) throw new Error(`A highlight's comment is at most ${ANNOTATION_LIMITS.comment} characters`);
}

/** The JSON of a highlight's place, keeping the keys `old` has that this does not know. */
export function textAnchorItem(anchor: TextAnchor, old: Item = {}): Item {
  const out: Item = { ...old, quote: anchor.quote };
  for (const key of ["prefix", "suffix", "section"] as const) {
    if (anchor[key] === undefined) delete out[key];
    else out[key] = anchor[key];
  }
  return out;
}

/** A highlight from its JSON; null for an entry without a usable id or quote. */
export function highlightOf(item: Item): TextHighlight | null {
  if (!plainId(item.id) || !isObject(item.anchor)) return null;
  const quote = str(item.anchor, "quote");
  if (!quote?.trim()) return null;
  const anchor: TextAnchor = { quote };
  for (const key of ["prefix", "suffix", "section"] as const) {
    const value = str(item.anchor, key);
    if (value !== undefined) anchor[key] = value;
  }
  return { id: item.id, anchor, color: str(item, "color") ?? TEXT_HIGHLIGHT_COLORS[0], comment: str(item, "comment") ?? null, created: str(item, "created") ?? null };
}

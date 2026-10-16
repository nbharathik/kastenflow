// A paper being added: what was found (pasted BibTeX, a citation, an
// identifier, a page's tags, a PDF's first page), what was only guessed, and
// what is still missing. Nothing is invented: a field nobody supplied stays
// empty and is marked incomplete.

import type { KeyHints, NewReference } from "../../lib/vault/reference-types";

export type DraftOrigin = "bibtex" | "citation" | "identifier" | "page" | "pdf" | "blank";

export interface PaperDraft {
  /** The entry type: `article`, `inproceedings`... */
  type: string;
  /** Empty until one is made; the person may change it. */
  key: string;
  /** By lower-case name. */
  fields: Record<string, string>;
  /** Fields that were read by guessing, which the form marks to be checked. */
  guessed: string[];
  origin: DraftOrigin;
  /** Something to tell the person about how this was read, if anything. */
  note: string | null;
}

export const blankDraft = (): PaperDraft => ({ type: "article", key: "", fields: {}, guessed: [], origin: "blank", note: null });

const has = (fields: Record<string, string>, ...names: string[]): boolean => names.some((name) => (fields[name] ?? "").trim() !== "");

/** What an entry of this type should say and does not, in the order the form lists them: title, authors, year, then where it appeared. */
export function missingOf(type: string, fields: Record<string, string>): string[] {
  const out: string[] = [];
  if (!has(fields, "title")) out.push("title");
  if (!has(fields, "author", "editor")) out.push("author");
  if (!has(fields, "year", "date")) out.push("year");
  const kind = type.toLowerCase();
  if (kind === "article" && !has(fields, "journal", "journaltitle")) out.push("journal");
  if ((kind === "inproceedings" || kind === "incollection") && !has(fields, "booktitle")) out.push("booktitle");
  return out;
}

/** `base`, with each field it leaves blank taken from `extra` (which keeps its guesses for what it gave). The person's words stay. */
export function fillBlanks(base: PaperDraft, extra: PaperDraft): PaperDraft {
  const fields = { ...base.fields };
  const guessed = new Set(base.guessed);
  for (const [name, value] of Object.entries(extra.fields)) {
    if (value.trim() === "" || (fields[name] ?? "").trim() !== "") continue;
    fields[name] = value;
    if (extra.guessed.includes(name)) guessed.add(name);
  }
  return { ...base, type: base.type || extra.type, fields, guessed: [...guessed], note: base.note ?? extra.note };
}

/** The fields with a value, trimmed. */
export function trimmedFields(fields: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(fields)) if (value.trim() !== "") out[name] = value.trim();
  return out;
}

/** The draft as the call that adds it takes it. */
export function newReferenceOf(draft: PaperDraft, allowDuplicate = false): NewReference {
  return { type: draft.type.trim().toLowerCase(), key: draft.key.trim(), fields: trimmedFields(draft.fields), ...(allowDuplicate ? { allowDuplicate: true } : {}) };
}

/** What a key is made from: the first author (or editor), the year, the title. */
export function keyHintsOf(fields: Record<string, string>): KeyHints {
  const hints: KeyHints = {};
  const author = (fields.author ?? "").trim() || (fields.editor ?? "").trim();
  if (author) hints.author = author;
  const year = /\d{4}/.exec(fields.year ?? "")?.[0] ?? /\d{4}/.exec(fields.date ?? "")?.[0];
  if (year) hints.year = year;
  const title = (fields.title ?? "").trim();
  if (title) hints.title = title;
  return hints;
}

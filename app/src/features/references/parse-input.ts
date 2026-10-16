// What a paste into "Add a paper" is: BibTeX, an identifier or address, or a
// citation written out. Each is read here, on this computer; a DOI or arXiv
// number fills its own field and nothing more, because no lookup is made.

import { parseBibtex } from "./bibtex";
import { blankDraft, trimmedFields, type PaperDraft } from "./draft";
import { findIdentifiers, onlyIdentifiers } from "./identifiers";
import { addIdentifiers, parseCitation } from "./plain-citation";

export type InputKind = "bibtex" | "identifier" | "citation" | "empty";

export interface ParsedInput {
  kind: InputKind;
  /** One for each entry of pasted BibTeX; one otherwise; none for nothing. */
  drafts: PaperDraft[];
}

/** Shown in the form whenever only an identifier was read. */
export const NOT_FETCHED = "Details are not fetched; fill them in or paste BibTeX.";

export function parsePaperInput(text: string): ParsedInput {
  const trimmed = text.trim();
  if (!trimmed) return { kind: "empty", drafts: [] };
  const { entries, problems } = parseBibtex(trimmed);
  if (entries.length > 0) {
    const note = problems.length > 0 ? problems.join(". ") : null;
    return { kind: "bibtex", drafts: entries.map((e) => ({ ...blankDraft(), type: e.type, key: e.key, fields: trimmedFields(e.fields), origin: "bibtex" as const, note })) };
  }
  if (onlyIdentifiers(trimmed)) {
    const ids = findIdentifiers(trimmed);
    const fields: Record<string, string> = {};
    addIdentifiers(fields, ids);
    return { kind: "identifier", drafts: [{ ...blankDraft(), type: ids.doi ? "article" : "misc", fields, origin: "identifier", note: NOT_FETCHED }] };
  }
  return { kind: "citation", drafts: [parseCitation(trimmed)] };
}

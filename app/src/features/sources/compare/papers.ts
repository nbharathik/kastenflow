// The papers a comparison offers: every reference (once, by its key) with the
// PDF that goes with it and that PDF's highlights, then the PDFs in `sources/`
// that no reference goes with, named by their titles.

import type { Highlight, SourceInfo } from "../../../lib/vault/source-types";
import { chipLabel } from "../../references/labels";
import type { RefRow } from "../../references/rows";
import type { PaperRef } from "./pages";

export interface ComparePaper extends PaperRef {
  /** Unique among the papers: the key, or `pdf:` and the path. */
  id: string;
  highlights: Highlight[];
  /** The abstract its reference holds; empty when it has none. */
  abstract: string;
}

export function papersFrom(rows: readonly RefRow[], sources: readonly SourceInfo[], highlights: Readonly<Record<string, readonly Highlight[]>>): ComparePaper[] {
  const seen = new Set<string>();
  const used = new Set<string>();
  const out: ComparePaper[] = [];
  for (const row of rows) {
    if (seen.has(row.key)) continue;
    seen.add(row.key);
    if (row.pdf) used.add(row.pdf);
    out.push({ id: row.key, key: row.key, label: chipLabel(row.entry), title: row.title || row.key, source: row.pdf, highlights: row.pdf ? [...(highlights[row.pdf] ?? [])] : [], abstract: (row.entry.fields.abstract ?? "").trim() });
  }
  for (const source of sources) {
    if (used.has(source.path)) continue;
    out.push({ id: `pdf:${source.path}`, key: null, label: source.title, title: source.title, source: source.path, highlights: [...(highlights[source.path] ?? [])], abstract: "" });
  }
  return out;
}

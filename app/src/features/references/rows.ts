// The References table as data: one row for each entry of every `.bib` file,
// with the words a person scans (authors, year, title), the link that opens it,
// what it lacks, whether the bibliography repeats it, and the PDF that goes
// with it. Filtering, searching and ordering are plain functions of the rows.

import type { BibEntry, Bibliography } from "../../lib/vault/reference-types";
import { missingOf } from "./draft";
import { linkOf, shortAuthors, workOf } from "./labels";
import type { Work } from "../sources/reader/clip/bib";

export interface RefRow {
  /** Unique among the rows: the file and the key (two files may hold one key). */
  id: string;
  key: string;
  file: string;
  /** In `sources/references.bib`, which KastenFlow edits; the others are read only. */
  managed: boolean;
  entry: BibEntry;
  work: Work;
  /** "Vaswani et al."; empty when the entry names no author. */
  authors: string;
  year: string;
  /** Plain: braces and LaTeX out. */
  title: string;
  link: { href: string; text: string } | null;
  /** Fields it lacks: never filled in on its own. */
  missing: string[];
  /** The bibliography holds another entry for the same work. */
  duplicate: boolean;
  /** The PDF in `sources/` that goes with it, if one does. */
  pdf: string | null;
}

export type RowFilter = "all" | "managed" | "external" | "incomplete" | "duplicate";
export type RowOrder = "key" | "authors" | "year" | "title";

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** The PDF that goes with an entry: the file its `file` field names (BibTeX, or Zotero's `Name:path:type`), else a PDF named like its key. */
export function pdfFor(entry: BibEntry, pdfs: readonly string[]): string | null {
  const named = (entry.fields.file ?? "")
    .split(";")
    .flatMap((piece) => [piece, ...piece.split(":")])
    .map((p) => p.trim().replace(/\\/g, "/"))
    .filter((p) => /\.pdf$/i.test(p));
  for (const path of named) if (pdfs.includes(path)) return path;
  for (const path of named) {
    const same = pdfs.filter((p) => basename(p).toLowerCase() === basename(path).toLowerCase());
    if (same.length === 1) return same[0]!;
  }
  const stem = entry.key.toLowerCase();
  return pdfs.find((p) => basename(p).replace(/\.pdf$/i, "").toLowerCase() === stem) ?? null;
}

/** The rows of the bibliography, the managed file's first. `pdfs` are the PDFs in `sources/`. */
export function buildRows(bibliography: Bibliography, pdfs: readonly string[]): RefRow[] {
  const repeated = new Set(bibliography.duplicates.flatMap((d) => d.entries.map((e) => `${e.file}::${e.key}`)));
  const files = [bibliography.managed, ...bibliography.external];
  return files.flatMap((file) =>
    file.entries.map((entry): RefRow => {
      const work = workOf(entry);
      return {
        id: `${file.path}::${entry.key}`,
        key: entry.key,
        file: file.path,
        managed: file.managed,
        entry,
        work,
        authors: shortAuthors(work),
        year: work.year,
        title: work.title,
        link: linkOf(entry),
        missing: missingOf(entry.type, entry.fields),
        duplicate: repeated.has(`${file.path}::${entry.key}`),
        pdf: pdfFor(entry, pdfs),
      };
    }),
  );
}

const haystack = (row: RefRow): string => [row.key, row.work.authors.join(" "), row.year, row.title, row.work.venue, row.entry.fields.doi ?? "", row.entry.fields.eprint ?? ""].join(" ").toLowerCase();

export function filterRows(rows: readonly RefRow[], { filter, query }: { filter: RowFilter; query: string }): RefRow[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    if (filter === "managed" && !row.managed) return false;
    if (filter === "external" && row.managed) return false;
    if (filter === "incomplete" && row.missing.length === 0) return false;
    if (filter === "duplicate" && !row.duplicate) return false;
    if (terms.length === 0) return true;
    const text = haystack(row);
    return terms.every((term) => text.includes(term));
  });
}

/** The rows in order; those that lack the thing sorted by come last, whichever way. */
export function sortRows(rows: readonly RefRow[], by: RowOrder, direction: "asc" | "desc"): RefRow[] {
  const value = (row: RefRow): string => (by === "key" ? row.key : by === "authors" ? row.work.authors.map((a) => a.toLowerCase()).join(" ") : by === "year" ? row.year : row.title);
  const sign = direction === "asc" ? 1 : -1;
  return rows
    .map((row, at) => ({ row, at, v: value(row) }))
    .sort((a, b) => {
      if (a.v === "" || b.v === "") return a.v === b.v ? a.at - b.at : a.v === "" ? 1 : -1;
      return sign * a.v.localeCompare(b.v, undefined, { numeric: true, sensitivity: "base" }) || a.at - b.at;
    })
    .map((x) => x.row);
}

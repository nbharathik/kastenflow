// How a reference is named to a person: its authors in a few words, "Vaswani et
// al., 2017" for a chip, a whole citation to copy, and the link that opens it.

import type { BibEntry } from "../../lib/vault/reference-types";
import { cite, lastName, workOfEntry, type Work } from "../sources/reader/clip/bib";
import { arxivUrl, doiUrl, findIdentifiers } from "./identifiers";

export const workOf = (entry: BibEntry): Work => workOfEntry(entry);

/** The authors in a few words: "LeCun", "Devlin and Chang", "Vaswani et al."; empty when there are none. */
export function shortAuthors(work: Work): string {
  const last = work.authors.map(lastName);
  if (last.length === 0) return "";
  if (last.length === 1 && !work.more) return last[0]!;
  if (last.length === 2 && !work.more) return `${last[0]} and ${last[1]}`;
  return `${last[0]} et al.`;
}

/** "Vaswani et al., 2017": the label of a citation chip. A work without authors is named by its title, and one with nothing by its key. */
export function chipLabel(entry: BibEntry): string {
  const work = workOf(entry);
  const named = cite(work);
  if (named) return named;
  if (work.title) return work.year ? `${shorten(work.title, 40)}, ${work.year}` : shorten(work.title, 40);
  return entry.key;
}

export function shorten(text: string, most: number): string {
  return text.length <= most ? text : `${text.slice(0, most - 1).trimEnd()}…`;
}

/** A reference written out to paste: "Vaswani, Ashish; Shazeer, Noam (2017). Attention is all you need. NeurIPS. https://doi.org/...". Parts the entry lacks are left out. */
export function fullCitation(entry: BibEntry): string {
  const work = workOf(entry);
  const who = work.authors.join("; ") + (work.more ? " et al." : "");
  const head = [who, work.year ? `(${work.year})` : ""].filter(Boolean).join(" ");
  const link = linkOf(entry);
  const parts = [head, work.title, work.venue].filter(Boolean).map((p) => p.replace(/[.\s]+$/, ""));
  return `${parts.join(". ")}.${link ? ` ${link.href}` : ""}`.trim();
}

/** The address that opens a reference (its DOI, else its arXiv page, else its own address) and the short text to show for it. */
export function linkOf(entry: BibEntry): { href: string; text: string } | null {
  const doi = findIdentifiers(entry.fields.doi ?? "").doi;
  if (doi) return { href: doiUrl(doi), text: `doi:${doi}` };
  const eprint = (entry.fields.eprint ?? "").trim();
  const isArxiv = /^arxiv$/i.test((entry.fields.archiveprefix ?? "").trim()) || /^arxiv:/i.test(eprint);
  const arxiv = isArxiv ? findIdentifiers(`arXiv:${eprint.replace(/^arxiv:/i, "")}`).arxiv : undefined;
  if (arxiv) return { href: arxivUrl(arxiv), text: `arXiv:${arxiv}` };
  const url = (entry.fields.url ?? "").trim();
  if (/^https?:\/\/[^\s/@]+(?:[/?#]|$)/i.test(url) && !/\s/.test(url)) {
    try {
      const { host, pathname } = new URL(url);
      return { href: url, text: `${host}${pathname === "/" ? "" : pathname}` };
    } catch {
      return null;
    }
  }
  return null;
}

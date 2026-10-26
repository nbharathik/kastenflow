// Citation keys for `\cite{`: the vault's References (`sources/references.bib`
// and the other `.bib` files the References view reads) and the `.bib` files in
// the document's own folder. Offline: the vault is read through the app, the
// local files through the document's own file calls.

import { cite as shortCite, readWorks, type Work, workOfEntry } from "../../../features/sources/reader/clip/bib";
import type { BibEntry } from "../../../lib/vault/reference-types";

export interface CiteItem {
  key: string;
  /** "Vaswani et al., 2017". */
  detail: string;
  title: string;
  /** Where it came from: the vault's References, or a file of the document. */
  from: string;
}

const itemOf = (work: Work, from: string): CiteItem => ({ key: work.key, detail: shortCite(work) || work.type, title: work.title, from });

/** Items from the text of a `.bib` file. */
export function citesFromBib(text: string, from: string): CiteItem[] {
  return readWorks(text).map((work) => itemOf(work, from));
}

/** Items from the entries the vault's bibliography call gave. */
export function citesFromEntries(entries: readonly BibEntry[], from: string): CiteItem[] {
  return entries.map((entry) => itemOf(workOfEntry(entry), from));
}

/** The document's own keys first, then the vault's; a key is listed once. */
export function mergeCites(...lists: CiteItem[][]): CiteItem[] {
  const seen = new Set<string>();
  const merged: CiteItem[] = [];
  for (const list of lists) {
    for (const item of list) {
      if (seen.has(item.key)) continue;
      seen.add(item.key);
      merged.push(item);
    }
  }
  return merged;
}

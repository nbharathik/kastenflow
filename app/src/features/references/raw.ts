// The raw text of an entry, for editing by hand. The client gives the text of
// every `.bib` file as one string (the managed file first, a newline after
// each), so each file's own text is cut out by the byte counts the
// bibliography call reports. If anything does not line up, that file's raw
// text is simply not offered: the structured form still works.

import type { Bibliography } from "../../lib/vault/reference-types";
import { entryTexts, parseBibtex } from "./bibtex";

const NEWLINE = 10;

/** The text of each `.bib` file by path, cut out of `all`; a file whose text cannot be found with certainty is left out. */
export function fileTexts(bibliography: Bibliography, all: string): Map<string, string> {
  const out = new Map<string, string>();
  const bytes = new TextEncoder().encode(all);
  const decoder = new TextDecoder();
  let at = 0;
  for (const file of [bibliography.managed, ...bibliography.external]) {
    // A managed file that is not made yet is not in the text; a file that was not read cleanly puts what follows in doubt.
    if (file.managed && !file.exists) continue;
    if (file.problem !== null) break;
    const end = at + file.bytes;
    if (end > bytes.length || (end < bytes.length && bytes[end] !== NEWLINE)) break;
    out.set(file.path, decoder.decode(bytes.subarray(at, end)));
    at = end + 1;
  }
  return out;
}

/** The text of the entry `key` in `text`, from its @ to its closing brace; null when it is not there. */
export function rawEntry(text: string, key: string): string | null {
  return entryTexts(text).get(key) ?? null;
}

/** Why `edited` cannot replace the entry `key`, in words; null when it can. */
export function checkRaw(key: string, edited: string): string | null {
  if (edited.trim() === "") return "Write the entry, or cancel.";
  const { entries } = parseBibtex(edited);
  const [entry] = entries;
  if (!entry) return "That is not a BibTeX entry: it starts with @type{key, and ends with }.";
  if (entries.length > 1) return `Only one entry can be edited here, and this holds ${entries.length}.`;
  if (!entry.closed) return "The entry is not closed: add the closing brace.";
  if (entry.key !== key) return `The key must stay “${key}”: to change it use Rename key, which also updates the pages and decks that cite it.`;
  if (edited.slice(0, entry.start).trim() !== "" || edited.slice(entry.end).trim() !== "") return "There is text outside the entry. Only the entry itself is replaced, so take the other words out.";
  return null;
}

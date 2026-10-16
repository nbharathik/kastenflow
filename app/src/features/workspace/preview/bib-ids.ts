// The browser preview's reading of identifiers and keys, the same as the core's
// (`slides-bib`'s `doi_key` and `arxiv_key`, kasten-core's `bib::key`): the forms people
// write a DOI or an arXiv number in put in one form, a key made from who, when and what,
// and the entries that are one work.

import type { BibEntry, Duplicate, KeyHints, MatchKind } from "../../../lib/vault/types";

/** A DOI in the form it is compared in, or null. */
export function normaliseDoi(text: string): string | null {
  const lower = text.trim().toLowerCase().replace(/%2f/g, "/");
  for (let from = 0; ; ) {
    const start = lower.indexOf("10.", from);
    if (start < 0) return null;
    from = start + 3;
    if (start > 0 && /[a-z0-9]/.test(lower[start - 1]!)) continue;
    const digits = /^\d*/.exec(lower.slice(start + 3))![0].length;
    if (digits < 4 || digits > 9 || lower[start + 3 + digits] !== "/") continue;
    const rest = lower.slice(start + 3 + digits + 1).split(/\s/)[0] ?? "";
    const suffix = rest.replace(/[.,;})>"']+$/, "");
    return suffix ? `${lower.slice(start, start + 3 + digits)}/${suffix}` : null;
  }
}

/** An arXiv identifier in the form it is compared in, or null. */
export function normaliseArxiv(text: string): string | null {
  const lower = text.trim().toLowerCase();
  const modern = /(?<!\d)(\d{4}\.\d{4,5})(?!\d)/.exec(lower);
  if (modern) return modern[1]!;
  const old = /(?<![a-z.-])([a-z]{2}[a-z.-]*\/\d{7})(?!\d)/.exec(lower);
  return old ? old[1]! : null;
}

export function doiKey(fields: Record<string, string>): string | null {
  if (fields.doi) {
    const doi = normaliseDoi(fields.doi);
    if (doi) return doi;
  }
  return fields.url?.toLowerCase().includes("doi.org/") ? normaliseDoi(fields.url) : null;
}

export function arxivKey(fields: Record<string, string>): string | null {
  const said = (name: string) => fields[name]?.trim().toLowerCase();
  if (fields.eprint) {
    const prefix = said("archiveprefix") ?? said("eprinttype") ?? "";
    const id = prefix === "" || prefix === "arxiv" ? normaliseArxiv(fields.eprint) : null;
    if (id) return id;
  }
  const doi = fields.doi ? normaliseDoi(fields.doi) : null;
  if (doi?.startsWith("10.48550/arxiv.")) return normaliseArxiv(doi.slice("10.48550/arxiv.".length));
  for (const name of ["url", "howpublished"]) {
    const at = fields[name]?.toLowerCase().indexOf("arxiv.org/") ?? -1;
    if (at >= 0) return normaliseArxiv(fields[name]!.toLowerCase().slice(at + "arxiv.org/".length));
  }
  for (const name of ["journal", "note"]) {
    const at = fields[name]?.toLowerCase().indexOf("arxiv:") ?? -1;
    if (at >= 0) return normaliseArxiv(fields[name]!.toLowerCase().slice(at + "arxiv:".length));
  }
  return null;
}

export interface Located {
  file: string;
  entry: BibEntry;
}

/** Groups of entries that look like one work: by key, then DOI, then arXiv identifier. */
export function duplicatesIn(all: Located[]): Duplicate[] {
  const groups: Record<MatchKind, Map<string, Located[]>> = { key: new Map(), doi: new Map(), arxiv: new Map() };
  for (const at of all) {
    const add = (by: MatchKind, value: string | null) => {
      if (value !== null) groups[by].set(value, [...(groups[by].get(value) ?? []), at]);
    };
    add("key", at.entry.key);
    add("doi", doiKey(at.entry.fields));
    add("arxiv", arxivKey(at.entry.fields));
  }
  const out: Duplicate[] = [];
  for (const by of ["key", "doi", "arxiv"] as const) {
    for (const [value, found] of [...groups[by]].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (found.length < 2 || (by !== "key" && new Set(found.map((f) => f.entry.key)).size === 1)) continue;
      out.push({ by, value, entries: found.map((f) => ({ file: f.file, key: f.entry.key })) });
    }
  }
  return out;
}

const SKIPPED = new Set(["a", "an", "the", "on", "of", "in", "for", "to", "and", "with", "by", "from", "at", "as"]);
const PLAIN: Record<string, string> = { æ: "ae", œ: "oe", ß: "ss", ø: "o", ł: "l", đ: "d", ı: "i" };

/** Lower-case ASCII letters and digits: LaTeX accents and braces removed, accented letters plain. */
function ascii(text: string): string {
  const cleaned = text.replace(/\\[^A-Za-z]/g, "").replace(/\\/g, "");
  return [...cleaned.toLowerCase()]
    .map((c) => (/[a-z0-9]/.test(c) ? c : (PLAIN[c] ?? c.normalize("NFD").replace(/[^a-z0-9]/g, ""))))
    .join("")
    .slice(0, 24);
}

function family(authors: string): string {
  const parts = authors.split(/\s+and\s+/i);
  const first = parts[0]!.trim();
  if (!first || first.toLowerCase() === "others") return "";
  if (first.includes(",")) return ascii(first.split(",")[0]!.trim());
  if (first.startsWith("{") && first.endsWith("}")) return ascii(first.replace(/^\{|\}$/g, "").split(/\s+/)[0] ?? "");
  return ascii(first.split(/\s+/).at(-1) ?? "");
}

/** A key like `vaswani2017attention` that `taken` does not refuse. */
export function suggestKeyFrom(hints: KeyHints, taken: (key: string) => boolean): string {
  const who = hints.author ? family(hints.author) : "";
  const when = /\d{4}/.exec(hints.year ?? "")?.[0] ?? "";
  const what = (hints.title ?? "")
    .split(/[^\p{L}\p{N}\\{}']+/u)
    .map(ascii)
    .find((w) => w && !SKIPPED.has(w)) ?? "";
  const base = `${who || "ref"}${when}${what}`;
  if (!taken(base)) return base;
  for (let n = 2; ; n++) if (!taken(`${base}-${n}`)) return `${base}-${n}`;
}

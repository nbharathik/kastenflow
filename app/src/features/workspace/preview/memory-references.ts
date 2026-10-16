// The browser preview's part for references: the vault's bibliography (the client's
// reference calls, `ReferenceOps`) and the stand-ins for the bundle calls (`BundleOps`),
// which need the desktop app. Inside the app the core does this (engine/bibliography.rs,
// engine/references.rs); here the `.bib` files are texts the preview started with, edited
// the same way (bib-edit.ts), and a rename changes pages and decks held in memory. The
// preview keeps no history, so no call gives a commit, and the bibliography edits are not
// saved with the vault (the `.bib` files are samples).

import { MANAGED_BIB } from "../../../lib/vault/reference-types";
import type {
  Adopted,
  BibFile,
  Bibliography,
  BundleExported,
  BundleOps,
  BundlePlan,
  CitingDeck,
  KeyHints,
  KeyRenamePlan,
  KeyRenamed,
  KeyUses,
  NewReference,
  ReferenceMatch,
  ReferenceOps,
  ReferenceSaved,
} from "../../../lib/vault/types";
import { entriesOf } from "./bib-scan";
import { appendChunk, checkKey, checkName, checkType, checkValue, pick, renameKey, renderEntry, replaceEntry, setFields } from "./bib-edit";
import { arxivKey, doiKey, duplicatesIn, suggestKeyFrom, type Located } from "./bib-ids";
import { countOf, renameIn } from "./cite-text";
import { MemoryAnnotations } from "./memory-annotations";
import { contentHash } from "./vault-text";

const NEEDS_APP = "Exporting a project writes a folder on your computer, so it needs the desktop app";

const changedSince = () => new Error("The bibliography changed since you read it. Open it again and make the change once more");

/** Fields as they will be written; empty values left out. */
function cleaned(fields: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [raw, value] of Object.entries(fields)) {
    const name = checkName(raw);
    const text = checkValue(name, value);
    if (text) out[name] = text;
  }
  return out;
}

/** The keys of the citations of a deck, on its slides and in the rest, for `key`. */
function deckCites(text: string, key: string): { slides: number; layouts: number } {
  let deck: unknown;
  try {
    deck = JSON.parse(text);
  } catch {
    return { slides: 0, layouts: 0 };
  }
  const count = (value: unknown): number => {
    if (Array.isArray(value)) return value.reduce<number>((n, v) => n + count(v), 0);
    if (typeof value !== "object" || value === null) return 0;
    const map = value as Record<string, unknown>;
    const own = map.type === "citation" && Array.isArray(map.keys) ? map.keys.filter((k) => k === key).length : 0;
    return own + Object.values(map).reduce<number>((n, v) => n + count(v), 0);
  };
  const parts = typeof deck === "object" && deck !== null ? (deck as Record<string, unknown>) : {};
  return Object.entries(parts).reduce((sum, [name, part]) => (name === "slides" ? { ...sum, slides: sum.slides + count(part) } : { ...sum, layouts: sum.layouts + count(part) }), { slides: 0, layouts: 0 });
}

/** The deck's text with the key swapped in the citations of its slides. */
function swapInSlides(text: string, from: string, to: string): string {
  const deck = JSON.parse(text) as { slides?: unknown };
  const swap = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(swap);
    else if (typeof value === "object" && value !== null) {
      const map = value as Record<string, unknown>;
      if (map.type === "citation" && Array.isArray(map.keys) && map.keys.includes(from)) map.keys = [...new Set((map.keys as string[]).map((k) => (k === from ? to : k)))];
      Object.values(map).forEach(swap);
    }
  };
  swap(deck.slides);
  return `${JSON.stringify(deck, null, 2)}\n`;
}

export class MemoryReferences extends MemoryAnnotations implements ReferenceOps, BundleOps {
  /** The `.bib` files, the managed one first, then the rest by path. */
  private bibPaths(): string[] {
    return Object.keys(this.bibFiles).sort((a, b) => Number(b === MANAGED_BIB) - Number(a === MANAGED_BIB) || (a < b ? -1 : a > b ? 1 : 0));
  }

  override async references(): Promise<string> {
    return this.bibPaths()
      .map((path) => `${this.bibFiles[path]}\n`)
      .join("");
  }

  private fileAt(path: string): BibFile {
    const text = this.bibFiles[path];
    return {
      path,
      managed: path === MANAGED_BIB,
      exists: text !== undefined,
      hash: contentHash(text ?? ""),
      bytes: new TextEncoder().encode(text ?? "").length,
      problem: null,
      entries: entriesOf(text ?? ""),
    };
  }

  private located(): Located[] {
    return [MANAGED_BIB, ...this.bibPaths().filter((p) => p !== MANAGED_BIB)].flatMap((path) => this.fileAt(path).entries.map((entry) => ({ file: path, entry })));
  }

  async bibliography(): Promise<Bibliography> {
    return { managed: this.fileAt(MANAGED_BIB), external: this.bibPaths().filter((p) => p !== MANAGED_BIB).map((p) => this.fileAt(p)), duplicates: duplicatesIn(this.located()) };
  }

  async checkReference(reference: NewReference): Promise<ReferenceMatch[]> {
    const fields = cleaned(reference.fields);
    const [doi, arxiv] = [doiKey(fields), arxivKey(fields)];
    const out: ReferenceMatch[] = [];
    for (const { file, entry } of this.located()) {
      if (entry.key.toLowerCase() === reference.key.trim().toLowerCase()) out.push({ by: "key", value: reference.key.trim(), file, key: entry.key });
      if (doi !== null && doi === doiKey(entry.fields)) out.push({ by: "doi", value: doi, file, key: entry.key });
      if (arxiv !== null && arxiv === arxivKey(entry.fields)) out.push({ by: "arxiv", value: arxiv, file, key: entry.key });
    }
    return out;
  }

  async suggestKey(hints: KeyHints): Promise<string> {
    const taken = new Set(this.located().map((l) => l.entry.key.toLowerCase()));
    return suggestKeyFrom(hints, (key) => taken.has(key.toLowerCase()));
  }

  /** Changes the managed file if it is still as `baseHash` says. */
  private edited(baseHash: string, change: (text: string) => string): string {
    const text = this.bibFiles[MANAGED_BIB] ?? "";
    if (contentHash(text) !== baseHash) throw changedSince();
    const next = change(text);
    if (next !== text) this.bibFiles[MANAGED_BIB] = next;
    return contentHash(next);
  }

  async addReference(reference: NewReference, baseHash: string): Promise<ReferenceSaved> {
    const type = checkType(reference.type);
    const key = checkKey(reference.key);
    const fields = cleaned(reference.fields);
    const hash = this.edited(baseHash, (text) => {
      if (!reference.allowDuplicate) {
        // The same check as `checkReference`, against the file as it is now.
        const [doi, arxiv] = [doiKey(fields), arxivKey(fields)];
        for (const { file, entry } of this.located()) {
          if (entry.key.toLowerCase() === key.toLowerCase()) throw new Error(`A reference with the key “${entry.key}” is in ${file} already. Pick another key, or add it anyway if it is another work`);
          if (doi !== null && doi === doiKey(entry.fields)) throw new Error(`“${entry.key}” in ${file} has the same DOI (${doi}). Add the reference anyway only if it is another work`);
          if (arxiv !== null && arxiv === arxivKey(entry.fields)) throw new Error(`“${entry.key}” in ${file} has the same arXiv identifier (${arxiv}). Add the reference anyway only if it is another work`);
        }
      }
      return appendChunk(text, renderEntry(type, key, fields, text.includes("\r\n") ? "\r\n" : "\n"));
    });
    return { key, hash, commit: null };
  }

  async updateReference(key: string, fields: Record<string, string | null>, baseHash: string): Promise<ReferenceSaved> {
    const hash = this.edited(baseHash, (text) => setFields(text, key, fields));
    return { key, hash, commit: null };
  }

  async replaceReference(key: string, text: string, baseHash: string): Promise<ReferenceSaved> {
    const hash = this.edited(baseHash, (file) => replaceEntry(file, key, text));
    return { key, hash, commit: null };
  }

  async adoptBib(path: string, keys: string[] | null, baseHash: string): Promise<Adopted> {
    if (path === MANAGED_BIB) throw new Error(`${MANAGED_BIB} is the managed file already`);
    const source = this.bibFiles[path];
    if (source === undefined) throw new Error(`No note at ${path}`);
    let added: string[] = [];
    let skipped: Adopted["skipped"] = [];
    const hash = this.edited(baseHash, (text) => {
      const picked = pick(source, keys, text);
      added = picked.chunks.map(([key]) => key);
      skipped = picked.skipped;
      return picked.chunks.reduce((out, [, chunk]) => appendChunk(out, chunk), text);
    });
    return { added, skipped, hash, commit: null };
  }

  async referenceUses(key: string): Promise<KeyUses> {
    const pages = Object.entries(this.data.files)
      .map(([path, file]) => ({ path, title: this.metaOf(path).title, count: countOf(file.text, key) }))
      .filter((page) => page.count > 0);
    const decks: CitingDeck[] = Object.entries(this.data.decks ?? {})
      .map(([path, text]) => ({ path, title: path.slice(path.lastIndexOf("/") + 1).replace(/\.deck$/, ""), count: deckCites(text, key).slides, inLayouts: deckCites(text, key).layouts }))
      .filter((deck) => deck.count + deck.inLayouts > 0);
    return { key, pages, decks, assets: [] };
  }

  async planKeyRename(from: string, to: string): Promise<KeyRenamePlan> {
    const target = checkKey(to);
    if (from === target) throw new Error("The new key is the same as the old one");
    const bibliography = await this.bibliography();
    if (!bibliography.managed.entries.some((e) => e.key === from)) {
      const elsewhere = bibliography.external.find((f) => f.entries.some((e) => e.key === from));
      throw new Error(elsewhere ? `“${from}” is in ${elsewhere.path}, which is read only. Make a managed copy of it first` : `There is no reference with the key “${from}”`);
    }
    for (const file of [bibliography.managed, ...bibliography.external]) {
      if (file.entries.some((e) => e.key.toLowerCase() === target.toLowerCase())) throw new Error(`“${target}” is already a key in ${file.path}. Pick another`);
    }
    const uses = await this.referenceUses(from);
    return {
      from,
      to: target,
      file: MANAGED_BIB,
      bibHash: bibliography.managed.hash,
      pages: uses.pages.map((page) => ({ ...page, hash: contentHash(this.data.files[page.path]!.text) })),
      decks: uses.decks.filter((deck) => deck.count > 0).map((deck) => ({ ...deck, hash: contentHash(this.data.decks![deck.path]!) })),
      assets: [],
    };
  }

  async renameCitationKey(from: string, to: string, bibHash: string): Promise<KeyRenamed> {
    const plan = await this.planKeyRename(from, to);
    if (plan.bibHash !== bibHash) throw changedSince();
    this.bibFiles[MANAGED_BIB] = renameKey(this.bibFiles[MANAGED_BIB] ?? "", from, plan.to);
    for (const page of plan.pages) this.put(page.path, renameIn(this.data.files[page.path]!.text, from, plan.to));
    for (const deck of plan.decks) this.data.decks![deck.path] = swapInSlides(this.data.decks![deck.path]!, from, plan.to);
    this.persist();
    const uses = await this.referenceUses(from);
    return { from, to: plan.to, pages: plan.pages.length, decks: plan.decks.length, assets: 0, layouts: uses.decks.reduce((n, d) => n + d.inLayouts, 0), commit: null };
  }

  async planExport(_project: string): Promise<BundlePlan> {
    throw new Error(NEEDS_APP);
  }

  async exportProject(_project: string, _dest: string): Promise<BundleExported> {
    throw new Error(NEEDS_APP);
  }
}

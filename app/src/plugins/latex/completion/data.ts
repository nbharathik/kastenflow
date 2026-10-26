// What completion and the outline know about the open document: the labels and
// headings of each file, the citation keys, and the file names. The editor tells
// the index about every change of text; the index scans that one file a moment
// after typing stops, so a keystroke never waits for a scan. Files that were
// never opened are read once, the first time labels are asked for. Nothing
// here leaves the computer.

import type { DocFile } from "../types";
import { type CiteItem, citesFromBib, mergeCites } from "./cites";
import { type LabelInfo, type OutlineItem, scanLabels, scanOutline } from "./scan";

export interface AssistDeps {
  /** The document's folder, as the vault names it. */
  folder: string;
  /** The files of the document (full paths). */
  files(): readonly DocFile[];
  /** The text of a file that is not open. */
  read(path: string): Promise<string>;
  /** The vault's References as completion items; empty when the vault has none. */
  vaultCites(): Promise<CiteItem[]>;
}

/** How long typing must pause before a file is scanned again. */
export const SCAN_DELAY_MS = 250;
/** At most this many files that were not opened are read for labels. */
const MAX_FILES = 40;
/** How long a read `.bib` file or the vault's References are trusted. */
const KEEP_MS = 5000;

type Kind = "image" | "tex" | "bib";
const IMAGES = /\.(png|jpe?g|pdf|svg|eps|gif|webp)$/i;

export class AssistIndex {
  private readonly texts = new Map<string, string>();
  private readonly labelsBy = new Map<string, LabelInfo[]>();
  private readonly outlineBy = new Map<string, OutlineItem[]>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly asked = new Set<string>();
  private readonly bibs = new Map<string, { at: number; text: string; items: CiteItem[] | null; parsed: string }>();
  private vault: { at: number; items: CiteItem[] } | null = null;
  private readonly listeners = new Set<() => void>();
  private gone = false;

  constructor(
    private readonly deps: AssistDeps,
    private readonly delay = SCAN_DELAY_MS,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** A path relative to the document's folder. */
  rel(path: string): string {
    return path.startsWith(`${this.deps.folder}/`) ? path.slice(this.deps.folder.length + 1) : path;
  }

  /** The text of `path` changed (or was just opened: `now` scans at once). */
  setText(path: string, text: string, now = false): void {
    this.texts.set(path, text);
    const pending = this.timers.get(path);
    if (pending) clearTimeout(pending);
    if (now) {
      this.timers.delete(path);
      this.scan(path);
      return;
    }
    this.timers.set(
      path,
      setTimeout(() => {
        this.timers.delete(path);
        this.scan(path);
      }, this.delay),
    );
  }

  private scan(path: string): void {
    if (this.gone) return;
    const text = this.texts.get(path) ?? "";
    if (path.endsWith(".bib")) {
      this.bibs.delete(path);
    } else {
      this.labelsBy.set(path, scanLabels(text, this.rel(path)));
      this.outlineBy.set(path, scanOutline(text));
    }
    this.listeners.forEach((l) => l());
  }

  /** The headings of `path` as of the last scan. */
  outline(path: string): OutlineItem[] {
    return this.outlineBy.get(path) ?? [];
  }

  /** Every label of the document; files never opened are read first (once). */
  async labels(): Promise<LabelInfo[]> {
    const wanted = this.deps
      .files()
      .filter((f) => f.editable && f.path.endsWith(".tex") && !this.texts.has(f.path) && !this.asked.has(f.path))
      .slice(0, MAX_FILES);
    await Promise.all(
      wanted.map(async (file) => {
        this.asked.add(file.path);
        try {
          const text = await this.deps.read(file.path);
          if (!this.texts.has(file.path)) this.texts.set(file.path, text);
          if (!this.labelsBy.has(file.path)) this.labelsBy.set(file.path, scanLabels(this.texts.get(file.path)!, this.rel(file.path)));
        } catch {
          // A file that cannot be read has no labels to offer.
        }
      }),
    );
    return [...this.labelsBy.values()].flat();
  }

  /** The keys of the document's own `.bib` files and of the vault's References. */
  async cites(): Promise<CiteItem[]> {
    const now = Date.now();
    const local = await Promise.all(
      this.deps
        .files()
        .filter((f) => f.path.endsWith(".bib"))
        .slice(0, 8)
        .map((f) => this.bibItems(f.path, now)),
    );
    if (!this.vault || now - this.vault.at > KEEP_MS) {
      try {
        this.vault = { at: now, items: await this.deps.vaultCites() };
      } catch {
        this.vault = { at: now, items: [] };
      }
    }
    return mergeCites(...local, this.vault.items);
  }

  private async bibItems(path: string, now: number): Promise<CiteItem[]> {
    let entry = this.bibs.get(path);
    const open = this.texts.get(path);
    if (!entry || (open === undefined && now - entry.at > KEEP_MS)) {
      try {
        entry = { at: now, text: open ?? (await this.deps.read(path)), items: null, parsed: "" };
      } catch {
        return [];
      }
      this.bibs.set(path, entry);
    }
    const text = open ?? entry.text;
    if (!entry.items || entry.parsed !== text) {
      entry.items = citesFromBib(text, this.rel(path));
      entry.parsed = text;
    }
    return entry.items;
  }

  /** File names for `\includegraphics`, `\input` and `\bibliography`, relative to the folder, tex and bib names without their ending. */
  files(kind: Kind, withEnding = false): string[] {
    const names: string[] = [];
    for (const file of this.deps.files()) {
      const rel = this.rel(file.path);
      if (kind === "image" && IMAGES.test(rel)) names.push(rel);
      else if (kind === "tex" && rel.endsWith(".tex")) names.push(withEnding ? rel : rel.slice(0, -4));
      else if (kind === "bib" && rel.endsWith(".bib")) names.push(withEnding ? rel : rel.slice(0, -4));
    }
    return names.sort();
  }

  dispose(): void {
    this.gone = true;
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
    this.listeners.clear();
  }
}

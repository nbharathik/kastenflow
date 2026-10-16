// The bibliography as the page editor needs it: a lookup from a citation key to
// the reference, so a chip can say "Vaswani et al., 2017". It is read from the
// vault the first time a page cites something (or the citation menu opens),
// and read again when a `.bib` file changes or another vault is opened. Pages
// that cite nothing never cause a read.

import type { BibEntry } from "../../../../lib/vault/reference-types";
import { useRevision } from "../../../workspace/revision";
import { useWorkspace } from "../../../workspace/store";

export interface CiteWork {
  entry: BibEntry;
  /** The `.bib` file it is in. */
  file: string;
  managed: boolean;
}

let works: CiteWork[] = [];
let byKey = new Map<string, CiteWork>();
let byLower = new Map<string, CiteWork>();
let state: "idle" | "loading" | "ready" = "idle";
let watching = false;
let generation = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

function load(): void {
  const client = useWorkspace.getState().client;
  if (!client) return;
  state = "loading";
  const mine = ++generation;
  client.bibliography().then(
    (bib) => {
      if (mine !== generation) return;
      // The managed file's entries come first, so its keys win over a file that repeats them.
      works = [bib.managed, ...bib.external].flatMap((file) => file.entries.map((entry) => ({ entry, file: file.path, managed: file.managed })));
      byKey = new Map();
      byLower = new Map();
      for (const work of works) {
        if (!byKey.has(work.entry.key)) byKey.set(work.entry.key, work);
        if (!byLower.has(work.entry.key.toLowerCase())) byLower.set(work.entry.key.toLowerCase(), work);
      }
      state = "ready";
      notify();
    },
    () => {
      if (mine !== generation) return;
      // A bibliography that cannot be read leaves the keys as they are written.
      state = "ready";
      notify();
    },
  );
}

/** Starts reading the bibliography if it has not been; the listeners hear when it arrives. */
export function ensureBook(): void {
  if (!watching) {
    watching = true;
    useRevision.subscribe((now, was) => {
      if (now.revision.references !== was.revision.references || now.revision.epoch !== was.revision.epoch) refreshBook();
    });
    useWorkspace.subscribe((now, was) => {
      if (now.client !== was.client) forgetBook();
    });
  }
  if (state === "idle") load();
}

/** Reads the bibliography again, if it has been read before. */
export function refreshBook(): void {
  if (state !== "idle") load();
}

function forgetBook(): void {
  generation++;
  works = [];
  byKey = new Map();
  byLower = new Map();
  state = "idle";
  notify();
  // A page open now is waiting for the new vault's references.
  if (listeners.size > 0) load();
}

/** The reference a key names: exactly, else without regard to case. */
export function lookup(key: string): CiteWork | undefined {
  return byKey.get(key) ?? byLower.get(key.toLowerCase());
}

/** Every reference, the managed file's first. */
export const allWorks = (): readonly CiteWork[] => works;

/** Whether the bibliography has been read (so a key that is not in it is really missing). */
export const bookReady = (): boolean => state === "ready";

/** Calls `listener` whenever the bibliography is read; returns how to stop. */
export function onBook(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** For tests: forget what was read, so the next page asks again. Whoever listens keeps listening. */
export function resetBook(): void {
  generation++;
  works = [];
  byKey = new Map();
  byLower = new Map();
  state = "idle";
}

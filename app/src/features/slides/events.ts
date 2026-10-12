// Deck files that changed on disk (an agent, another app, a sync), so an open
// deck can take them in. The app's own saves come back here too; the editor
// compares what it reads with what it wrote before it replaces anything.

import { useDecks } from "./store";

type Listener = (paths: string[]) => void;

const listeners = new Set<Listener>();

/** Calls `listener` with the deck paths that changed; returns how to stop. */
export function onDeckFiles(listener: Listener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Called with every batch of changed vault paths. */
export function deckFilesChanged(paths: string[]): void {
  const decks = paths.filter((p) => p.endsWith(".deck"));
  if (decks.length === 0) return;
  for (const listener of [...listeners]) listener(decks);
  void useDecks.getState().load();
}

const assetListeners = new Set<(paths: string[]) => void>();
const versions = new Map<string, number>();

/** Calls `listener` with the paths under assets/ that changed (pictures and their sidecars); returns how to stop. */
export function onAssetFiles(listener: (paths: string[]) => void): () => void {
  assetListeners.add(listener);
  return () => void assetListeners.delete(listener);
}

/** How many times the picture at `path` was seen to change: a small copy made before is another version's. */
export const assetVersion = (path: string): number => versions.get(path) ?? 0;

/** Called with every batch of changed vault paths. */
export function assetFilesChanged(paths: string[]): void {
  const assets = paths.filter((p) => p.startsWith("assets/"));
  if (assets.length === 0) return;
  for (const path of assets) versions.set(path, assetVersion(path) + 1);
  for (const listener of [...assetListeners]) listener(assets);
}

const pageListeners = new Set<(paths: string[]) => void>();

/** Calls `listener` with the paths of pages (Markdown files) that changed: what decks that embed or are made from a page keep up with; returns how to stop. */
export function onPageFiles(listener: (paths: string[]) => void): () => void {
  pageListeners.add(listener);
  return () => void pageListeners.delete(listener);
}

/** Called with every batch of changed vault paths. */
export function pageFilesChanged(paths: string[]): void {
  const pages = paths.filter((p) => p.toLowerCase().endsWith(".md"));
  if (pages.length === 0) return;
  for (const listener of [...pageListeners]) listener(pages);
}

const bibListeners = new Set<() => void>();

/** Calls `listener` when a `.bib` file in the vault changed (the bibliography decks cite from); returns how to stop. */
export function onBibFiles(listener: () => void): () => void {
  bibListeners.add(listener);
  return () => void bibListeners.delete(listener);
}

/** Called with every batch of changed vault paths. */
export function bibFilesChanged(paths: string[]): void {
  if (!paths.some((p) => p.toLowerCase().endsWith(".bib"))) return;
  for (const listener of [...bibListeners]) listener();
}

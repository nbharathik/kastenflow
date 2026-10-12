// What the images drawer shows and how it narrows it: search, the filters,
// where the open deck uses each image, and the sentences that say where an
// image came from. Plain functions of the host's list, so they are easy to test.

import type { Deck, Element } from "@kasten-slides/wasm";

import type { HostImage, ImageUse } from "../host.ts";

export type FilterId = "all" | "deck" | "recent" | "agent" | "papers" | "unused";

export const FILTERS: readonly { id: FilterId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "deck", label: "This deck" },
  { id: "recent", label: "Recent" },
  { id: "agent", label: "Agent-made" },
  { id: "papers", label: "From papers" },
  { id: "unused", label: "Unused" },
];

/** How far back "Recent" reaches. */
export const RECENT_MS = 14 * 24 * 60 * 60 * 1000;

/** Where the open deck uses each image, by path, worked out from the deck as it is being edited. */
export interface DeckUses {
  /** The slides (in order, from 1) that show the image. */
  slides: Map<string, { number: number; id: string }[]>;
  /** Images its theme shows on every slide of a layout. */
  theme: Set<string>;
}

function collect(element: Element, found: Set<string>): void {
  switch (element.type) {
    case "image":
      if (element.src) found.add(element.src);
      break;
    case "raw":
      if (element.preview) found.add(element.preview);
      break;
    case "embed":
    case "video":
      if (element.poster) found.add(element.poster);
      break;
    case "group":
      for (const child of element.children) collect(child, found);
      break;
    default:
  }
}

/** The images a deck uses, slide by slide (slide backgrounds, pictures, groups' pictures, posters) and in its theme's master. */
export function usesInDeck(deck: Deck): DeckUses {
  const slides = new Map<string, { number: number; id: string }[]>();
  deck.slides.forEach((slide, at) => {
    const found = new Set<string>();
    if (slide.background?.image) found.add(slide.background.image);
    for (const element of slide.elements) collect(element, found);
    for (const path of found) slides.set(path, [...(slides.get(path) ?? []), { number: at + 1, id: slide.id }]);
  });
  const theme = new Set<string>();
  for (const element of deck.theme.master ?? []) collect(element, theme);
  // What a layout a person made draws behind its slides: its decoration and its background.
  for (const layout of deck.theme.layouts ?? []) {
    if (layout.background?.image) theme.add(layout.background.image);
    for (const element of layout.elements ?? []) collect(element, theme);
  }
  return { slides, theme };
}

export const fromAgent = (image: HostImage): boolean => image.source === "agent" || (image.createdBy ?? "").startsWith("agent:");
export const fromPaper = (image: HostImage): boolean => image.source === "pdf-clip" || image.clip !== undefined;

/** How an image came in, in a few words. */
export function sourceLine(image: HostImage): string {
  switch (image.source) {
    case "pasted":
      return "Pasted";
    case "file":
      return "Added from a file";
    case "pdf-clip":
      return image.paper ? `Clipped from ${image.paper}${image.clip ? `, page ${image.clip.page}` : ""}` : "Clipped from a paper";
    case "agent":
      return "Made by an agent";
    case "pptx-import":
      return image.deck ? `Imported from ${image.deck}` : "Imported from a PowerPoint deck";
    default:
      return fromAgent(image) ? "Made by an agent" : "";
  }
}

const plain = (text: string): string => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Everything a search looks in: name, tags, caption, the paper it came from, its citation key and how it came in. */
export function searchable(image: HostImage): string {
  return plain([image.name, image.path, ...(image.tags ?? []), image.caption ?? "", image.paper ?? "", image.citationKey ?? "", image.deck ?? "", sourceLine(image)].join("\n"));
}

/** Whether every word of `query` is somewhere in the image's name, tags, caption or source paper. */
export function matches(query: string, image: HostImage, text = searchable(image)): boolean {
  const words = plain(query).split(/\s+/).filter(Boolean);
  return words.every((word) => text.includes(word));
}

export interface Narrowing {
  query: string;
  filter: FilterId;
  /** The open deck's uses, for "This deck" and "Unused". */
  deck: DeckUses;
  /** The host's account of where images are used; null when it has none (then nothing is called unused). */
  usage: Record<string, ImageUse> | null;
  /** The path of the open deck, so the host's account of it is not counted twice. */
  deckPath?: string | undefined;
  now: number;
}

/** Whether nothing anywhere uses the image: the host's account, or the open deck's own use, would say so. */
export function isUnused(image: HostImage, { usage, deck }: Pick<Narrowing, "usage" | "deck">): boolean {
  if (!usage) return false;
  if (deck.slides.has(image.path) || deck.theme.has(image.path)) return false;
  return !usage[image.path] || countUses(usage[image.path]!) === 0;
}

const countUses = (use: ImageUse): number => use.notes.length + use.boards.length + use.decks.length;

/** The images the search and the filter leave, in the order the host gave. */
export function narrow(images: readonly HostImage[], { query, filter, deck, usage, now }: Narrowing): HostImage[] {
  const q = query.trim();
  return images.filter((image) => {
    if (q && !matches(q, image)) return false;
    switch (filter) {
      case "deck":
        return deck.slides.has(image.path) || deck.theme.has(image.path);
      case "recent":
        return image.added !== undefined && now - image.added <= RECENT_MS;
      case "agent":
        return fromAgent(image);
      case "papers":
        return fromPaper(image);
      case "unused":
        return isUnused(image, { usage, deck });
      default:
        return true;
    }
  });
}

/** What the drawer lists for one image under "Used in": the open deck's slides, other decks, notes and boards. */
export interface UsedIn {
  slides: { number: number; id: string }[];
  theme: boolean;
  decks: ImageUse["decks"];
  notes: ImageUse["notes"];
  boards: ImageUse["boards"];
  /** How many places in all. */
  count: number;
}

export function usedIn(image: HostImage, { deck, usage, deckPath }: Pick<Narrowing, "deck" | "usage" | "deckPath">): UsedIn {
  const slides = deck.slides.get(image.path) ?? [];
  const theme = deck.theme.has(image.path);
  const saved = usage?.[image.path];
  // The open deck is shown from the editor's own copy; the host's account of the saved file would list it twice.
  const decks = (saved?.decks ?? []).filter((d) => d.path !== deckPath);
  const notes = saved?.notes ?? [];
  const boards = saved?.boards ?? [];
  const here = slides.length > 0 || theme ? 1 : 0;
  return { slides, theme, decks, notes, boards, count: here + decks.length + notes.length + boards.length };
}

/** "3 KB", "1.4 MB". */
export function sizeLabel(bytes: number | undefined): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

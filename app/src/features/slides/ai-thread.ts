// The chat behind the editor's assistant tab: one thread for each deck, and the chip that tells it which slide,
// and which elements of it, the person is looking at.

import type { AiPanelProps } from "@kasten-slides/react";

import { useChat } from "../chat/store";
import { chipKey, type Chip } from "../chat/thread";

/** Deck path to the thread that talks about it, while the window lives. */
const threads = new Map<string, string>();

/** The same, kept in this browser between runs: a chat kept on the backend has an id, and the deck it belongs to is
 * only known here. */
const KEY = "kasten.chat.decks";

function remembered(): Record<string, string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return saved && typeof saved === "object" && !Array.isArray(saved) ? (saved as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function remember(deck: string, id: string): void {
  try {
    // The latest few decks only.
    const kept = Object.entries({ ...remembered(), [deck]: id }).slice(-200);
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // The deck's chat is then found again until the window closes.
  }
}

/** The thread of a deck: made the first time and found again after, until it is discarded. It is not opened in the Chat view. */
export function threadOfDeck(deck: string): string {
  const chat = useChat.getState();
  const known = threads.get(deck);
  if (known && chat.threads[known]) return known;
  const id = chat.start({ open: false });
  threads.set(deck, id);
  remember(deck, id);
  return id;
}

/** The thread of a deck, brought back from an earlier run when there is one kept: what the assistant did there, and the
 * plan it was following, are in it still (it may even be working). Otherwise `threadOfDeck`. */
export function restoreDeckThread(deck: string): string | Promise<string> {
  const chat = useChat.getState();
  const known = threads.get(deck);
  if (known && chat.threads[known]) return known;
  const kept = remembered()[deck];
  if (!kept) return threadOfDeck(deck);
  if (chat.threads[kept]) {
    threads.set(deck, kept);
    return kept;
  }
  // Kept on the backend and not in this window yet: it is brought in, and a new thread takes its place if it is gone.
  chat.ensure();
  return chat.adopt(kept).then((there) => {
    if (!there) return threadOfDeck(deck);
    threads.set(deck, kept);
    return kept;
  });
}

/** The chip for the slide the person is looking at in `deck`, when its assistant tab has told the chat which; none before that. */
export function currentSlideChip(deck: string): Chip | undefined {
  const known = threads.get(deck);
  return known ? useChat.getState().threads[known]?.context.find((chip) => chip.kind === "slide") : undefined;
}

type Where = Pick<AiPanelProps, "deckPath" | "slideId" | "slideNumber" | "slideTitle" | "elementIds">;

/** What the person is looking at, as a chip: the deck, the slide and the selected elements, which the backend reads when a message is sent. */
export function slideChip({ deckPath, slideId, slideNumber, slideTitle, elementIds }: Where): Chip {
  const title = slideTitle.length > 28 ? `${slideTitle.slice(0, 27).trimEnd()}…` : slideTitle;
  const selected = elementIds.length === 0 ? "" : elementIds.length === 1 ? " · 1 selected" : ` · ${elementIds.length} selected`;
  return { kind: "slide", label: `Slide ${slideNumber}: ${title}${selected}`, ref: [deckPath ?? "", slideId, ...elementIds] };
}

/**
 * Puts the chip for the slide in the thread and takes the one for the slide before out. A chip the person removed by hand
 * stays out until the slide or the selection changes. Answers the key to take it out again by.
 */
export function followSlide(thread: string, chip: Chip, before: string | null): string {
  const chat = useChat.getState();
  if (before) chat.removeChip(thread, before);
  chat.addChip(thread, chip);
  return chipKey(chip);
}

/** Takes the chip out, when the tab goes. */
export function leaveSlide(thread: string, key: string): void {
  useChat.getState().removeChip(thread, key);
}

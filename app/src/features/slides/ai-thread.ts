// The chat behind the editor's assistant tab: one thread for each deck, and the chip that tells it which slide,
// and which elements of it, the person is looking at.

import type { AiPanelProps } from "@kasten-slides/react";

import { migrateDeckBindings } from "../chat/binding/migrate";
import { useChat } from "../chat/store";
import { chipKey, type Chip } from "../chat/thread";

/** Deck path to the thread that talks about it, while the window lives. The backend keeps the tie between a deck and
 * its chat (chat_bind), so a chat kept from an earlier run is found by the deck. */
const threads = new Map<string, string>();

/** What a deck is tied to. */
const tieOf = (deck: string) => ({ kind: "deck" as const, path: deck });

/** The thread of a deck: made the first time and found again after, until it is discarded. It is not opened in the
 * Chat view. A new one is tied to the deck when its first message is sent. `fresh` makes another even if there is one. */
export function threadOfDeck(deck: string, fresh = false): string {
  const chat = useChat.getState();
  const known = threads.get(deck);
  if (known && chat.threads[known] && !fresh) return known;
  const id = chat.start({ open: false });
  threads.set(deck, id);
  chat.bindWhenSent(id, tieOf(deck));
  return id;
}

/** A new chat for the deck that leaves the old one in the list; the tie moves to the new one. */
export async function newDeckThread(deck: string, from: string): Promise<string> {
  const chat = useChat.getState();
  const id = await chat.newThreadFrom(from, { open: false });
  threads.set(deck, id);
  chat.bindWhenSent(id, tieOf(deck));
  return id;
}

/** The thread of a deck, or the saved chat that could not be brought back. */
export type Restored = string | { failed: string };

/** The thread of a deck, brought back from an earlier run when there is one tied to it: what the assistant did there,
 * and the plan it was following, are in it still (it may even be working). Otherwise `threadOfDeck`. A chat that is
 * tied to the deck and cannot be read is not hidden by a new one: the answer says which, for Retry or Start a new one. */
export function restoreDeckThread(deck: string): string | Promise<Restored> {
  const chat = useChat.getState();
  const known = threads.get(deck);
  if (known && chat.threads[known]) return known;
  return (async (): Promise<Restored> => {
    const client = chat.ensure();
    // The old deck-to-chat map in this browser becomes ties, once.
    await migrateDeckBindings(client);
    const found = await client.threadFor(tieOf(deck)).catch(() => null);
    if (!found) return threadOfDeck(deck);
    if (!useChat.getState().threads[found.id] && !(await useChat.getState().adopt(found.id))) return { failed: found.id };
    threads.set(deck, found.id);
    return found.id;
  })();
}

/** Tries a chat that could not be brought back once more. */
export async function retryDeckThread(deck: string, failed: string): Promise<Restored> {
  const there = await useChat.getState().retryAdopt(failed);
  if (!there) return { failed };
  threads.set(deck, failed);
  return failed;
}

/** The thread tied to a deck that this window already holds (made here, or brought back from an earlier run), without starting one. */
export function knownDeckThread(deck: string): string | undefined {
  const chat = useChat.getState();
  const known = threads.get(deck);
  if (known && chat.threads[known]) return known;
  return Object.values(chat.threads).find((t) => t.bound?.kind === "deck" && t.bound.path === deck && !t.archived)?.id;
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

// A slide deck shown inside a page: `![[path/talk.deck]]` on a line of its
// own. The card shows the deck's current slide with arrows, a counter, Present
// and Open (the window draws it: LinkProvider.mountDeck); the Markdown stays
// the link.

import "./deck-embed.css";

import type { Ctx } from "@milkdown/kit/ctx";

import { findDeck, linksOf, parseWikiTarget } from "../links";
import { el, withGlyph } from "../ui/dom";
import { freshHost } from "./embed-host";

export class DeckEmbed {
  private readonly body: HTMLElement;
  private readonly title: HTMLElement;
  private mounted: { path: string; unmount: () => void } | null = null;
  private path: string | null = null;

  constructor(
    private readonly dom: HTMLElement,
    private readonly ctx: Ctx,
  ) {
    this.title = el("span", "kasten-embed-title");
    const head = el("span", "kasten-embed-head");
    head.append(withGlyph(el("span", "kasten-embed-icon"), "icon:present", 16), this.title);
    this.body = el("div", "kasten-deck-embed-body");
    this.dom.replaceChildren(head, this.body);
  }

  /** Whether an event belongs to the slide and its buttons, so the page leaves it alone. */
  owns(target: EventTarget | null): boolean {
    return target instanceof Node && this.body.contains(target);
  }

  /** The deck this card shows, for the header's click. */
  get deckPath(): string | null {
    return this.path;
  }

  render(value: string): void {
    const target = parseWikiTarget(value).title;
    const links = linksOf(this.ctx);
    const deck = findDeck(links.decks?.() ?? [], target);
    this.title.textContent = deck?.title ?? target.replace(/^.*\//, "").replace(/\.deck$/i, "");
    this.path = deck?.path ?? null;
    if (!deck || !links.mountDeck) {
      this.unmount();
      this.body.replaceChildren(el("p", "kasten-embed-note", { textContent: deck ? "Decks show here in the app." : `No deck “${target}”.` }));
      return;
    }
    if (this.mounted?.path === deck.path) return;
    this.unmount();
    this.mounted = { path: deck.path, unmount: links.mountDeck(freshHost(this.body), deck.path) };
  }

  destroy(): void {
    this.unmount();
  }

  private unmount(): void {
    const mounted = this.mounted;
    this.mounted = null;
    // The page may be going away inside React's own update: let it finish.
    if (mounted) queueMicrotask(mounted.unmount);
  }
}

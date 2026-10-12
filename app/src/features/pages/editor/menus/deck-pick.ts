// "/deck": a menu of the decks to show in the page, and a new one. Typing
// narrows it; the pick puts `![[path/talk.deck]]` on a line of its own, which
// draws the deck's slides (blocks/deck-embed.ts). A new deck is made in the
// page's project, and the embed lands where it was asked for once it exists.

import type { Ctx } from "@milkdown/kit/ctx";
import type { EditorView } from "@milkdown/kit/prose/view";

import { linksOf, type DeckLink, type LinkProvider } from "../links";
import type { Rect } from "../ui/dom";
import { closesWith } from "../ui/close-with-editor";
import { Popover, type MenuItem, type MenuSection } from "../ui/popover";
import { markSpot, takeSpot } from "./embed-spot";
import { placeEmbed } from "./mention";

const MOST = 8;

/** Decks whose titles match, those starting with the query first. */
export function matchDecks(decks: readonly DeckLink[], query: string): DeckLink[] {
  const q = query.trim().toLowerCase();
  const found = decks.filter((d) => d.title.toLowerCase().includes(q));
  return found.sort((a, b) => Number(!a.title.toLowerCase().startsWith(q)) - Number(!b.title.toLowerCase().startsWith(q))).slice(0, MOST);
}

function sections(links: LinkProvider, query: string, pick: (path: string | null, title: string) => void): MenuSection[] {
  const title = query.trim();
  const items: MenuItem[] = matchDecks(links.decks?.() ?? [], query).map((d) => ({ key: `deck:${d.path}`, label: d.title, hint: d.hint, icon: "icon:present", onPick: () => pick(d.path, d.title) }));
  const create: MenuItem[] = links.createDeck ? [{ key: "create", label: title ? `New deck “${title}”` : "New deck", icon: "icon:plus", onPick: () => pick(null, title) }] : [];
  return [{ title: title ? `Embed a deck: ${title}` : "Embed a deck", items }, { items: create }];
}

/** Opens the deck menu at `pos`, an empty place in the page. */
export function startDeckPick(view: EditorView, ctx: Ctx, pos: number): Popover {
  const links = linksOf(ctx);
  let query = "";
  const caret = (): Rect => {
    try {
      return view.coordsAtPos(pos);
    } catch {
      // No layout (tests) or a stale position.
      return view.dom.getBoundingClientRect();
    }
  };

  const embed = (path: string | null, title: string) => {
    if (path !== null) return placeEmbed(view, pos, path);
    // A new deck: a spot holds the place while it is made, and moves with the edits made around it.
    const spot = markSpot(view, pos, "Making the deck…");
    void Promise.resolve(links.createDeck?.(title || "New deck")).then(
      (made) => {
        const at = takeSpot(view, spot);
        if (!made || at < 0) return;
        // The caret follows only if it is still where the embed was asked for.
        const { selection } = view.state;
        placeEmbed(view, at, made, selection.empty && selection.from === at);
      },
      () => takeSpot(view, spot),
    );
  };

  const menu = new Popover(sections(links, query, embed), { anchor: caret, ownKeys: true, label: "Embed a deck", emptyText: "No decks match", onClose: () => window.removeEventListener("keydown", typed, true) });
  // The menu keeps typing from the page; the words are for narrowing it.
  function typed(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const next = event.key === "Backspace" ? query.slice(0, -1) : event.key.length === 1 ? query + event.key : query;
    if (next === query) return;
    query = next;
    menu.setSections(sections(links, query, embed));
  }
  window.addEventListener("keydown", typed, true);
  return closesWith(view, menu);
}

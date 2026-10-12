// "/diagram": a menu of the diagrams to show in the page, and a new one. Typing
// narrows it; the pick puts `![[Name.drawio]]` on a line of its own, which
// draws the diagram's picture (blocks/diagram-embed.ts). A new diagram is made
// in the page's project and its editor opens at once; the embed lands where it
// was asked for once the diagram exists.

import type { Ctx } from "@milkdown/kit/ctx";
import type { EditorView } from "@milkdown/kit/prose/view";

import { linksOf, type DiagramLink, type LinkProvider } from "../links";
import type { Rect } from "../ui/dom";
import { closesWith } from "../ui/close-with-editor";
import { Popover, type MenuItem, type MenuSection } from "../ui/popover";
import { markSpot, takeSpot } from "./embed-spot";
import { placeEmbed } from "./mention";

const MOST = 8;

/** Diagrams whose titles match, those starting with the query first. */
export function matchDiagrams(diagrams: readonly DiagramLink[], query: string): DiagramLink[] {
  const q = query.trim().toLowerCase();
  const found = diagrams.filter((d) => d.title.toLowerCase().includes(q));
  return found.sort((a, b) => Number(!a.title.toLowerCase().startsWith(q)) - Number(!b.title.toLowerCase().startsWith(q))).slice(0, MOST);
}

/** What the embed names: the file's name, or its path when another diagram has the same file name. */
export function embedTarget(path: string, diagrams: readonly DiagramLink[]): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const same = diagrams.filter((d) => d.path.slice(d.path.lastIndexOf("/") + 1).toLowerCase() === name.toLowerCase());
  return same.length > 1 ? path : name;
}

function sections(links: LinkProvider, query: string, pick: (path: string | null, title: string) => void): MenuSection[] {
  const title = query.trim();
  const items: MenuItem[] = matchDiagrams(links.diagrams?.() ?? [], query).map((d) => ({ key: `diagram:${d.path}`, label: d.title, hint: d.hint, icon: "icon:diagram", onPick: () => pick(d.path, d.title) }));
  const create: MenuItem[] = links.createDiagram ? [{ key: "create", label: title ? `New diagram “${title}”` : "New diagram", icon: "icon:plus", onPick: () => pick(null, title) }] : [];
  return [{ title: title ? `Embed a diagram: ${title}` : "Embed a diagram", items }, { items: create }];
}

/** Opens the diagram menu at `pos`, an empty place in the page. */
export function startDiagramPick(view: EditorView, ctx: Ctx, pos: number): Popover {
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
    if (path !== null) return placeEmbed(view, pos, embedTarget(path, links.diagrams?.() ?? []));
    // A new diagram: a spot holds the place while it is made, and moves with the edits made around it.
    const spot = markSpot(view, pos, "Making the diagram…");
    void Promise.resolve(links.createDiagram?.(title || "Untitled diagram")).then(
      (made) => {
        const at = takeSpot(view, spot);
        if (!made || at < 0) return;
        // The caret follows only if it is still where the embed was asked for.
        const { selection } = view.state;
        placeEmbed(view, at, embedTarget(made, links.diagrams?.() ?? []), selection.empty && selection.from === at);
      },
      () => takeSpot(view, spot),
    );
  };

  const menu = new Popover(sections(links, query, embed), { anchor: caret, ownKeys: true, label: "Embed a diagram", emptyText: "No diagrams match", onClose: () => window.removeEventListener("keydown", typed, true) });
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

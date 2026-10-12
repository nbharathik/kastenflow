// The menu a pasted web address opens: Link keeps it as it is, and Bookmark
// (on a line of its own) or Mention (in text) writes `[Title](address)` with
// the web page's title, read only when one of those is picked. Until the title
// comes, the address stays as a link; if it never does, the site's name is the
// title. The serializer escapes the title, so one with brackets in it is safe.

import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

import type { LinkProvider } from "./links";
import type { Rect } from "./ui/dom";
import { closesWith } from "./ui/close-with-editor";
import { Popover, type MenuItem } from "./ui/popover";
import { pastedKey } from "./paste-link-key";

/** The longest title kept; a page's own may run on. */
const LONGEST = 200;

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./i, "") || url;
  } catch {
    return url;
  }
};

/** What the link reads: the page's title, else its site's name. */
export async function titleFor(links: LinkProvider, url: string): Promise<string> {
  let read: string | null = null;
  try {
    read = (await links.webTitle?.(url)) ?? null;
  } catch {
    // The page could not be read: its site's name will do.
  }
  const title = (read ?? "").replace(/\s+/g, " ").trim().slice(0, LONGEST);
  // With no title of its own, a page's title is its address: say the site instead.
  const bare = url.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  return title && title !== bare ? title : hostOf(url);
}

/** Turns the link pasted as `id` into one that reads as `title`, if it is still there as pasted.
 * A bookmark is a line of its own, so writing goes on in a new line below it
 * (left out of the file until something is typed), if the caret was there. */
async function titled(view: EditorView, links: LinkProvider, id: number, kind: "bookmark" | "mention"): Promise<void> {
  const pasted = pastedKey.getState(view.state);
  if (!pasted || pasted.id !== id) return;
  const title = await titleFor(links, pasted.url);
  const now = pastedKey.getState(view.state);
  const link = view.state.schema.marks.link;
  if (view.isDestroyed || !now || now.id !== id || !link) return;
  if (view.state.doc.textBetween(now.from, now.to) !== now.url) return;
  const { state } = view;
  const text = state.schema.text(title, [link.create({ href: now.url })]);
  const tr = state.tr.replaceWith(now.from, now.to, text).setMeta(pastedKey, null);
  const { selection } = state;
  if (kind === "bookmark" && selection.empty && selection.from >= now.from && selection.from <= now.to) {
    const below = tr.doc.resolve(now.from).after();
    const next = tr.doc.nodeAt(below);
    if (!(next?.type.name === "paragraph" && next.content.size === 0)) tr.insert(below, state.schema.nodes.paragraph!.create());
    tr.setSelection(TextSelection.create(tr.doc, below + 1));
  }
  view.dispatch(tr.scrollIntoView());
}

/** Opens the menu under the link pasted as `id`. Esc, or any key that is not for the menu, closes it and leaves the link. */
export function openPasteMenu(view: EditorView, links: LinkProvider, id: number, kind: "bookmark" | "mention"): Popover {
  const anchor = (): Rect => {
    const pasted = pastedKey.getState(view.state);
    try {
      if (pasted) return view.coordsAtPos(pasted.to);
    } catch {
      // No layout (tests) or the text is gone.
    }
    return view.dom.getBoundingClientRect();
  };
  const turn: MenuItem =
    kind === "bookmark"
      ? { key: "bookmark", label: "Bookmark", icon: "icon:bookmark", description: "Show the page's title and site as a card", onPick: () => void titled(view, links, id, kind) }
      : { key: "mention", label: "Mention", icon: "icon:globe", description: "Show the page's title as the link", onPick: () => void titled(view, links, id, kind) };
  const menu = new Popover([{ items: [{ key: "link", label: "Link", icon: "icon:link", description: "Keep the address as a link", onPick: () => {} }, turn] }], {
    anchor,
    label: "Pasted link",
    onClose: () => window.removeEventListener("keydown", onKey, true),
  });
  // The menu does not keep typing from the page: only its own keys are its.
  function onKey(event: KeyboardEvent): void {
    const own = ["ArrowDown", "ArrowUp", "Escape"].includes(event.key) || (event.key === "Enter" && menu.selected?.key !== "link");
    if (!own) return menu.close();
    if (menu.handleKey(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }
  window.addEventListener("keydown", onKey, true);
  return closesWith(view, menu);
}

// What the link menus list. `[[` offers pages (or a new one); `@` offers
// dates, then people, pages, whiteboards, decks and tags, whatever fits what
// was typed. A pick says what to put in the link and, for a time, the text
// to write after it.

import { findLink, findPage, foundPage, type LinkProvider, type PageLink } from "../links";
import { dateItems } from "./mention-dates";
import type { MenuItem, MenuSection } from "../ui/popover";

export type Trigger = "link" | "mention" | "page" | "embed" | "board" | "database";

/** `value` is a link's text; `create` names a page to make first; `after`
 * is plain text that follows the link (a time). */
export type PickLink = (value: string, create?: string, after?: string) => void;

export const MAX_PAGES = 8;
/** Whiteboards, decks, tags and people beside the pages in `@`. */
const MAX_OTHER = 4;

/** Items whose titles hold `query`, those starting with it first. */
function byTitle<T>(items: readonly T[], title: (item: T) => string, query: string, max: number): T[] {
  const q = query.trim().toLowerCase();
  const starts = (item: T) => Number(!title(item).toLowerCase().startsWith(q));
  return items
    .filter((item) => title(item).toLowerCase().includes(q))
    .sort((a, b) => starts(a) - starts(b))
    .slice(0, max);
}

/** Pages whose titles match, those starting with the query first. */
export function matchPages(links: LinkProvider, query: string, max = MAX_PAGES) {
  return byTitle(links.pages(), (p) => p.title, query, max);
}

/** Whiteboards whose titles match, those starting with the query first. */
function matchBoards(links: LinkProvider, query: string, max = MAX_PAGES) {
  return byTitle(links.boards?.() ?? [], (b) => b.title, query, max);
}

/** The /whiteboard menu: boards to embed, and a new one. `board` gets a path, or null to make one. */
export function boardSections(query: string, links: LinkProvider, board: (path: string | null, title: string) => void): MenuSection[] {
  const title = query.trim();
  const items: MenuItem[] = matchBoards(links, query).map((b) => ({ key: `board:${b.path}`, label: b.title, hint: b.hint, icon: "icon:board", onPick: () => board(b.path, b.title) }));
  const create: MenuItem[] = links.createBoard ? [{ key: "create", label: title ? `New whiteboard “${title}”` : "New whiteboard", icon: "icon:plus", onPick: () => board(null, title) }] : [];
  return [{ title: "Embed a whiteboard", items }, { items: create }];
}

/** For `[[Title#part`: the headings of that page matching `part`, or null
 * when the query names no heading. `again` redraws once they are read. */
export function headingSections(query: string, links: LinkProvider, pick: (value: string) => void, again: () => void): MenuSection[] | null {
  const hash = query.indexOf("#");
  if (hash < 0 || !links.headings) return null;
  const page = foundPage(findLink(links, query.slice(0, hash).trim()));
  if (!page) return [{ title: "Headings", items: [] }];
  const part = query.slice(hash + 1).trim().toLowerCase();
  const headings = links.headings(page, again) ?? [];
  const target = links.linkText?.(page) ?? page.title;
  // A heading in a link cannot hold `|` or `]`.
  const items: MenuItem[] = headings
    .filter((h) => h.toLowerCase().includes(part) && !/[|\]]/.test(h))
    .slice(0, MAX_PAGES)
    .map((h) => ({ key: `heading:${h}`, label: h, hint: page.title, icon: "icon:heading-2", onPick: () => pick(`${target}#${h}`) }));
  return [{ title: `Headings in ${page.title}`, items }];
}

const pageItem = (links: LinkProvider, page: PageLink, pick: PickLink, icon = "icon:page"): MenuItem => ({
  key: `page:${page.path ?? page.title}`,
  label: page.title,
  // Pages that share a title say where each lives.
  hint: page.where,
  icon: page.icon ?? icon,
  onPick: () => pick(links.linkText?.(page) ?? page.title),
});

/** The `@` menu: dates, people, pages, then whiteboards, decks and tags. The
 * last three wait for something typed, so a bare `@` stays short. */
function mentionSections(query: string, links: LinkProvider, pick: PickLink): MenuSection[] {
  const typed = query.trim().length > 0;
  const dates = dateItems(query, { weekStart: links.weekStart?.() }, (day, after) => pick(day, undefined, after));
  const people = byTitle(links.people?.() ?? [], (p) => p.title, query, MAX_OTHER);
  const known = new Set(people.map((p) => p.path ?? p.title));
  const pages = matchPages(links, query, MAX_PAGES + MAX_OTHER).filter((p) => !known.has(p.path ?? p.title)).slice(0, MAX_PAGES);
  const boards: MenuItem[] = typed ? matchBoards(links, query, MAX_OTHER).map((b) => ({ key: `board:${b.path}`, label: b.title, hint: b.hint, icon: "icon:board", onPick: () => pick(b.path) })) : [];
  const decks: MenuItem[] = typed
    ? byTitle(links.decks?.() ?? [], (d) => d.title, query, MAX_OTHER).map((d) => ({ key: `deck:${d.path}`, label: d.title, hint: d.hint, icon: "icon:present", onPick: () => pick(d.path) }))
    : [];
  // A tag is a reference to the tag's page (its database), not an edit of this page's tags.
  const tags: MenuItem[] = typed
    ? byTitle(links.databases?.() ?? [], (d) => d.tag, query.replace(/^#/, ""), MAX_OTHER).map((d) => ({
        key: `tag:${d.path}`,
        label: `#${d.tag}`,
        hint: `${d.count} ${d.count === 1 ? "note" : "notes"}`,
        icon: "icon:tag",
        onPick: () => pick(`${d.path}|#${d.tag}`),
      }))
    : [];
  return [
    { title: "Date", items: dates },
    { title: "People", items: people.map((p) => pageItem(links, p, pick, "icon:user")) },
    { title: "Link to page", items: pages.map((p) => pageItem(links, p, pick)) },
    { title: "Whiteboards", items: boards },
    { title: "Decks", items: decks },
    { title: "Tags", items: tags },
  ];
}

/** `pick` gets a link's text, and a title when the page is to be made. */
export function sections(trigger: Trigger, query: string, links: LinkProvider, pick: PickLink): MenuSection[] {
  const pageItems = matchPages(links, query).map((page) => pageItem(links, page, pick));
  const title = query.trim();
  if (trigger === "page") {
    // A sub-page may share its name with another page, as in Notion.
    const items: MenuItem[] = title ? [{ key: "create", label: `“${title}”`, hint: "Enter", icon: "icon:page-plus", onPick: () => pick(title, title) }] : [];
    return [{ title: "New sub-page", items }];
  }
  if (trigger === "embed") return [{ title: "Embed a page", items: pageItems }];
  if (trigger === "link") {
    const exists = findPage(links.pages(), title);
    const create: MenuItem[] =
      title && links.create ? [{ key: "create", label: exists ? `Another page “${title}”` : `New page “${title}”`, icon: "icon:plus", onPick: () => pick(title, title) }] : [];
    return [{ title: "Link to page", items: pageItems }, { items: create }];
  }
  return mentionSections(query, links, pick);
}

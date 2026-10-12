// What a page's editor knows of links: the pages it can link,
// where a link goes from this page, and how a link from here names a page:
// by title when that finds it, by path when other pages share the title.

import type { NoteMeta } from "../../../lib/vault/types";
import type { LinkFound, LinkHow, LinkProvider, PageLink } from "../../pages/editor/links";
import { directoryOf, placeOf, type Place } from "../links";
import { iconOf } from "../names";
import { openable } from "../tree";
import { openAt } from "./jump";
import { pageHeadings } from "./page-headings";
import { linkOpens } from "../open-how";
import { howFromName, useWorkspace } from "../store";
import { whereIfShared } from "../where";

const pageCache = new WeakMap<readonly NoteMeta[], PageLink[]>();

/** A note as the editor's link menus show it. */
export function pageLink(note: NoteMeta, notes: readonly NoteMeta[]): PageLink {
  const where = whereIfShared(note, notes);
  return { title: note.title, icon: iconOf(note), path: note.path, ...(where ? { where } : {}) };
}

/** The pages `[[` offers, made once per notes list. */
export function linkPages(notes: readonly NoteMeta[]): PageLink[] {
  let pages = pageCache.get(notes);
  if (!pages) {
    pages = openable(notes).map((n) => pageLink(n, notes));
    pageCache.set(notes, pages);
  }
  return pages;
}

/** Where the page at `path` sits, for its links. */
function placeAt(notes: readonly NoteMeta[], path: string): Place {
  const note = directoryOf(notes).note(path);
  return note ? placeOf(note) : { path, project: /^projects\/([^/]+)\//.exec(path)?.[1] ?? null };
}

/** The note a link from `path` to `target` goes to, if one. */
export function linkedNote(path: string, target: string): NoteMeta | undefined {
  const { notes } = useWorkspace.getState();
  const found = directoryOf(notes).resolve(target, placeAt(notes, path));
  return found && "note" in found ? found.note : undefined;
}

/** The link parts of a page's provider, for the page at `path()`. */
export function pageLinks(path: () => string): Pick<LinkProvider, "pages" | "find" | "linkText" | "open" | "headings"> {
  return {
    headings: (page, then) => (page.path ? pageHeadings(page.path, then) : []),
    pages: () => linkPages(useWorkspace.getState().notes),
    find: (target): LinkFound => {
      const { notes } = useWorkspace.getState();
      const found = directoryOf(notes).resolve(target, placeAt(notes, path()));
      if (!found) return null;
      return "note" in found ? { page: pageLink(found.note, notes) } : { choices: found.choices.map((n) => pageLink(n, notes)) };
    },
    linkText: (page) => {
      const { notes } = useWorkspace.getState();
      const dir = directoryOf(notes);
      const note = page.path ? dir.note(page.path) : undefined;
      return note ? dir.inner(note, placeAt(notes, path())) : page.title;
    },
    open: (target, asked, heading) => {
      const workspace = useWorkspace.getState();
      const found = target ? directoryOf(workspace.notes).resolve(target, placeAt(workspace.notes, path())) : { note: { path: path() } };
      const to = found && ("note" in found ? found.note.path : found.choices[0]!.path);
      // A plain click follows this page's `opens` key, else Settings → Pages
      // (a peek or the side stack has chosen already, before it gets here).
      const how = asked && asked !== "here" ? howFromName(asked) : linkOpens(path());
      if (to && heading) return openAt(to, { heading }, how);
      if (to) return workspace.openPath(to, how);
      void workspace.openTitle(target, how);
    },
  };
}

/** `links` with a plain click opening `here` instead: from a quick-glance
 * card a new tab, from a peek the peek itself, so the page behind stays. */
export function clicksOpen(links: LinkProvider, here: LinkHow): LinkProvider {
  if (here === "here") return links;
  const to = (how?: LinkHow): LinkHow => (!how || how === "here" ? here : how);
  const { openFile, openBoard, openDeck, openDiagram, openDatabase } = links;
  return {
    ...links,
    open: (target, how, heading) => links.open(target, to(how), heading),
    ...(openFile && { openFile: (href: string, how?: LinkHow) => openFile(href, to(how)) }),
    ...(openBoard && { openBoard: (path: string, how?: LinkHow) => openBoard(path, to(how)) }),
    ...(openDeck && { openDeck: (path: string, how?: LinkHow) => openDeck(path, to(how)) }),
    ...(openDiagram && { openDiagram: (path: string, how?: LinkHow) => openDiagram(path, to(how)) }),
    ...(openDatabase && { openDatabase: (tag: string, how?: LinkHow) => openDatabase(tag, to(how)) }),
  };
}

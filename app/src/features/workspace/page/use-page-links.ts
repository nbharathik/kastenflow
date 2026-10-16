// What a page's links can do: open and make pages, preview and embed them,
// and open files, boards, decks, diagrams and the web.

import { useMemo } from "react";

import { webTitle } from "../../../lib/api";
import { isDay } from "../../../lib/dates";
import { noteLink } from "../../../lib/kasten-links";
import { showOpenMenu } from "../../../shell/open-menu";
import type { VaultClient } from "../../../lib/vault/types";
import type { LinkHow, LinkProvider } from "../../pages/editor/links";
import { splitFrontmatter } from "../../pages/markdown/frontmatter";
import { showSpot, spotOfLink } from "../../sources/highlight-request";
import { iconOf, readable, titleOf } from "../names";
import { useWorkspace } from "../store";
import { noteAt } from "../tree";
import { boardLinks } from "./board-links";
import { databaseLinks } from "./database-links";
import { deckLinks } from "./deck-links";
import { diagramLinks } from "./diagram-links";
import { HOLDS_PAGES, newPageHome } from "./new-page-home";
import { pageFiles } from "./page-files";
import { clicksOpen, linkedNote, pageLink, pageLinks } from "./page-links";
import type { PageSession } from "./page-session";
import { peopleLinks } from "./people-links";

/** `linksOpen` is where a plain click on the page's links opens. */
export function usePageLinks(client: VaultClient, session: PageSession, linksOpen: LinkHow): LinkProvider {
  return useMemo<LinkProvider>(
    () => clicksOpen({
      ...pageLinks(() => session.path),
      create: async (title, open) => {
        const workspace = useWorkspace.getState();
        if (isDay(title)) {
          if (open) void workspace.openJournal(title, linksOpen);
          return null;
        }
        // A page's sub-page, or from a journal day or a card a page of its own.
        const made = await workspace.create({ kind: "page", title, ...newPageHome(noteAt(workspace.notes, session.path)) }, false);
        if (made && open) useWorkspace.getState().openPath(made.meta.path, linksOpen);
        return made ? pageLink(made.meta, useWorkspace.getState().notes) : null;
      },
      preview: async (target) => {
        const note = linkedNote(session.path, target);
        if (!note) return null;
        const { body } = splitFrontmatter((await client.read(note.path)).text);
        const text = readable(body.split(/\r?\n/).filter((line) => line.trim()).slice(0, 8).join("\n"));
        return { title: titleOf(note), icon: iconOf(note), text: text.slice(0, 400) };
      },
      openFile: (href, how) => {
        const spot = spotOfLink(href, session.path);
        if (spot) showSpot(spot, how);
        return Boolean(spot);
      },
      copyLocation: ({ text, nth }) => {
        const { toast, notes } = useWorkspace.getState();
        const id = noteAt(notes, session.path)?.id;
        if (!id) return toast("This page has no id to link to yet. Save it, then try again");
        void navigator.clipboard?.writeText(noteLink(id, text, nth)).then(
          () => toast("Copied the link to this heading"),
          () => toast("The link could not be copied"),
        );
      },
      ...boardLinks(client, () => noteAt(useWorkspace.getState().notes, session.path)),
      ...deckLinks(client, () => noteAt(useWorkspace.getState().notes, session.path)),
      ...diagramLinks(client, () => noteAt(useWorkspace.getState().notes, session.path)),
      ...peopleLinks(),
      webTitle,
      openMenu: (event, path) => {
        showOpenMenu(event, path);
        return true;
      },
      ...databaseLinks(() => (HOLDS_PAGES.has(noteAt(useWorkspace.getState().notes, session.path)?.kind ?? "") ? session.path : null)),
      embed: (target) => {
        const note = linkedNote(session.path, target);
        if (!note) return null;
        return {
          stamp: `${note.path}:${note.modified}`,
          load: async () => ({
            title: titleOf(note),
            icon: iconOf(note),
            markdown: splitFrontmatter((await client.read(note.path)).text).body,
            url: pageFiles(client, () => note.path).url,
          }),
        };
      },
    }, linksOpen),
    [session, client, linksOpen],
  );
}

// The pages of the vault, as the Slides host gives them to a deck: chosen, read, listed, opened, and heard about when they change.
// A deck keeps the page's path and what it said; the host reads the page again when asked.

import type { HostPage, HostPageText, OpenPageWay, SlidesHost } from "@kasten-slides/react";

import { openWeb } from "../../shell/web-links";
import type { VaultClient } from "../../lib/vault/types";
import { openInKastenTab } from "../browser/open";
import { splitFrontmatter } from "../pages/markdown/frontmatter";
import { useWorkspace } from "../workspace/store";
import { onPageFiles } from "./events";
import { PagePanel } from "./PagePanel";
import { hostPage, isPage, usePagePicker } from "./page-picker";

type PageMembers = Required<Pick<SlidesHost, "pickPage" | "readPage" | "listPages" | "openPage" | "watchPages" | "pagePanel" | "openUrl" | "openInTab">>;

/** How the Slides host's ways of opening a page are the workspace's own. */
const WAYS: Record<OpenPageWay, "here" | "tab" | "right" | "peek"> = { here: "here", tab: "tab", right: "right", peek: "peek" };

/** The host members for pages, on the vault's notes. */
export function pageHost(client: VaultClient): PageMembers {
  return {
    pickPage: () => usePagePicker.getState().ask(),
    async readPage(path): Promise<HostPageText | undefined> {
      try {
        const note = await client.read(path);
        return { ...hostPage(note.meta), markdown: splitFrontmatter(note.text).body };
      } catch {
        // A page that was moved or put in the trash is no page: the deck keeps what it had.
        return undefined;
      }
    },
    async listPages(): Promise<HostPage[]> {
      return useWorkspace
        .getState()
        .notes.filter(isPage)
        .sort((a, b) => b.modified - a.modified)
        .map(hostPage);
    },
    // A link to a page opens it in a peek at the side, so the person keeps their place in the deck; the Open menu has the other ways.
    openPage: (path, how = "peek") => useWorkspace.getState().openPath(path, WAYS[how]),
    watchPages: (onChange) => onPageFiles(onChange),
    pagePanel: PagePanel,
    openUrl: (url) => openWeb(url),
    openInTab: openInKastenTab,
  };
}

// The footer of a page: its sub-pages and the pages that link to it, opened
// the way a click says, with the Open menu on right-click.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OpenMenuHost } from "../../../shell/open-menu";
import type { NoteMeta, VaultClient } from "../../../lib/vault/types";
import { usePeek } from "../../peek/store";
import { usePrefs } from "../prefs";
import { useWorkspace } from "../store";
import { derive } from "../store-layout";
import { initialLayout } from "../tabs";
import { registerPage } from "./open-page";
import { usePageLayouts } from "./page-layout";
import type { PageSession } from "./page-session";
import { PageFooter } from "./PageFooter";

function note(path: string, title: string, extra: Partial<NoteMeta> = {}): NoteMeta {
  return {
    path,
    id: title,
    title,
    kind: "page",
    icon: null,
    cover: null,
    parent: null,
    project: null,
    tags: [],
    modified: 0,
    created: null,
    updated: null,
    excerpt: "",
    words: 0,
    props: {},
    locked: false,
    ...extra,
  };
}

const PARENT = note("library/parent.md", "Parent");
const CHILD = note("library/child.md", "Child", { parent: "Parent" });
const LINKER = note("library/linker.md", "Linker");
const NOTES = [PARENT, CHILD, LINKER];

/** A vault that knows one backlink: "Linker" links to the parent. */
const client = {
  backlinks: async () => [{ path: "library/linker.md", title: "Linker", icon: null, snippet: "see [[Parent]]" }],
} as unknown as VaultClient;

const state = () => useWorkspace.getState();
const paneTabs = (pane: number) => state().layout.panes[pane]!.tabs.map((t) => t.place.path ?? t.place.view);

async function footer() {
  localStorage.setItem("kasten.disclosure.page.subpages", "1");
  localStorage.setItem("kasten.disclosure.page.backlinks", "1");
  useWorkspace.setState({ notes: NOTES, ...derive(initialLayout({ view: "page", path: PARENT.path })), stack: [], stackOpen: false, recent: [], toasts: [] });
  render(
    <>
      <PageFooter note={PARENT} notes={NOTES} client={client} />
      <OpenMenuHost />
    </>,
  );
  return { child: screen.getByRole("button", { name: /Child/ }), linker: await screen.findByRole("button", { name: /Linker/ }) };
}

beforeEach(() => {
  localStorage.clear();
  usePrefs.setState({ newTabs: false, pageLinksOpen: "here", rightReplaces: true });
  usePeek.setState({ peek: null });
});
afterEach(cleanup);

describe("the page footer's links", () => {
  it("opens a sub-page or a backlink in place on a plain click", async () => {
    const { child } = await footer();
    fireEvent.click(child);
    expect(state().place.path).toBe("library/child.md");
    expect(paneTabs(0)).toHaveLength(1);
  });

  it("follows the default chosen in Settings on a plain click, and the keys over it", async () => {
    usePrefs.setState({ pageLinksOpen: "tab" });
    const { child, linker } = await footer();
    fireEvent.click(child);
    expect(paneTabs(0)).toEqual(["library/parent.md", "library/child.md"]);
    // A key means what it says, whatever the default.
    fireEvent.click(linker, { ctrlKey: true, altKey: true });
    expect(state().layout.panes).toHaveLength(2);
    expect(paneTabs(1)).toEqual(["library/linker.md"]);
  });

  it("follows the page's own `opens` over Settings", async () => {
    usePrefs.setState({ pageLinksOpen: "tab" });
    const session = { path: PARENT.path } as PageSession;
    const forget = registerPage(session, () => {}, () => {});
    usePageLayouts.setState({ of: new Map([[session, { opens: "right" }]]) });
    try {
      const { child } = await footer();
      fireEvent.click(child);
      expect(state().layout.panes).toHaveLength(2);
      expect(paneTabs(1)).toEqual(["library/child.md"]);
    } finally {
      forget();
      usePageLayouts.setState({ of: new Map() });
    }
  });

  it("opens a tab on a middle click", async () => {
    const { linker } = await footer();
    fireEvent(linker, new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }));
    expect(paneTabs(0)).toEqual(["library/parent.md", "library/linker.md"]);
  });

  it("shows the Open menu on right-click, for a sub-page and a backlink alike", async () => {
    const { child, linker } = await footer();
    for (const link of [child, linker]) {
      fireEvent.contextMenu(link, { clientX: 20, clientY: 20 });
      const menu = screen.getByRole("menu", { name: "Open" });
      expect(within(menu).getByRole("menuitem", { name: /^Open to the right/ })).toBeTruthy();
      expect(within(menu).getByRole("menuitem", { name: /^Copy link/ })).toBeTruthy();
      fireEvent.keyDown(document.activeElement!, { key: "Escape" });
      expect(screen.queryByRole("menu")).toBeNull();
    }
    fireEvent.contextMenu(child);
    fireEvent.click(screen.getByRole("menuitem", { name: /^Open in center peek/ }));
    expect(usePeek.getState().peek).toEqual({ path: "library/child.md", mode: "center" });
  });
});

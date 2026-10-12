// The breadcrumb above a page: clicks with keys, the Open menu, and the parents a long one leaves out.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { usePeek } from "../features/peek/store";
import { usePrefs } from "../features/workspace/prefs";
import { useWorkspace } from "../features/workspace/store";
import { derive } from "../features/workspace/store-layout";
import { initialLayout } from "../features/workspace/tabs";
import type { NoteMeta } from "../lib/vault/types";
import { OpenMenuHost } from "./open-menu";
import { TopBar } from "./TopBar";

function note(path: string, title: string, extra: Partial<NoteMeta> = {}): NoteMeta {
  return {
    path,
    id: title,
    title,
    kind: path.endsWith("_project.md") ? "project" : "page",
    icon: null,
    cover: null,
    parent: null,
    project: "demo",
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

/** Demo > One > Two > Three > Four: a chain longer than the breadcrumb shows. */
const NOTES = [
  note("projects/demo/_project.md", "Demo"),
  note("projects/demo/pages/one.md", "One"),
  note("projects/demo/pages/two.md", "Two", { parent: "One" }),
  note("projects/demo/pages/three.md", "Three", { parent: "Two" }),
  note("projects/demo/pages/four.md", "Four", { parent: "Three" }),
];

const state = () => useWorkspace.getState();
const paneTabs = (pane: number) => state().layout.panes[pane]!.tabs.map((t) => t.place.path ?? t.place.view);

function bar(path = "projects/demo/pages/four.md") {
  useWorkspace.setState({ notes: NOTES, ...derive(initialLayout({ view: "page", path })), stack: [], stackOpen: false, recent: [], toasts: [] });
  render(
    <>
      <TopBar pane={state().layout.panes[0]!} first />
      <OpenMenuHost />
    </>,
  );
  return screen.getByRole("navigation", { name: "Breadcrumb" });
}

beforeEach(() => {
  localStorage.clear();
  usePrefs.setState({ newTabs: false, pageLinksOpen: "here", rightReplaces: true });
  usePeek.setState({ peek: null });
});
afterEach(cleanup);

describe("the breadcrumb", () => {
  it("leaves the middle of a long chain out, and lists it behind the dots", () => {
    const crumbs = bar();
    const names = [...crumbs.querySelectorAll("button")].map((b) => b.textContent?.trim());
    expect(names).toEqual(["Demo", "…", "Two", "Three"]);
    expect(crumbs.textContent).toContain("Four");
    // The dots are a button that names what it holds, and opens a menu of the parents left out.
    fireEvent.click(within(crumbs).getByRole("button", { name: "Show the parents left out" }));
    const left = within(screen.getByRole("menu", { name: "Show the parents left out" })).getAllByRole("menuitem");
    expect(left.map((item) => item.textContent)).toEqual(["One"]);
    fireEvent.click(left[0]!);
    expect(state().place).toEqual({ view: "page", path: "projects/demo/pages/one.md" });
  });

  it("goes to a parent on a plain click, in the tab you are in", () => {
    const crumbs = bar();
    fireEvent.click(within(crumbs).getByRole("button", { name: "Three" }));
    expect(state().place.path).toBe("projects/demo/pages/three.md");
    expect(paneTabs(0)).toHaveLength(1);
  });

  it("opens a parent as the keys say: a tab, the stack, a split, the pane to the right", () => {
    const crumbs = bar();
    const three = () => within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("button", { name: "Three" });
    fireEvent.click(three(), { ctrlKey: true });
    expect(paneTabs(0)).toEqual(["projects/demo/pages/four.md", "projects/demo/pages/three.md"]);
    fireEvent.click(within(crumbs).getByRole("button", { name: "Two" }), { shiftKey: true });
    expect(state().stack).toEqual(["projects/demo/pages/two.md"]);
    fireEvent.click(within(crumbs).getByRole("button", { name: "Demo" }), { ctrlKey: true, altKey: true });
    expect(state().layout.panes).toHaveLength(2);
    expect(paneTabs(1)).toEqual(["projects/demo/_project.md"]);
  });

  it("opens a tab on a middle click", () => {
    const crumbs = bar();
    fireEvent(within(crumbs).getByRole("button", { name: "Three" }), new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }));
    expect(paneTabs(0)).toContain("projects/demo/pages/three.md");
  });

  it("shows the Open menu on right-click", () => {
    const crumbs = bar();
    fireEvent.contextMenu(within(crumbs).getByRole("button", { name: "Two" }), { clientX: 30, clientY: 30 });
    const menu = screen.getByRole("menu", { name: "Open" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: /^Open in side peek/ }));
    expect(usePeek.getState().peek).toEqual({ path: "projects/demo/pages/two.md", mode: "side" });
  });

  it("shows no dots when the chain is short", () => {
    const crumbs = bar("projects/demo/pages/two.md");
    expect(within(crumbs).queryByRole("button", { name: "Show the parents left out" })).toBeNull();
  });
});

describe("the page menu", () => {
  it("opens the page in a side peek, and offers where its links open", () => {
    bar();
    fireEvent.click(screen.getByRole("button", { name: "Page options" }));
    const labels = within(screen.getByRole("menu", { name: "Page options" })).getAllByRole("menuitem").map((el) => el.querySelector("span.flex-1")?.textContent);
    expect(labels).toContain("Open in side peek");
    expect(labels).toContain("Open links from this page in…");
    fireEvent.click(screen.getByRole("menuitem", { name: "Open in side peek" }));
    expect(usePeek.getState().peek).toEqual({ path: "projects/demo/pages/four.md", mode: "side" });
  });
});

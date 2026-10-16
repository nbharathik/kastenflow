import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OpenMenuHost } from "./open-menu";
import { usePrefs } from "../features/workspace/prefs";
import type { NoteMeta } from "../lib/vault/types";
import { useBoards } from "../features/boards/store";
import { useDecks } from "../features/slides/store";
import { useWorkspace } from "../features/workspace/store";
import { derive } from "../features/workspace/store-layout";
import { initialLayout } from "../features/workspace/tabs";
import { useShell } from "../lib/store";
import { forgetRowLimits } from "./row-limit";
import { Sidebar } from "./Sidebar";

function note(path: string, extra: Partial<NoteMeta> = {}): NoteMeta {
  const parts = path.split("/");
  const project = parts[0] === "projects" ? parts[1]! : null;
  const kind = path.endsWith("_project.md") ? "project" : path.includes("/cards/") ? "card" : "page";
  return {
    path,
    id: null,
    title: parts[parts.length - 1]!.replace(/\.md$/, ""),
    kind,
    icon: null,
    cover: null,
    parent: null,
    project,
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

/** A project of 20 pages ("Page 01" to "Page 20") and two quick notes, a small project, and two loose pages. */
function vault(): NoteMeta[] {
  const big = Array.from({ length: 20 }, (_, i) => note(`projects/big/pages/Page ${String(i + 1).padStart(2, "0")}.md`));
  return [
    note("projects/big/_project.md", { title: "Big project", id: "big" }),
    ...big,
    note("projects/big/cards/quick thought.md"),
    note("projects/big/cards/clipped link.md"),
    note("projects/small/_project.md", { title: "Small project", id: "small" }),
    note("projects/small/pages/Gamma notes.md"),
    note("projects/small/pages/Alpha notes.md"),
    note("library/Loose gamma.md"),
    note("library/Loose beta.md"),
  ];
}

const state = () => useWorkspace.getState();
const sidebar = () => screen.getByRole("navigation", { name: "Sidebar" });
const region = (name: string) => within(sidebar()).getByRole("region", { name });
/** Titles of the page rows in a region, in order. */
const rows = (name: string) => [...region(name).querySelectorAll("[data-row-title]")].map((el) => el.textContent);

function mount() {
  render(
    <>
      <Sidebar />
      <OpenMenuHost />
    </>,
  );
}

beforeEach(() => {
  localStorage.clear();
  forgetRowLimits();
  usePrefs.setState({ navPinned: null, moreViews: false, foldedSections: [], favourites: [], pinnedPages: [], pinnedProjects: [], sidebarShowCards: false, newTabs: false, pageLinksOpen: "here", rightReplaces: true });
  useBoards.setState({ list: [] });
  useDecks.setState({ list: [] });
  useShell.setState({ sidebarOpen: true, namingProject: false });
  useWorkspace.setState({ client: null, ready: true, notes: vault(), ...derive(initialLayout()), stack: [], stackOpen: false, recent: [], toasts: [] });
});
afterEach(cleanup);

/** Opens a project's row, as a click on its chevron does; which rows are open is kept across tests, so one already open stays so. */
const expand = (title: string) => {
  const chevron = within(region("Projects")).queryByRole("button", { name: `Expand ${title}` });
  if (chevron) fireEvent.click(chevron);
};

describe("pages under a project", () => {
  it("lists the first 15 pages, then offers the rest, and no quick notes", () => {
    mount();
    expand("Big project");
    const project = rows("Projects");
    expect(project.filter((t) => t?.startsWith("Page "))).toHaveLength(15);
    expect(project).toContain("Page 15");
    expect(project).not.toContain("Page 16");
    expect(project).not.toContain("quick thought");
    expect(project).not.toContain("clipped link");
    expect(within(region("Projects")).getByRole("button", { name: "Show 5 more of 20" })).toBeTruthy();
  });

  it("shows the rest on request, and keeps it shown when the project is closed and opened again", () => {
    mount();
    expand("Big project");
    fireEvent.click(within(region("Projects")).getByRole("button", { name: "Show 5 more of 20" }));
    expect(rows("Projects").filter((t) => t?.startsWith("Page "))).toHaveLength(20);
    expect(within(region("Projects")).queryByRole("button", { name: /^Show \d+ more/ })).toBeNull();
    fireEvent.click(within(region("Projects")).getByRole("button", { name: "Collapse Big project" }));
    expect(rows("Projects").filter((t) => t?.startsWith("Page "))).toHaveLength(0);
    expand("Big project");
    expect(rows("Projects").filter((t) => t?.startsWith("Page "))).toHaveLength(20);
  });

  it("keeps a short project whole", () => {
    mount();
    expand("Small project");
    expect(rows("Projects")).toContain("Alpha notes");
    expect(rows("Projects")).toContain("Gamma notes");
  });

  it("lists quick notes under the project when asked to, after its pages", () => {
    usePrefs.setState({ sidebarShowCards: true });
    mount();
    expand("Big project");
    fireEvent.click(within(region("Projects")).getByRole("button", { name: /^Show \d+ more/ }));
    const project = rows("Projects");
    expect(project).toContain("quick thought");
    expect(project).toContain("clipped link");
    expect(project.indexOf("clipped link")).toBeGreaterThan(project.indexOf("Page 20"));
  });
});

describe("pinned pages", () => {
  it("come first in their project, marked, and the page menu pins and unpins them", () => {
    mount();
    expand("Small project");
    expect(rows("Projects").slice(-2)).toEqual(["Alpha notes", "Gamma notes"]);
    fireEvent.click(within(region("Projects")).getByRole("button", { name: "More for Gamma notes" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Pin to the top" }));
    expect(usePrefs.getState().pinnedPages).toEqual(["projects/small/pages/Gamma notes.md"]);
    expect(rows("Projects").slice(-2)).toEqual(["Gamma notes", "Alpha notes"]);
    expect(within(region("Projects")).getAllByRole("img", { name: "Pinned" })).toHaveLength(1);
    fireEvent.click(within(region("Projects")).getByRole("button", { name: "More for Gamma notes" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Unpin from the top" }));
    expect(usePrefs.getState().pinnedPages).toEqual([]);
    expect(rows("Projects").slice(-2)).toEqual(["Alpha notes", "Gamma notes"]);
  });

  it("come first among the loose pages too", () => {
    usePrefs.setState({ pinnedPages: ["library/Loose gamma.md"] });
    mount();
    expect(rows("Pages")).toEqual(["Loose gamma", "Loose beta"]);
  });
});

describe("the filter box", () => {
  const filter = () => screen.getByRole("textbox", { name: "Filter pages" }) as HTMLInputElement;

  it("narrows the tree to the titles that match, with their project opened out", () => {
    mount();
    fireEvent.change(filter(), { target: { value: "gamma" } });
    expect(rows("Projects")).toEqual(["Small project", "Gamma notes"]);
    expect(rows("Pages")).toEqual(["Loose gamma"]);
    expect(region("Projects").textContent).not.toContain("Big project");
  });

  it("finds a page past the first 15 of a project, and every match without a cut", () => {
    mount();
    fireEvent.change(filter(), { target: { value: "page" } });
    expect(rows("Projects").filter((t) => t?.startsWith("Page "))).toHaveLength(20);
    expect(within(region("Projects")).queryByRole("button", { name: /^Show \d+ more/ })).toBeNull();
  });

  it("clears on Escape, and says when nothing matches", () => {
    mount();
    fireEvent.change(filter(), { target: { value: "zzz" } });
    expect(within(sidebar()).getByText(/No page is called/)).toBeTruthy();
    fireEvent.keyDown(filter(), { key: "Escape" });
    expect(filter().value).toBe("");
    expect(within(sidebar()).queryByText(/No page is called/)).toBeNull();
    expect(region("Projects").textContent).toContain("Big project");
  });

  it("finds quick notes even when the sidebar leaves them out", () => {
    mount();
    fireEvent.change(filter(), { target: { value: "quick" } });
    expect(rows("Projects")).toEqual(["Big project", "quick thought"]);
  });

  it("matches whiteboards and decks by title, opening their project", () => {
    useBoards.setState({ list: [{ path: "projects/small/roadmap.canvas", title: "Roadmap", project: "small", modified: 1 } as never] });
    useDecks.setState({ list: [{ path: "projects/big/pitch.deck", title: "Pitch deck", project: "big", modified: 1, slides: 1 } as never] });
    mount();
    fireEvent.change(filter(), { target: { value: "pitch" } });
    expect(region("Projects").textContent).toContain("Pitch deck");
    expect(region("Projects").textContent).not.toContain("Small project");
    fireEvent.change(filter(), { target: { value: "road" } });
    expect(region("Projects").textContent).toContain("Roadmap");
  });
});

describe("opening from the sidebar", () => {
  it("takes Ctrl, Shift and Alt clicks as it does everywhere, and the default from Settings for a plain one", () => {
    mount();
    expand("Small project");
    const row = () => within(region("Projects")).getByRole("button", { name: "Alpha notes" });
    fireEvent.click(row(), { ctrlKey: true });
    expect(state().layout.panes[0]!.tabs.map((t) => t.place.path ?? t.place.view)).toEqual(["home", "projects/small/pages/Alpha notes.md"]);
    fireEvent.click(row(), { ctrlKey: true, altKey: true });
    expect(state().layout.panes).toHaveLength(2);
    // The default a person set applies to a plain click: back on the left,
    // a page goes to the right and takes the place of the one there.
    act(() => state().focusPane(state().layout.panes[0]!.id));
    usePrefs.setState({ pageLinksOpen: "right" });
    fireEvent.click(within(region("Projects")).getByRole("button", { name: "Gamma notes" }));
    expect(state().layout.panes).toHaveLength(2);
    expect(state().layout.panes[1]!.tabs.map((t) => t.place.path)).toEqual(["projects/small/pages/Gamma notes.md"]);
    expect(state().place.path).toBe("projects/small/pages/Gamma notes.md");
  });

  it("shows the Open menu's ways in a row's menu, ahead of its own", () => {
    mount();
    fireEvent.click(within(region("Pages")).getByRole("button", { name: "More for Loose beta" }));
    const labels = [...document.querySelectorAll('[role="menuitem"]')].map((el) => el.querySelector("span.flex-1")?.textContent);
    expect(labels).toEqual(expect.arrayContaining(["Open", "Open in new tab", "Open to the right", "Open in side peek", "Open in center peek", "Open in side stack", "Copy link", "Rename", "Move to Trash"]));
    expect(labels.indexOf("Open to the right")).toBeLessThan(labels.indexOf("Rename"));
  });

  it("offers a new deck in a project's menu", () => {
    mount();
    fireEvent.click(within(region("Projects")).getByRole("button", { name: "More for Small project" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "New deck here" }));
    expect(state().place).toEqual({ view: "slides" });
    expect(useDecks.getState().creating).toBe(true);
    expect(useDecks.getState().draftProject).toBe("small");
  });
});

describe("the Projects hub from the Projects heading", () => {
  const hubButton = () => within(region("Projects")).getByRole("button", { name: "All projects" });

  it("has a small named button beside the heading that opens the hub, and the heading still folds", () => {
    mount();
    expect(hubButton().tagName).toBe("BUTTON");
    expect(hubButton().getAttribute("aria-current")).toBeNull();
    fireEvent.click(hubButton());
    expect(state().place).toEqual({ view: "projects" });
    expect(hubButton().getAttribute("aria-current")).toBe("page");
    // Folding is the heading's own button.
    fireEvent.click(within(region("Projects")).getByRole("button", { name: "Projects" }));
    expect(usePrefs.getState().foldedSections).toContain("Projects");
    expect(hubButton()).toBeTruthy();
  });

  it("opens in a tab with Ctrl, beside with Ctrl+Alt and in a tab with the middle button, as a view's row does", () => {
    mount();
    fireEvent.click(hubButton(), { ctrlKey: true });
    expect(state().layout.panes[0]!.tabs.map((t) => t.place.view)).toEqual(["home", "projects"]);
    fireEvent.click(hubButton(), { ctrlKey: true, altKey: true });
    expect(state().layout.panes).toHaveLength(2);
    expect(state().place).toEqual({ view: "projects" });
    act(() => state().focusPane(state().layout.panes[0]!.id));
    fireEvent(hubButton(), new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }));
    expect(state().layout.panes.flatMap((p) => p.tabs.map((t) => t.place.view)).filter((v) => v === "projects").length).toBeGreaterThanOrEqual(1);
  });

  it("is reachable by keyboard: a button in the tab order, with a name and a tooltip", () => {
    mount();
    expect(hubButton().tabIndex).toBe(0);
    expect(hubButton().getAttribute("title")).toMatch(/^All projects/);
  });
});

describe("the dot on a paused or finished project's row", () => {
  it("shows a quiet dot named for the status on a paused or done project, and none on an active one", () => {
    useWorkspace.setState({
      notes: [
        note("projects/big/_project.md", { title: "Big project", id: "big" }),
        note("projects/small/_project.md", { title: "Small project", id: "small", props: { status: "Paused" } }),
        note("projects/done/_project.md", { title: "Finished one", id: "done", props: { status: "done" } }),
        note("projects/odd/_project.md", { title: "Odd one", id: "odd", props: { status: "someday" } }),
      ],
    });
    mount();
    const marks = within(region("Projects")).getAllByRole("img").map((el) => el.getAttribute("aria-label"));
    expect(marks.sort()).toEqual(["Done", "Paused"]);
    const row = within(region("Projects")).getByRole("button", { name: "Small project" }).closest("[data-row-path]")!;
    expect(within(row as HTMLElement).getByRole("img", { name: "Paused" })).toBeTruthy();
  });

  it("keeps the pin beside it", () => {
    usePrefs.setState({ pinnedProjects: ["small"] });
    useWorkspace.setState({ notes: [note("projects/small/_project.md", { title: "Small project", id: "small", props: { status: "Paused" } })] });
    mount();
    expect(within(region("Projects")).getAllByRole("img").map((el) => el.getAttribute("aria-label")).sort()).toEqual(["Paused", "Pinned"]);
  });
});

describe("the views list", () => {
  const more = () => screen.getByRole("button", { name: "More views" });

  it("shows the pinned views, and keeps the others behind More views", () => {
    mount();
    for (const name of ["Inbox", "Journal", "Tasks", "Calendar"]) expect(within(sidebar()).getByRole("button", { name })).toBeTruthy();
    for (const name of ["Whiteboards", "Slides", "Card Library", "Trash"]) expect(within(sidebar()).queryByRole("button", { name })).toBeNull();
    fireEvent.click(more());
    const list = within(sidebar()).getByRole("group", { name: "All views" });
    expect(within(list).getAllByRole("heading").map((h) => h.textContent)).toEqual(["Capture", "Think", "Organise", "Tools"]);
    expect(within(list).getByRole("button", { name: "Slides" })).toBeTruthy();
    // Settings has its own button at the foot.
    expect(within(sidebar()).getByRole("button", { name: "Settings" })).toBeTruthy();
    // The list stays open, as the window left it.
    expect(usePrefs.getState().moreViews).toBe(true);
  });

  it("pins and unpins a view from its row, at once and for good", () => {
    usePrefs.setState({ moreViews: true });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Pin Slides to the sidebar" }));
    expect(usePrefs.getState().navPinned).toEqual(["inbox", "journal", "tasks", "calendar", "slides"]);
    // Pinned, it is above the list as well.
    expect(within(sidebar()).getAllByRole("button", { name: "Slides" })).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem("kasten.prefs")!).navPinned).toContain("slides");
    fireEvent.click(screen.getByRole("button", { name: "Unpin Journal from the sidebar" }));
    expect(usePrefs.getState().navPinned).toEqual(["inbox", "tasks", "calendar", "slides"]);
    expect(within(sidebar()).getAllByRole("button", { name: "Journal" })).toHaveLength(1);
  });

  it("keeps an unpinned view in sight while it is open, and a count on one that is not pinned", () => {
    usePrefs.setState({ navPinned: ["tasks"] });
    useWorkspace.setState({ notes: [...vault(), note("inbox/idea.md")] });
    mount();
    // Inbox is not pinned, but has a count.
    expect(within(sidebar()).getByRole("button", { name: /^Inbox/ }).textContent).toContain("1");
    expect(within(sidebar()).queryByRole("button", { name: "Journal" })).toBeNull();
    act(() => state().go({ view: "journal" }));
    expect(within(sidebar()).getByRole("button", { name: "Journal" }).getAttribute("aria-current")).toBe("page");
    act(() => state().go({ view: "trash" }));
    expect(within(sidebar()).getByRole("button", { name: "Trash" }).getAttribute("aria-current")).toBe("page");
    expect(within(sidebar()).queryByRole("button", { name: "Journal" })).toBeNull();
  });

  it("opens a view the way a click says", () => {
    mount();
    fireEvent.click(within(sidebar()).getByRole("button", { name: "Tasks" }), { ctrlKey: true });
    expect(state().layout.panes[0]!.tabs.map((t) => t.place.view)).toEqual(["home", "tasks"]);
    fireEvent.click(within(sidebar()).getByRole("button", { name: "Calendar" }), { ctrlKey: true, altKey: true });
    expect(state().layout.panes).toHaveLength(2);
    expect(state().place.view).toBe("calendar");
    fireEvent(within(sidebar()).getByRole("button", { name: "Inbox" }), new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }));
    expect(state().layout.panes.flatMap((p) => p.tabs.map((t) => t.place.view))).toContain("inbox");
  });

  it("shows a menu on right-click: the ways to open it, and pin, unpin and move", () => {
    mount();
    fireEvent.contextMenu(within(sidebar()).getByRole("button", { name: "Journal" }), { clientX: 20, clientY: 20 });
    const menu = screen.getByRole("menu", { name: "Journal options" });
    const labels = within(menu).getAllByRole("menuitem").map((el) => el.querySelector("span.flex-1")?.textContent);
    expect(labels).toEqual(["Open", "Open in new tab", "Open to the right", "Unpin from the sidebar", "Move up", "Move down"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Move up" }));
    expect(usePrefs.getState().navPinned).toEqual(["journal", "inbox", "tasks", "calendar"]);
    fireEvent.contextMenu(within(sidebar()).getByRole("button", { name: "Journal" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Unpin from the sidebar" }));
    expect(usePrefs.getState().navPinned).toEqual(["inbox", "tasks", "calendar"]);
    // An unpinned view's menu offers to pin it.
    usePrefs.setState({ moreViews: true });
  });

  it("narrows the list by what is typed, and answers the keys", () => {
    usePrefs.setState({ moreViews: true });
    mount();
    const box = screen.getByRole("textbox", { name: "Filter views" }) as HTMLInputElement;
    fireEvent.change(box, { target: { value: "ta" } });
    const list = within(sidebar()).getByRole("group", { name: "All views" });
    expect(within(list).getAllByRole("button", { name: /^(Tag Database|Tasks)$/ })).toHaveLength(2);
    expect(within(list).queryByRole("button", { name: "Trash" })).toBeNull();
    // Down goes to the first row, Up comes back; Escape clears.
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("Tag Database");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("Tasks");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(box);
    fireEvent.keyDown(box, { key: "Escape" });
    expect(box.value).toBe("");
    // Enter opens the first view that is left.
    fireEvent.change(box, { target: { value: "trash" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(state().place.view).toBe("trash");
    fireEvent.change(box, { target: { value: "zzz" } });
    expect(within(list).getByText(/No view is called/)).toBeTruthy();
  });
});

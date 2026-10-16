import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadNotePage } from "../features/workspace/page/LazyNotePage";

import { MemoryVault } from "../features/workspace/preview/memory-vault";
import { draftSpec, isDraft } from "../features/workspace/drafts";
import { flushOpenPage } from "../features/workspace/page/use-note-session";
import { usePrefs } from "../features/workspace/prefs";
import { derive } from "../features/workspace/store-layout";
import { useWorkspace } from "../features/workspace/store";
import { initialLayout } from "../features/workspace/tabs";
import { useShell } from "../lib/store";
import { AppShell } from "./AppShell";
import { availableNav, defaultPinned, findNav, SETTINGS_NAV } from "./nav";

const SEED = {
  "library/welcome.md": "---\nid: 01K5Y2WE1C0MEPAGE000000001\ntitle: Welcome\nicon: 👋\n---\nHello [[Roadmap]].\n",
  "library/child.md": "---\ntitle: Child page\nparent: 01K5Y2WE1C0MEPAGE000000001\n---\nInside.\n",
  "projects/demo/_project.md": "---\ntitle: Demo project\ntype: project\n---\nThe project.\n",
  "projects/demo/pages/roadmap.md": "---\ntitle: Roadmap\n---\n## Phase one\n\n- [ ] Ship it\n- [x] Plan it\n",
  "inbox/idea.md": "---\ntitle: An idea\n---\nThink about it.\n",
  "templates/paper.md": "---\ntitle: \"{{title}}\"\n---\n## Abstract\n",
};

let vault: MemoryVault;

// Panel behavior starts with the editor module available (and the "Move to"
// picker, which loads when it is opened); module-load latency is separate from
// the behavior asserted below.
beforeAll(async () => {
  await loadNotePage();
  await import("../features/workspace/overlays/MovePicker");
}, 60_000);

async function renderShell() {
  render(<AppShell connect={async () => ({ client: vault })} />);
  return screen.findByRole("navigation", { name: "Sidebar" });
}

beforeEach(() => {
  localStorage.clear();
  // The sidebar's views as they are before anyone arranges them.
  usePrefs.setState({ navPinned: null, moreViews: false, foldedSections: [] });
  vault = new MemoryVault(SEED);
  useWorkspace.setState({ client: null, ready: false, notes: [], ...derive(initialLayout()), stack: [], stackOpen: false, recent: [], toasts: [] });
  useShell.setState({ sidebarOpen: true, focusMode: false, paletteOpen: false, shortcutsOpen: false, panels: [], sourceOpen: false });
});
afterEach(cleanup);

describe("AppShell", () => {
  it("opens the right panel only in the pane it is asked for", async () => {
    await renderShell();
    act(() => useWorkspace.getState().openPath("library/welcome.md"));
    act(() => useWorkspace.getState().splitRight({ view: "page", path: "projects/demo/pages/roadmap.md" }));
    const panes = await screen.findAllByRole("region", { name: "Pane" });
    expect(panes).toHaveLength(2);
    fireEvent.click(await within(panes[0]!).findByRole("button", { name: "Outline and details" }, { timeout: 20_000 }));
    expect(await within(panes[0]!).findByRole("complementary", { name: "Page details" }, { timeout: 20_000 })).toBeTruthy();
    expect(within(panes[1]!).queryByRole("complementary", { name: "Page details" })).toBeNull();
    // The other pane's own button opens its own.
    fireEvent.click(within(panes[1]!).getByRole("button", { name: "Outline and details" }));
    expect(await within(panes[1]!).findByRole("complementary", { name: "Page details" }, { timeout: 20_000 })).toBeTruthy();
    fireEvent.click(within(panes[0]!).getByRole("button", { name: "Outline and details" }));
    await expect.poll(() => within(panes[0]!).queryByRole("complementary", { name: "Page details" })).toBeNull();
    expect(within(panes[1]!).getByRole("complementary", { name: "Page details" })).toBeTruthy();
  }, 60_000);

  it("offers to create or open a vault when none is chosen yet", async () => {
    render(<AppShell connect={async () => ({ client: null, choose: true })} />);
    expect(await screen.findByRole("heading", { name: "Welcome to KastenFlow" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Create a new vault" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Open a folder" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Sidebar" })).toBeNull();
  });

  it("lists the pinned views in their order, and the rest under More views", async () => {
    const sidebar = await renderShell();
    const labels = () => [...sidebar.querySelectorAll("button")].map((b) => b.textContent ?? "");
    const pinned = defaultPinned().map((id) => findNav(id as never)!);
    const at = pinned.map((n) => labels().findIndex((l) => l.startsWith(n.label)));
    expect(at.every((p) => p >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // The others wait behind "More views", which opens the list in place.
    expect(within(sidebar).queryByRole("button", { name: /^Card Library/ })).toBeNull();
    const more = within(sidebar).getByRole("button", { name: "More views" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    const list = within(sidebar).getByRole("group", { name: "All views" });
    for (const item of availableNav()) expect(within(list).getByRole("button", { name: new RegExp(`^${item.label}`) }), item.label).toBeTruthy();
    expect(within(sidebar).getByRole("button", { name: SETTINGS_NAV.label })).toBeTruthy();
  });

  it("shows projects, pages and sub-pages from the vault", async () => {
    const sidebar = await renderShell();
    const projects = await within(sidebar).findByRole("region", { name: "Projects" });
    expect(projects.textContent).toContain("Demo project");
    fireEvent.click(within(projects).getByRole("button", { name: "Expand Demo project" }));
    expect(projects.textContent).toContain("Roadmap");
    const pages = within(sidebar).getByRole("region", { name: "Pages" });
    expect(pages.textContent).toContain("Welcome");
    expect(pages.textContent).not.toContain("Child page");
    fireEvent.click(within(pages).getByRole("button", { name: "Expand Welcome" }));
    expect(pages.textContent).toContain("Child page");
    expect(within(sidebar).getByRole("button", { name: /Inbox/ }).textContent).toContain("1");
  });

  it("draws every default icon as a line icon, never as its name", async () => {
    const sidebar = await renderShell();
    await within(sidebar).findByRole("button", { name: "Welcome" });
    fireEvent.click(within(sidebar).getByRole("button", { name: "More views" }));
    const views = ["Inbox", "Card Library", "Tasks", "Tag Database", "Whiteboards", "Home"];
    for (const name of views) {
      // A view that is open but not pinned also shows above the list.
      fireEvent.click(within(sidebar).getAllByRole("button", { name: new RegExp(`^${name}`) })[0]!);
      await act(async () => {});
      expect(document.body.textContent, name).not.toMatch(/icon:[a-z]/);
    }
    fireEvent.click(within(sidebar).getByRole("button", { name: "Welcome" }));
    await act(async () => {});
    expect(document.body.textContent).not.toMatch(/icon:[a-z]/);
  });

  it("opens a page from the sidebar and goes back", async () => {
    const sidebar = await renderShell();
    fireEvent.click(await within(sidebar).findByText("Welcome"));
    const title = (await screen.findByRole("textbox", { name: "Page title" }, { timeout: 20_000 })) as HTMLTextAreaElement;
    expect(title.value).toBe("Welcome");
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toContain("Welcome");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Back" })));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/^Good (morning|afternoon|evening)$/);
  });

  it("finds pages and runs commands from the palette", async () => {
    const sidebar = await renderShell();
    await within(sidebar).findByText("Demo project");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const search = screen.getByRole("textbox", { name: "Search" });
    fireEvent.change(search, { target: { value: "road" } });
    const results = screen.getByRole("listbox", { name: "Results" });
    expect(results.querySelector('[aria-selected="true"]')?.textContent).toContain("Roadmap");
    fireEvent.change(search, { target: { value: "trash" } });
    expect(results.textContent).toContain("Go to Trash");
    fireEvent.keyDown(search, { key: "Enter" });
    expect(screen.queryByRole("dialog", { name: "Search and commands" })).toBeNull();
    // The Trash view loads its code when first opened.
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toContain("Trash");
  });

  it("captures a quick note into the Inbox", async () => {
    await renderShell();
    const input = await screen.findByRole("textbox", { name: "Quick note" });
    fireEvent.change(input, { target: { value: "Call the printer" } });
    await act(async () => fireEvent.submit(input.closest("form")!));
    expect((await vault.list()).map((n) => n.path)).toContain("inbox/call-the-printer.md");
    expect(await screen.findByText(/Saved “Call the printer” to the Inbox/)).toBeTruthy();
  });

  it("sends Ctrl+N to the quick-note box when one shows, else to a card that waits for its first words", async () => {
    await renderShell();
    const input = await screen.findByRole("textbox", { name: "Quick note" });
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    expect(document.activeElement).toBe(input);

    act(() => useWorkspace.getState().openPath("library/welcome.md"));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Quick note" })).toBeNull());
    const before = (await vault.list()).length;
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    const place = useWorkspace.getState().place;
    expect(place.view === "page" && isDraft(place.path)).toBe(true);
    expect(place.view === "page" && draftSpec(place.path)?.kind).toBe("card");
    expect((await vault.list()).length).toBe(before);
    expect(screen.getByRole("tab", { name: /Quick note/ })).toBeTruthy();
  });

  it("moves a page to the trash with Undo", async () => {
    const sidebar = await renderShell();
    const pages = await within(sidebar).findByRole("region", { name: "Pages" });
    fireEvent.click(within(pages).getByRole("button", { name: "More for Welcome" }));
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: /Move to Trash/ })));
    expect((await vault.list()).some((n) => n.path === "library/welcome.md")).toBe(false);
    expect(within(sidebar).getByRole("region", { name: "Pages" }).textContent).not.toContain("Welcome");
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Undo" })));
    expect((await vault.list()).some((n) => n.path === "library/welcome.md")).toBe(true);
  });

  it("moves an inbox note into a project", async () => {
    const sidebar = await renderShell();
    fireEvent.click(within(sidebar).getByRole("button", { name: /Inbox/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Move An idea to a project" }));
    const picker = await screen.findByRole("dialog", { name: "Move to" });
    fireEvent.change(within(picker).getByRole("textbox"), { target: { value: "demo" } });
    await act(async () => fireEvent.keyDown(within(picker).getByRole("textbox"), { key: "Enter" }));
    expect((await vault.list()).map((n) => n.path)).toContain("projects/demo/cards/idea.md");
    expect(await screen.findByText(/Moved “An idea” to Demo project/)).toBeTruthy();
  });

  it("adds a loose page to a new project from the top bar", async () => {
    const sidebar = await renderShell();
    fireEvent.click(await within(sidebar).findByRole("button", { name: "Welcome" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add to project" }));
    const picker = await screen.findByRole("dialog", { name: "Move to" });
    fireEvent.change(within(picker).getByRole("textbox"), { target: { value: "Garden plans" } });
    expect(within(picker).getByRole("option", { name: /New project “Garden plans”/ })).toBeTruthy();
    await act(async () => fireEvent.keyDown(within(picker).getByRole("textbox"), { key: "Enter" }));
    await expect.poll(async () => (await vault.list()).map((n) => n.path)).toEqual(expect.arrayContaining(["projects/garden-plans/_project.md", "projects/garden-plans/pages/welcome.md"]));
    // In a project now, the page offers no "Add to project" any more.
    await expect.poll(() => screen.queryByRole("button", { name: "Add to project" })).toBeNull();
  });

  it("triages the inbox one note at a time with keys", async () => {
    // A clock that always moves on, so the card made here is the newest.
    let clock = Date.now();
    vault = new MemoryVault(SEED, undefined, () => (clock += 1000));
    await vault.create({ kind: "card", title: "Fresh thought", date: "2026-09-01" });
    const sidebar = await renderShell();
    fireEvent.click(within(sidebar).getByRole("button", { name: /Inbox/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Triage/ }));
    const triage = screen.getByRole("region", { name: "Triage" });
    // Newest first: the card just made, then the seeded one.
    expect(triage.textContent).toContain("Fresh thought");
    await act(async () => fireEvent.keyDown(window, { key: "d" }));
    expect((await vault.list()).some((n) => n.title === "Fresh thought")).toBe(false);
    expect(await within(triage).findByText("Think about it.")).toBeTruthy();
    // T tags it, with a new tag typed into the picker.
    await act(async () => fireEvent.keyDown(window, { key: "t" }));
    const tag = await screen.findByRole("textbox", { name: "Add tag" });
    fireEvent.change(tag, { target: { value: "someday" } });
    await act(async () => fireEvent.keyDown(tag, { key: "Enter" }));
    await expect.poll(async () => (await vault.read("inbox/idea.md")).meta.tags).toEqual(["someday"]);
    // P makes it a page, filed in Pages.
    await act(async () => fireEvent.keyDown(window, { key: "p" }));
    await expect.poll(async () => (await vault.list()).find((n) => n.title === "An idea")?.path).toBe("library/idea.md");
    expect((await vault.read("library/idea.md")).meta.kind).toBe("page");
    expect(await screen.findByText(/Inbox zero/)).toBeTruthy();
  });

  it("gathers to-dos from every page and ticks them in the file", async () => {
    const sidebar = await renderShell();
    fireEvent.click(within(sidebar).getByRole("button", { name: "Tasks" }));
    const box = await screen.findByRole("checkbox", { name: "Ship it" });
    expect(screen.queryByRole("checkbox", { name: "Plan it" })).toBeNull();
    await act(async () => fireEvent.click(box));
    expect((await vault.read("projects/demo/pages/roadmap.md")).text).toContain("- [x] Ship it\n- [x] Plan it\n");
  });

  it("keeps the page and its caret when the title renames it", async () => {
    const sidebar = await renderShell();
    fireEvent.click(await within(sidebar).findByText("Welcome"));
    const title = (await screen.findByRole("textbox", { name: "Page title" }, { timeout: 20_000 })) as HTMLTextAreaElement;
    const editor = await screen.findByTestId("page-editor", {}, { timeout: 20_000 });
    await expect.poll(() => editor.querySelector(".ProseMirror") !== null, { timeout: 20_000 }).toBe(true);
    const prose = editor.querySelector(".ProseMirror");
    fireEvent.change(title, { target: { value: "Start here" } });
    await act(async () => {
      fireEvent.blur(title);
      await flushOpenPage();
    });
    expect(useWorkspace.getState().place.path).toBe("library/start-here.md");
    expect((await vault.read("library/start-here.md")).text).toContain("title: Start here\n");
    // The same editor, not a new one: what was being typed stays.
    expect(screen.getByTestId("page-editor")).toBe(editor);
    expect(editor.querySelector(".ProseMirror")).toBe(prose);
  });

  it("renames a page from the sidebar and updates links to it", async () => {
    const sidebar = await renderShell();
    const projects = await within(sidebar).findByRole("region", { name: "Projects" });
    // Rows remember being open across the session, so it may be open already.
    const expand = within(projects).queryByRole("button", { name: "Expand Demo project" });
    if (expand) fireEvent.click(expand);
    fireEvent.click(within(projects).getByRole("button", { name: "More for Roadmap" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Rename/ }));
    const input = within(projects).getByRole("textbox", { name: "New title for Roadmap" });
    fireEvent.change(input, { target: { value: "Plan of record" } });
    await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
    expect((await vault.read("projects/demo/pages/plan-of-record.md")).text).toContain("title: Plan of record\n");
    expect((await vault.read("library/welcome.md")).text).toContain("Hello [[Plan of record]].");
    expect(await within(projects).findByText("Plan of record")).toBeTruthy();
  });

  it("renames the open page from the sidebar in the pane it is open in", async () => {
    const sidebar = await renderShell();
    // Welcome on the left, Roadmap focused on the right.
    await act(async () => useWorkspace.getState().openPath("library/welcome.md"));
    await act(async () => useWorkspace.getState().openPath("projects/demo/pages/roadmap.md", "split"));
    await expect.poll(() => screen.queryAllByRole("textbox", { name: "Page title" }).length, { timeout: 20_000 }).toBe(2);
    const projects = within(sidebar).getByRole("region", { name: "Projects" });
    const expand = within(projects).queryByRole("button", { name: "Expand Demo project" });
    if (expand) fireEvent.click(expand);
    fireEvent.click(within(projects).getByRole("button", { name: "More for Roadmap" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Rename/ }));
    const focused = document.activeElement as HTMLTextAreaElement;
    expect(focused.getAttribute("aria-label")).toBe("Page title");
    expect(focused.value).toBe("Roadmap");
  });

  it("hides the sidebar, and says the notes live in this browser", async () => {
    await renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));
    expect(screen.queryByRole("navigation", { name: "Sidebar" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show sidebar" }));
    expect(screen.getByRole("navigation", { name: "Sidebar" })).toBeTruthy();
    expect(screen.getByLabelText("Vault").textContent).toMatch(/Browser preview/);
  });

  it("resizes the sidebar from its edge, and remembers the width", async () => {
    const nav = await renderShell();
    const edge = within(nav).getByRole("separator", { name: "Resize the sidebar" });
    expect(nav.style.width).toBe("240px");
    fireEvent.keyDown(edge, { key: "End" });
    expect(nav.style.width).toBe("440px");
    expect(JSON.parse(localStorage.getItem("kasten.prefs")!).sidebarWidth).toBe(440);
    // Kept for the next start; a double-click goes back to the usual width.
    cleanup();
    const again = await renderShell();
    expect(again.style.width).toBe("440px");
    fireEvent.doubleClick(within(again).getByRole("separator", { name: "Resize the sidebar" }));
    expect(again.style.width).toBe("240px");
  });

  it("explains when no vault is open", async () => {
    render(<AppShell connect={async () => ({ client: null, problem: "No vault configured." })} />);
    expect(await screen.findByText("No vault configured.")).toBeTruthy();
  });

  it("goes from tab to tab with the arrow keys, Home and End", async () => {
    const sidebar = await renderShell();
    const pages = await within(sidebar).findByRole("region", { name: "Pages" });
    fireEvent.click(within(pages).getByRole("button", { name: "Welcome" }), { ctrlKey: true });
    const tabs = screen.getAllByRole("tablist", { name: "Tabs" })[0]!;
    const tab = (name: RegExp) => within(tabs).getByRole("tab", { name });
    expect(tab(/Welcome/).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab(/Welcome/), { key: "ArrowRight" });
    expect(tab(/Home/).getAttribute("aria-selected")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(tab(/Home/)));
    fireEvent.keyDown(tab(/Home/), { key: "End" });
    expect(tab(/Welcome/).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab(/Welcome/), { key: "ArrowLeft" });
    expect(tab(/Home/).getAttribute("aria-selected")).toBe("true");
  });

  it("opens pages in tabs, a split and the side stack", async () => {
    const sidebar = await renderShell();
    const pages = await within(sidebar).findByRole("region", { name: "Pages" });
    fireEvent.click(within(pages).getByRole("button", { name: "Welcome" }), { ctrlKey: true });
    const tabs = screen.getAllByRole("tablist", { name: "Tabs" })[0]!;
    expect(within(tabs).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Home", "👋Welcome"]);
    // Views wear the sidebar's line icons; pages keep their own emoji.
    expect(within(tabs).getAllByRole("tab")[0]!.querySelector(".kasten-tab-icon svg")).toBeTruthy();
    expect(within(tabs).getByRole("tab", { name: /Welcome/ }).getAttribute("aria-selected")).toBe("true");
    // Close it again with its ×, then reopen it with Ctrl+Shift+T.
    fireEvent.click(within(tabs).getByRole("button", { name: "Close Welcome" }));
    expect(within(tabs).getAllByRole("tab")).toHaveLength(1);
    fireEvent.keyDown(window, { key: "T", ctrlKey: true, shiftKey: true });
    expect(await within(tabs).findByRole("tab", { name: /Welcome/ })).toBeTruthy();
    // Ctrl+Alt+→ splits; a second pane appears with its own tabs.
    fireEvent.keyDown(window, { key: "ArrowRight", ctrlKey: true, altKey: true });
    expect(screen.getAllByRole("region", { name: "Pane" })).toHaveLength(2);
    // Shift+click opens a page in the side stack.
    fireEvent.click(within(pages).getByRole("button", { name: "Welcome" }), { shiftKey: true });
    const stack = await screen.findByRole("complementary", { name: "Side stack" });
    expect(within(stack).getByRole("article", { name: "Welcome" })).toBeTruthy();
    // Closing the last card closes the stack.
    fireEvent.click(within(stack).getByRole("button", { name: "Close card" }));
    expect(screen.queryByRole("complementary", { name: "Side stack" })).toBeNull();
  });

  it("folds a sidebar section away, and remembers it", async () => {
    const sidebar = await renderShell();
    const pages = within(sidebar).getByRole("region", { name: "Pages" });
    await within(pages).findByText("Welcome");
    const heading = within(pages).getByRole("button", { name: "Pages" });
    expect(heading.getAttribute("aria-expanded")).toBe("true");
    await act(async () => fireEvent.click(heading));
    expect(heading.getAttribute("aria-expanded")).toBe("false");
    expect(within(pages).queryByText("Welcome")).toBeNull();
    expect(JSON.parse(localStorage.getItem("kasten.prefs")!).foldedSections).toEqual(["Pages"]);
    await act(async () => fireEvent.click(heading));
    expect(within(pages).getByText("Welcome")).toBeTruthy();
  });
});


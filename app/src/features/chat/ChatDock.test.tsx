import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useShell } from "../../lib/store";
import { AppShell } from "../../shell/AppShell";
import { useOcclusion } from "../browser/occlusion";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { useWorkspace } from "../workspace/store";
import { derive } from "../workspace/store-layout";
import { activeTab, initialLayout } from "../workspace/tabs";
import { DOCK_WIDTH, WIDTH_KEY } from "./dock";
import { activePath } from "./open-pages";
import { useChat } from "./store";
import { resetChat, scriptedChat } from "./test-kit";

const SEED = {
  "library/plan.md": "---\ntitle: Plan\n---\nThe plan.\n",
  "library/notes.md": "---\ntitle: Notes\n---\nSome notes.\n",
  "library/ideas.md": "---\ntitle: Ideas\n---\nSome ideas.\n",
};

const width = (px: number) => {
  Object.defineProperty(window, "innerWidth", { value: px, configurable: true, writable: true });
  window.dispatchEvent(new Event("resize"));
};

function reset() {
  useWorkspace.setState({ ...derive(initialLayout()), notes: [], recent: [], stack: [], stackOpen: false });
  useShell.setState({ chatOpen: false });
}

/** The dock's width as its style says it. */
function px(dock: HTMLElement): string {
  return dock.style.getPropertyValue("--chat-dock-width") || /--chat-dock-width:\s*([\d.]+px)/.exec(dock.getAttribute("style") ?? "")?.[1] || "";
}

beforeEach(() => {
  localStorage.clear();
  width(1400);
  reset();
});
afterEach(() => {
  cleanup();
  width(1024);
});

/** Opens the shell with Plan in the first pane and Notes in a split to its right, Notes in focus. */
async function openTwoPages() {
  resetChat(scriptedChat());
  render(<AppShell connect={async () => ({ client: new MemoryVault(SEED) })} />);
  await screen.findByRole("navigation", { name: "Sidebar" });
  await act(async () => useWorkspace.getState().openPath("library/plan.md"));
  await act(async () => useWorkspace.getState().openPath("library/notes.md", "split"));
}

async function openDock() {
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Chat" })));
  // The dock's code loads on first use, slowly when the whole suite runs.
  const dock = await screen.findByRole("complementary", { name: "Chat dock" }, { timeout: 20_000 });
  const context = await within(dock).findByRole("group", { name: "Context" });
  return { dock, context };
}

/** Puts the pane showing `path` in focus, as clicking in it does. */
async function focusPage(path: string) {
  const { layout } = useWorkspace.getState();
  const pane = layout.panes.find((p) => activeTab(p).place.path === path)!;
  await act(async () => useWorkspace.getState().focusPane(pane.id));
}

const chips = (context: HTMLElement) => [...context.querySelectorAll(".kasten-chat-chip-label")].map((c) => c.textContent);

describe("the chat dock's page", () => {
  it("knows the page in the focused pane's active tab, not a peek or the side stack", async () => {
    await openTwoPages();
    expect(activePath()).toBe("library/notes.md");
    await focusPage("library/plan.md");
    expect(activePath()).toBe("library/plan.md");
    await act(async () => useWorkspace.getState().openInStack("library/ideas.md"));
    expect(activePath()).toBe("library/plan.md");
    await act(async () => useWorkspace.getState().go({ view: "trash" }, "here"));
    expect(activePath()).toBeNull();
  });

  it("starts a chat with the page in front alone, and sends just that", async () => {
    const chat = scriptedChat();
    resetChat(chat);
    render(<AppShell connect={async () => ({ client: new MemoryVault(SEED) })} />);
    await screen.findByRole("navigation", { name: "Sidebar" });
    await act(async () => useWorkspace.getState().openPath("library/plan.md"));
    await act(async () => useWorkspace.getState().openPath("library/notes.md", "split"));
    const { dock, context } = await openDock();
    await expect.poll(() => chips(context)).toEqual(["Notes"]);
    const box = within(dock).getByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "How does this fit?" } });
    await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
    // Only the page, and not the follow marker: that stays in the window.
    expect(chat.requests[0]!.context).toEqual([{ kind: "note", label: "Notes", ref: ["library/notes.md"] }]);
    await act(async () => fireEvent.click(within(dock).getByRole("button", { name: "Close the chat" })));
    expect(screen.queryByRole("complementary", { name: "Chat dock" })).toBeNull();
  });
});

describe("following the active page", () => {
  it("swaps the page chip when the page in front changes, and keeps pinned and added chips", async () => {
    await openTwoPages();
    const { context } = await openDock();
    await expect.poll(() => chips(context)).toEqual(["Notes"]);

    await focusPage("library/plan.md");
    await expect.poll(() => chips(context)).toEqual(["Plan"]);

    // Pin it: it stays while the page changes.
    await act(async () => fireEvent.click(within(context).getByRole("button", { name: "Pin Plan" })));
    expect(within(context).getByRole("button", { name: "Unpin Plan" }).getAttribute("aria-pressed")).toBe("true");
    await focusPage("library/notes.md");
    await expect.poll(() => chips(context)).toEqual(["Notes", "Plan"]);

    // A chip added from the menu stays too, and has nothing to pin.
    fireEvent.click(screen.getByRole("button", { name: "+ Context" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Every open page/ }));
    await expect.poll(() => chips(context)).toEqual(["Notes", "Plan", "2 open pages"]);
    expect(within(context).queryByRole("button", { name: /Pin 2 open pages/ })).toBeNull();
    // Plan is pinned already, so the page in front adds nothing of its own.
    await focusPage("library/plan.md");
    await expect.poll(() => chips(context)).toEqual(["Plan", "2 open pages"]);
    expect(within(context).getByRole("button", { name: "Unpin Plan" })).toBeTruthy();
  });

  it("stays on the page it names once Follow active page is off, and follows again when turned on", async () => {
    await openTwoPages();
    const { dock, context } = await openDock();
    await expect.poll(() => chips(context)).toEqual(["Notes"]);
    // The switch is in the box's bar, not among the chips.
    expect(within(context).queryByRole("switch")).toBeNull();
    const follow = within(dock).getByRole("switch", { name: "Follow active page" });
    expect(follow.closest(".kasten-chat-composer-bar")).toBeTruthy();
    expect(follow.getAttribute("aria-checked")).toBe("true");
    await act(async () => fireEvent.click(follow));
    expect(follow.getAttribute("aria-checked")).toBe("false");
    await focusPage("library/plan.md");
    await act(async () => new Promise((done) => setTimeout(done, 30)));
    expect(chips(context)).toEqual(["Notes"]);
    await act(async () => fireEvent.click(follow));
    await expect.poll(() => chips(context)).toEqual(["Plan"]);
  });

  it("leaves a removed page chip out until the page in front changes", async () => {
    await openTwoPages();
    const { context } = await openDock();
    await expect.poll(() => chips(context)).toEqual(["Notes"]);
    await act(async () => fireEvent.click(within(context).getByRole("button", { name: "Remove Notes" })));
    expect(chips(context)).toEqual([]);
    // Saving the page changes the notes list, not the page in front.
    await act(async () => useWorkspace.setState((s) => ({ notes: [...s.notes] })));
    await act(async () => new Promise((done) => setTimeout(done, 30)));
    expect(chips(context)).toEqual([]);
    await focusPage("library/plan.md");
    await expect.poll(() => chips(context)).toEqual(["Plan"]);
  });

  it("lists the pages of an 'open pages' chip so what will be sent is in view", async () => {
    await openTwoPages();
    const { context } = await openDock();
    fireEvent.click(screen.getByRole("button", { name: "+ Context" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Every open page/ }));
    await expect.poll(() => chips(context)).toContain("2 open pages");
    expect(screen.queryByRole("list", { name: "What 2 open pages holds" })).toBeNull();
    fireEvent.click(within(context).getByRole("button", { name: "What 2 open pages holds" }));
    const list = screen.getByRole("list", { name: "What 2 open pages holds" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Notes", "Plan"]);
    fireEvent.click(within(context).getByRole("button", { name: "What 2 open pages holds" }));
    expect(screen.queryByRole("list", { name: "What 2 open pages holds" })).toBeNull();
    // Asking about one page alone does not follow the page in front.
    const id = useChat.getState().active!;
    expect(useChat.getState().threads[id]!.context.find((c) => c.kind === "cards")!.ref).toEqual(["library/notes.md", "library/plan.md"]);
  });
});

describe("the dock's width", () => {
  it("is set from the keyboard, in steps, within 320 and 720, and remembered", async () => {
    await openTwoPages();
    const { dock } = await openDock();
    const handle = within(dock).getByRole("separator", { name: "Resize the chat" });
    expect(handle.getAttribute("aria-valuenow")).toBe("420");
    expect(handle.getAttribute("aria-valuemin")).toBe("320");
    expect(handle.getAttribute("aria-valuemax")).toBe("720");
    expect(px(dock)).toBe("420px");

    // The handle is on the dock's left edge: the left arrow widens it.
    await act(async () => fireEvent.keyDown(handle, { key: "ArrowLeft" }));
    expect(handle.getAttribute("aria-valuenow")).toBe("436");
    await act(async () => fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true }));
    expect(handle.getAttribute("aria-valuenow")).toBe("500");
    await act(async () => fireEvent.keyDown(handle, { key: "ArrowRight" }));
    expect(handle.getAttribute("aria-valuenow")).toBe("484");
    expect(px(dock)).toBe("484px");
    expect(localStorage.getItem(WIDTH_KEY)).toBe("484");

    await act(async () => fireEvent.keyDown(handle, { key: "End" }));
    expect(handle.getAttribute("aria-valuenow")).toBe(String(DOCK_WIDTH.max));
    await act(async () => fireEvent.keyDown(handle, { key: "Home" }));
    expect(handle.getAttribute("aria-valuenow")).toBe(String(DOCK_WIDTH.min));
    await act(async () => fireEvent.doubleClick(handle));
    expect(handle.getAttribute("aria-valuenow")).toBe("420");
    expect(localStorage.getItem(WIDTH_KEY)).toBe("420");
  });

  it("is the same after the dock is closed and opened, and after a restart", async () => {
    await openTwoPages();
    let { dock } = await openDock();
    await act(async () => fireEvent.keyDown(within(dock).getByRole("separator", { name: "Resize the chat" }), { key: "ArrowLeft", shiftKey: true }));
    expect(px(dock)).toBe("484px");
    await act(async () => fireEvent.click(within(dock).getByRole("button", { name: "Close the chat" })));
    ({ dock } = await openDock());
    expect(px(dock)).toBe("484px");
    cleanup();
    reset();
    // A new window reads it from storage.
    await openTwoPages();
    ({ dock } = await openDock());
    expect(px(dock)).toBe("484px");
  });

  it("never passes what the window leaves the panes", async () => {
    width(1000);
    await openTwoPages();
    const { dock } = await openDock();
    const handle = within(dock).getByRole("separator", { name: "Resize the chat" });
    expect(handle.getAttribute("aria-valuemax")).toBe("520");
    await act(async () => fireEvent.keyDown(handle, { key: "End" }));
    expect(handle.getAttribute("aria-valuenow")).toBe("520");
    expect(dock.dataset.layout).toBe("docked");
  });
});

describe("a window too narrow for both", () => {
  it("gives the dock the whole area, hides the panes, and has a way to look at the page", async () => {
    width(760);
    await openTwoPages();
    const { dock } = await openDock();
    const area = dock.parentElement!;
    expect(dock.dataset.layout).toBe("expanded");
    expect(area.classList.contains("kasten-chat-expanded")).toBe(true);
    expect(within(dock).queryByRole("separator", { name: "Resize the chat" })).toBeNull();
    // Native web views are told something covers them while the panes are hidden.
    const holding = Object.keys(useOcclusion.getState().holds).length;
    expect(holding).toBeGreaterThan(0);

    await act(async () => fireEvent.click(within(dock).getByRole("button", { name: "Show page" })));
    expect(dock.dataset.layout).toBe("collapsed");
    expect(area.classList.contains("kasten-chat-expanded")).toBe(false);
    await act(async () => fireEvent.click(within(dock).getByRole("button", { name: "Show chat" })));
    expect(dock.dataset.layout).toBe("expanded");
    expect(area.classList.contains("kasten-chat-expanded")).toBe(true);

    // Widen the window: back beside the panes, nothing hidden.
    await act(async () => width(1400));
    expect(dock.dataset.layout).toBe("docked");
    expect(area.classList.contains("kasten-chat-expanded")).toBe(false);
    expect(within(dock).getByRole("separator", { name: "Resize the chat" })).toBeTruthy();
    // Let go a moment later, once the panes have been laid out again.
    await act(async () => new Promise((done) => setTimeout(done, 80)));
    expect(Object.keys(useOcclusion.getState().holds).length).toBeLessThan(holding);
  });
});

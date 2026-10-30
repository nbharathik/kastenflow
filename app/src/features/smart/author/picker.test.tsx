// The list of starters, and "Edit code" in a smart page's header.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeBackend } from "../test-support/fake-frame";
import { FakeObserver } from "../test-support/observer";
import { SmartPage } from "../SmartPage";
import { chooseStarter } from "./starter-picker";
import { FakeAuthor } from "./test-support/fake-author";

const flows = vi.hoisted(() => ({ newSmartPage: vi.fn(async () => null), turnIntoSmartPage: vi.fn(async () => true) }));
vi.mock("./flows", () => flows);

const closers: (() => void)[] = [];
const open = (options: Parameters<typeof chooseStarter>[0]) => {
  const close = chooseStarter(options);
  closers.push(close);
  return close;
};

beforeEach(() => {
  FakeObserver.reset();
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});
afterEach(async () => {
  cleanup();
  closers.splice(0).forEach((close) => close());
  // Let the lists the tests left open unmount themselves before the next test.
  await new Promise((resolve) => setTimeout(resolve, 5));
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("the list of starters", () => {
  it("lists the starters, then the person's own, with the first ready to take", async () => {
    open({ backend: new FakeAuthor() });
    const list = await screen.findByRole("list", { name: "New smart page" });
    const rows = Array.from(list.querySelectorAll("button"));
    expect(rows.map((r) => r.textContent)).toEqual(["DashboardCounts and a table", "TrackerA table to tick off", "ReadingYour own template"]);
    expect(document.activeElement).toBe(rows[0]);
  });

  it("makes the page from the starter that is clicked, and closes", async () => {
    open({ backend: new FakeAuthor() });
    fireEvent.click(await screen.findByRole("button", { name: /Tracker/ }));
    expect(flows.newSmartPage).toHaveBeenCalledWith("tracker", expect.anything());
    await waitFor(() => expect(screen.queryByRole("list", { name: "New smart page" })).toBeNull());
  });

  it("walks the list with the arrow keys and takes a template of the person's own", async () => {
    open({ backend: new FakeAuthor() });
    const list = await screen.findByRole("list", { name: "New smart page" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toContain("Reading");
    fireEvent.click(document.activeElement!);
    expect(flows.newSmartPage).toHaveBeenCalledWith("mine:reading", expect.anything());
    expect(list).toBeTruthy();
  });

  it("turns a page into a smart page when asked to, and tells its owner", async () => {
    const onDone = vi.fn();
    open({ turnInto: "library/a.md", onDone, backend: new FakeAuthor() });
    fireEvent.click(await screen.findByRole("button", { name: /Dashboard/ }));
    expect(flows.turnIntoSmartPage).toHaveBeenCalledWith("library/a.md", "dashboard", expect.anything());
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(screen.queryByRole("list", { name: "Turn into smart page" })).toBeNull();
  });

  it("says why it could not list, with Try again", async () => {
    const author = new FakeAuthor();
    author.starters = async () => {
      throw new Error("The app did not answer.");
    };
    open({ backend: author });
    expect((await screen.findByRole("alert")).textContent).toContain("The app did not answer.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("closes with Escape", async () => {
    open({ backend: new FakeAuthor() });
    await screen.findByRole("list", { name: "New smart page" });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("list", { name: "New smart page" })).toBeNull());
  });
});

describe("Edit code in a smart page", () => {
  const mount = (side: "smart" | "code", onSide = vi.fn()) => ({ onSide, ...render(<SmartPage pagePath="library/t.md" pageId="01T" title="T" side={side} onSide={onSide} backend={new FakeBackend()} author={new FakeAuthor()} />) });

  it("is a button next to Reload, outside the Smart · Notes · History switch", () => {
    const { onSide } = mount("smart");
    const group = screen.getByRole("group", { name: "Smart page" });
    expect(group.querySelectorAll("button")).toHaveLength(3);
    const edit = screen.getByRole("button", { name: "Edit code" });
    expect(group.contains(edit)).toBe(false);
    expect(edit.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(edit);
    expect(onSide).toHaveBeenCalledWith("code");
  });

  it("opens the editor on the code side and goes back from the same button", async () => {
    const { onSide } = mount("code");
    expect(screen.getByRole("button", { name: "Edit code" }).getAttribute("aria-pressed")).toBe("true");
    expect(await screen.findByRole("navigation", { name: "Files of this page" }, { timeout: 8000 })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit code" }));
    expect(onSide).toHaveBeenCalledWith("smart");
  });

  it("offers a starter on a smart page that has no view yet", async () => {
    const backend = new FakeBackend();
    backend.pageInfo = { ready: false };
    render(<SmartPage pagePath="library/t.md" pageId="01T" title="T" side="smart" onSide={vi.fn()} backend={backend} author={new FakeAuthor()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Start from a starter" }));
    expect(await screen.findByRole("list", { name: "Turn into smart page" })).toBeTruthy();
  });
});

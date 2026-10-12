import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dayFrom } from "../lib/dates";
import { MemoryVault } from "../features/workspace/preview/memory-vault";
import { CaptureBox, type CaptureHost } from "./CaptureBox";

let vault: MemoryVault;
let hide: ReturnType<typeof vi.fn<() => void>>;
let done: ReturnType<typeof vi.fn<CaptureHost["done"]>>;
let resize: ReturnType<typeof vi.fn<(height: number) => void>>;
let host: CaptureHost;

beforeEach(() => {
  localStorage.clear();
  vault = new MemoryVault({
    "projects/trip/trip.md": "---\ntitle: Trip\ntype: project\n---\n",
    "templates/journal.md": '---\ntitle: "{{date}}"\ntype: journal\n---\n',
    "library/reading.md": "---\ntitle: Reading list\n---\nBooks.\n",
    "library/xylophone.md": "---\ntitle: Xylophone lessons\n---\nScales.\n",
    "library/recipes.md": "---\ntitle: Recipes\n---\nSoup.\n",
  });
  hide = vi.fn<() => void>();
  done = vi.fn<CaptureHost["done"]>();
  resize = vi.fn<(height: number) => void>();
  host = { client: vault, hide, done, resize, onOpen: () => () => {} };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const box = () => screen.getByRole("textbox", { name: "Quick capture" });
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });
const press = (key: string, extra: Record<string, boolean> = {}) => act(async () => void fireEvent.keyDown(box(), { key, ...extra }));
const picker = () => screen.getByRole("combobox", { name: "Find a place" });
const options = () => screen.getAllByRole("option").map((o) => o.textContent);
const openPicker = async () => {
  await press("k", { ctrlKey: true });
  return picker();
};
/** The notes list reads in a moment after the window opens. */
const ready = () => waitFor(async () => expect((await vault.list()).length).toBeGreaterThan(3));

describe("the quick capture box", () => {
  it("saves to the inbox with Enter and tells the main window", async () => {
    render(<CaptureBox host={host} />);
    type("Call the plumber\nabout the sink");
    await press("Enter");
    await waitFor(() => expect(done).toHaveBeenCalled());
    const captured = done.mock.calls[0]![0];
    expect(captured.place).toBe("Inbox");
    expect((await vault.read(captured.path)).text).toContain("about the sink");
    expect((box() as HTMLTextAreaElement).value).toBe("");
  });

  it("goes to today's journal after one Tab", async () => {
    render(<CaptureBox host={host} />);
    type("Felt good about the plan");
    await press("Tab");
    expect(screen.getByRole("button", { name: /Save to Today's journal/ })).toBeTruthy();
    await press("Enter");
    await waitFor(() => expect(done).toHaveBeenCalled());
    const day = await vault.journal(dayFrom(0));
    expect(day.text).toContain("Felt good about the plan");
  });

  it("hides with Esc and keeps the draft for next time", async () => {
    const first = render(<CaptureBox host={host} />);
    type("Half a thought");
    await press("Escape");
    expect(hide).toHaveBeenCalled();
    first.unmount();
    render(<CaptureBox host={host} />);
    expect((box() as HTMLTextAreaElement).value).toBe("Half a thought");
  });

  it("keeps Shift+Enter for a new line", async () => {
    render(<CaptureBox host={host} />);
    type("Line one");
    await press("Enter", { shiftKey: true });
    expect(done).not.toHaveBeenCalled();
  });
});

describe("the place picker", () => {
  it("opens on Ctrl+K or a click on the place, gives the window room, and shows the places", async () => {
    render(<CaptureBox host={host} />);
    await ready();
    await openPicker();
    expect(screen.getByRole("dialog", { name: "Where to save" })).toBeTruthy();
    expect(document.activeElement).toBe(picker());
    expect(resize).toHaveBeenLastCalledWith(420);
    // Nothing typed: the places, the chosen one marked.
    expect(options()).toEqual(["InboxChosen", "Today's journal", "TripProject"]);
    fireEvent.keyDown(picker(), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Where to save" })).toBeNull();
    expect(resize).toHaveBeenLastCalledWith(200);
    fireEvent.click(screen.getByRole("button", { name: /Save to Inbox/ }));
    expect(screen.getByRole("dialog", { name: "Where to save" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Save to Inbox/ }));
    expect(screen.queryByRole("dialog", { name: "Where to save" })).toBeNull();
  });

  it("closes with Esc without hiding the window, which hides on the next one", async () => {
    render(<CaptureBox host={host} />);
    await openPicker();
    fireEvent.keyDown(picker(), { key: "Escape" });
    expect(hide).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(box());
    await press("Escape");
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it("reaches any page in three keystrokes: Ctrl+K, a letter, Enter", async () => {
    render(<CaptureBox host={host} />);
    await ready();
    await openPicker();
    fireEvent.change(picker(), { target: { value: "x" } });
    // The page that starts with the letter comes before the Inbox, which only holds it.
    expect(options()).toEqual(["Xylophone lessonsPage", "InboxChosen"]);
    fireEvent.keyDown(picker(), { key: "Enter" });
    expect(screen.getByRole("button", { name: /Save to Xylophone lessons/ })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Where to save" })).toBeNull();
    expect(document.activeElement).toBe(box());
    expect(resize).toHaveBeenLastCalledWith(200);
  });

  it("narrows places and pages as you type, and says when none fits", async () => {
    render(<CaptureBox host={host} />);
    await ready();
    await openPicker();
    fireEvent.change(picker(), { target: { value: "r" } });
    // What starts with it first (Reading list and Recipes, the latest changed first), then the places that only hold it.
    const names = options().map((o) => o!.replace(/(Project|Page)$/, ""));
    expect(names.slice(0, 2).sort()).toEqual(["Reading list", "Recipes"]);
    expect(names.slice(2)).toEqual(["Today's journal", "Trip"]);
    fireEvent.change(picker(), { target: { value: "zzz" } });
    expect(screen.getByText("No place or page called that")).toBeTruthy();
    fireEvent.keyDown(picker(), { key: "Enter" });
    expect(screen.getByRole("dialog", { name: "Where to save" })).toBeTruthy();
  });

  it("moves with Tab, Shift+Tab, the arrow keys and the wheel, and Enter chooses", async () => {
    render(<CaptureBox host={host} />);
    await openPicker();
    const active = () => screen.getAllByRole("option").find((o) => o.getAttribute("aria-selected") === "true")!.textContent;
    expect(active()).toBe("InboxChosen");
    fireEvent.keyDown(picker(), { key: "Tab" });
    expect(active()).toBe("Today's journal");
    fireEvent.keyDown(picker(), { key: "ArrowDown" });
    expect(active()).toBe("TripProject");
    fireEvent.keyDown(picker(), { key: "ArrowDown" });
    expect(active()).toBe("InboxChosen");
    fireEvent.keyDown(picker(), { key: "Tab", shiftKey: true });
    expect(active()).toBe("TripProject");
    fireEvent.keyDown(picker(), { key: "ArrowUp" });
    expect(active()).toBe("Today's journal");
    fireEvent.wheel(screen.getByRole("dialog", { name: "Where to save" }), { deltaY: 100 });
    expect(active()).toBe("TripProject");
    await new Promise((resolve) => setTimeout(resolve, 120));
    fireEvent.wheel(screen.getByRole("dialog", { name: "Where to save" }), { deltaY: -100 });
    expect(active()).toBe("Today's journal");
    fireEvent.keyDown(picker(), { key: "Enter" });
    expect(screen.getByRole("button", { name: /Save to Today's journal/ })).toBeTruthy();
  });

  it("picks with a click", async () => {
    render(<CaptureBox host={host} />);
    await openPicker();
    fireEvent.click(within(screen.getByRole("listbox", { name: "Places" })).getByText("Trip"));
    expect(screen.getByRole("button", { name: /Save to Trip/ })).toBeTruthy();
  });

  it("turns the wheel over the place button through the places", async () => {
    render(<CaptureBox host={host} />);
    fireEvent.wheel(screen.getByRole("button", { name: /Save to Inbox/ }), { deltaY: 100 });
    expect(screen.getByRole("button", { name: /Save to Today's journal/ })).toBeTruthy();
  });

  it("closes when the window opens again", async () => {
    let reopen = () => {};
    host.onOpen = (then) => {
      reopen = then;
      return () => {};
    };
    render(<CaptureBox host={host} />);
    await openPicker();
    act(() => reopen());
    expect(screen.queryByRole("dialog", { name: "Where to save" })).toBeNull();
  });
});

describe("saving to a page", () => {
  it("adds the text to the page, remembers it, and lists it first next time", async () => {
    render(<CaptureBox host={host} />);
    await ready();
    await openPicker();
    fireEvent.change(picker(), { target: { value: "reading" } });
    fireEvent.keyDown(picker(), { key: "Enter" });
    type("Finish the novel");
    await press("Enter");
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(done.mock.calls[0]![0]).toMatchObject({ path: "library/reading.md", title: "Reading list", place: "Reading list" });
    expect((await vault.read("library/reading.md")).text).toContain("Finish the novel");
    expect(JSON.parse(localStorage.getItem("kasten.capture.recent")!)).toEqual([{ kind: "page", path: "library/reading.md", title: "Reading list" }]);
    // The window comes back: recent places lead, the Inbox still one Tab away.
    cleanup();
    render(<CaptureBox host={host} />);
    await ready();
    await openPicker();
    expect(options()[0]).toBe("Reading listPage");
    expect(options()).toContain("InboxChosen");
  });

  it("goes through Tab in the same order as the picker, recent places first", async () => {
    localStorage.setItem("kasten.capture.recent", JSON.stringify([{ kind: "page", path: "library/recipes.md", title: "Recipes" }]));
    render(<CaptureBox host={host} />);
    await ready();
    // Order: Recipes, Inbox, Today's journal, Trip. From the Inbox, Shift+Tab goes back to the recent page.
    await press("Tab", { shiftKey: true });
    expect(screen.getByRole("button", { name: /Save to Recipes/ })).toBeTruthy();
  });

  it("keeps the recent places to the ones that exist", async () => {
    localStorage.setItem("kasten.capture.recent", JSON.stringify([{ kind: "page", path: "library/deleted.md", title: "Deleted page" }]));
    render(<CaptureBox host={host} />);
    await ready();
    await openPicker();
    await waitFor(() => expect(options()).not.toContain("Deleted pagePage"));
    expect(options()[0]).toBe("InboxChosen");
  });
});

describe("a pasted web address", () => {
  const address = "https://example.com/slip-box";

  it("is clipped to the inbox, and its card is what is captured", async () => {
    const clipped = await vault.create({ kind: "card", title: "Slip-box basics", date: "2026-09-25" });
    const clip = vi.spyOn(vault, "clipUrl").mockResolvedValue(clipped);
    const capture = vi.spyOn(vault, "capture");
    render(<CaptureBox host={host} />);
    type(address);
    await press("Enter");
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(clip).toHaveBeenCalledWith(address);
    expect(capture).not.toHaveBeenCalled();
    expect(done.mock.calls[0]![0]).toEqual({ path: clipped.meta.path, title: "Slip-box basics", place: "Inbox" });
  });

  it("is kept as a plain capture in the inbox when the page will not come", async () => {
    vi.spyOn(vault, "clipUrl").mockRejectedValue(new Error("404 Not Found"));
    render(<CaptureBox host={host} />);
    type("www.example.com/gone");
    await press("Enter");
    await waitFor(() => expect(done).toHaveBeenCalled());
    const { path, place } = done.mock.calls[0]!.at(0) as { path: string; place: string };
    expect(place).toBe("Inbox");
    expect((await vault.read(path)).text).toContain("www.example.com/gone");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("is left as written inside a thought, which is no address", async () => {
    const clip = vi.spyOn(vault, "clipUrl");
    render(<CaptureBox host={host} />);
    type(`Read ${address} later`);
    await press("Enter");
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(clip).not.toHaveBeenCalled();
  });

  it("goes to a page as a link with the site's name, when the title can't be read", async () => {
    const clip = vi.spyOn(vault, "clipUrl");
    render(<CaptureBox host={host} />);
    await ready();
    await openPicker();
    fireEvent.change(picker(), { target: { value: "reading" } });
    fireEvent.keyDown(picker(), { key: "Enter" });
    type("https://www.example.com/slip-box");
    await press("Enter");
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(clip).not.toHaveBeenCalled();
    expect((await vault.read("library/reading.md")).text).toContain("[example.com](https://www.example.com/slip-box)");
  });

  it("goes to today's journal as a link too, and a bare www. address gets its scheme", async () => {
    render(<CaptureBox host={host} />);
    type("www.example.org/guide");
    await press("Tab");
    await press("Enter");
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect((await vault.journal(dayFrom(0))).text).toContain("[example.org](https://www.example.org/guide)");
  });

  it("stays a plain capture in a project, which a clip cannot go to", async () => {
    const clip = vi.spyOn(vault, "clipUrl");
    render(<CaptureBox host={host} />);
    await ready();
    await openPicker();
    fireEvent.change(picker(), { target: { value: "trip" } });
    fireEvent.keyDown(picker(), { key: "Enter" });
    type(address);
    await press("Enter");
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(clip).not.toHaveBeenCalled();
    expect(done.mock.calls[0]![0].place).toBe("Trip");
  });
});

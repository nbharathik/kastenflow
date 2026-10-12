// Settings as a window of two panes: the groups and a search on the left,
// one group at a time (or what a search found) on the right.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { chooseZoom } from "../../../../lib/zoom";
import { resetChat, scriptedChat } from "../../../chat/test-kit";
import { COMMANDS } from "../../overlays/commands";
import { usePrefs } from "../../prefs";
import { GROUPS, HEADINGS } from "./index";
import { openSettingsAt, useSettingsJump } from "./jump";
import { Settings } from "./Settings";

beforeEach(() => {
  localStorage.clear();
  useSettingsJump.setState({ target: null });
  resetChat(scriptedChat([]));
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  usePrefs.getState().setTheme("system");
  usePrefs.getState().set({ accent: "blue", motion: "system", textSize: "normal" });
  await chooseZoom("auto");
  localStorage.clear();
});

const nav = () => screen.getByRole("navigation", { name: "Settings sections" });
const item = (name: string | RegExp) => within(nav()).getByRole("button", { name });
/** What the list shows: its headings and groups, with any counts. */
const listed = () => [...nav().querySelectorAll("[data-nav]")].map((b) => b.textContent);
const search = () => screen.getByRole("searchbox", { name: "Search settings" }) as HTMLInputElement;
const title = () => screen.getByRole("heading", { level: 1 }).textContent;
const type = (text: string) => fireEvent.change(search(), { target: { value: text } });
const header = () => document.querySelector<HTMLElement>(".kasten-set-head")!;

describe("the two panes", () => {
  it("lists the groups under four headings, and opens the first", () => {
    render(<Settings />);
    expect(listed()).toEqual(HEADINGS.flatMap((heading) => [heading, ...GROUPS.filter((g) => g.heading === heading).map((g) => g.title)]));
    expect(item("Appearance").getAttribute("aria-current")).toBe("page");
    expect(nav().querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(title()).toBe("Appearance");
    expect(screen.getByText("Theme, accent colour and sizes")).toBeTruthy();
  });

  it("shows one group at a time, not a page of everything", () => {
    render(<Settings />);
    expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeTruthy();
    expect(screen.queryByRole("radiogroup", { name: "Font" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Full width" })).toBeNull();
    fireEvent.click(item("Pages"));
    expect(title()).toBe("Pages");
    expect(screen.getByRole("radiogroup", { name: "Font" })).toBeTruthy();
    expect(screen.queryByRole("radiogroup", { name: "Theme" })).toBeNull();
    expect(item("Pages").getAttribute("aria-current")).toBe("page");
    expect(item("Appearance").getAttribute("aria-current")).toBeNull();
  });

  it("remembers the group it was left on", () => {
    const first = render(<Settings />);
    fireEvent.click(item("Pages"));
    first.unmount();
    render(<Settings />);
    expect(title()).toBe("Pages");
  });

  it("gives each group a header with its icon, a one-line blurb and, for some, a ? with more", () => {
    render(<Settings />);
    fireEvent.click(item("AI providers"));
    expect(within(header()).getByText("What chat and AI writing talk to")).toBeTruthy();
    expect(header().querySelector("svg")).toBeTruthy();
    expect(header().textContent).not.toContain("system keychain");
    fireEvent.click(within(header()).getByRole("button", { name: "About AI providers" }));
    expect(within(header()).getByRole("status").textContent).toContain("Keys are kept in your system keychain");
  });

  it("folds a heading away, and brings it back, keeping the choice", () => {
    const first = render(<Settings />);
    const general = item("General");
    expect(general.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(general);
    expect(general.getAttribute("aria-expanded")).toBe("false");
    expect(within(nav()).queryByRole("button", { name: "Pages" })).toBeNull();
    expect(item("Calendar")).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("kasten.settings")!).folded).toEqual(["General"]);
    first.unmount();
    render(<Settings />);
    expect(within(nav()).queryByRole("button", { name: "Pages" })).toBeNull();
    // Right opens it again, Left folds it.
    fireEvent.keyDown(item("General"), { key: "ArrowRight" });
    expect(item("Pages")).toBeTruthy();
    fireEvent.keyDown(item("General"), { key: "ArrowLeft" });
    expect(within(nav()).queryByRole("button", { name: "Pages" })).toBeNull();
  });
});

describe("the keyboard", () => {
  it("moves between the groups with the arrows, Home and End, one stop for Tab", () => {
    render(<Settings />);
    expect(item("Appearance").tabIndex).toBe(0);
    expect(item("Pages").tabIndex).toBe(-1);
    item("Appearance").focus();
    fireEvent.keyDown(item("Appearance"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(item("Pages"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(item("General"));
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(item("About"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(item("About"));
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(item("General"));
  });

  it("opens the focused group on Enter, which a button takes as a click", () => {
    render(<Settings />);
    item("Appearance").focus();
    fireEvent.keyDown(item("Appearance"), { key: "ArrowDown" });
    fireEvent.click(document.activeElement!);
    expect(title()).toBe("Pages");
  });

  it("goes to the search with / and with Ctrl+F, but types a / in it", () => {
    render(<Settings />);
    item("Appearance").focus();
    expect(fireEvent.keyDown(item("Appearance"), { key: "/" })).toBe(false);
    expect(document.activeElement).toBe(search());
    expect(fireEvent.keyDown(search(), { key: "/" })).toBe(true);

    item("Pages").focus();
    expect(fireEvent.keyDown(item("Pages"), { key: "f", ctrlKey: true })).toBe(false);
    expect(document.activeElement).toBe(search());
  });

  it("takes Down from the search to the list", () => {
    render(<Settings />);
    search().focus();
    fireEvent.keyDown(search(), { key: "ArrowDown" });
    expect(document.activeElement).toBe(item("Appearance"));
  });
});

describe("searching", () => {
  it("finds a setting by a keyword, and lists only the groups that have one, with how many", () => {
    render(<Settings />);
    type("zoom");
    expect(title()).toBe("Search results");
    expect(screen.getByText("1 setting in 1 group")).toBeTruthy();
    expect(listed()).toEqual(["General", "Appearance1"]);
    // The row is drawn as it is on its page, and no other row is.
    expect(screen.getByRole("radiogroup", { name: "Interface size" })).toBeTruthy();
    expect(screen.queryByRole("radiogroup", { name: "Theme" })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Text size" })).toBeNull();
    // Its group is the breadcrumb, and the word found is marked.
    expect(screen.getByRole("heading", { level: 2, name: "Appearance" })).toBeTruthy();
    expect(screen.getByText("zoom", { selector: "mark" })).toBeTruthy();
  });

  it("marks the words found in a setting's name and in its explanation", () => {
    render(<Settings />);
    type("interface size");
    const row = document.getElementById("setting-appearance-zoom")!;
    expect([...row.querySelectorAll("mark")].map((m) => m.textContent?.toLowerCase())).toEqual(expect.arrayContaining(["interface", "size"]));
    expect(row.querySelector(".kasten-set-name")!.textContent).toBe("Interface size");
  });

  it("searches every group at once for a word they share", () => {
    render(<Settings />);
    type("calendar");
    const groups = listed();
    expect(groups).toContain("Calendar7");
    expect(groups.some((g) => g?.startsWith("Pages"))).toBe(true);
    expect(within(nav()).queryByRole("button", { name: /^Sidebar/ })).toBeNull();
    // The Calendar group is drawn with its own settings.
    expect(screen.getByRole("heading", { level: 2, name: "Calendar" })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Weeks start on" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Journal" })).toBeTruthy();
    // And the word is marked wherever it is said.
    expect(screen.getAllByText("calendar", { selector: "mark" }).length).toBeGreaterThan(0);
  });

  it("shows a setting too big to draw as a line that opens its group at it", () => {
    render(<Settings />);
    type("key");
    expect(listed()).toEqual(expect.arrayContaining(["Keyboard shortcuts2", expect.stringMatching(/^AI providers\d$/)]));
    fireEvent.click(screen.getByRole("button", { name: "Open Change a command's keys in Keyboard shortcuts" }));
    expect(search().value).toBe("");
    expect(title()).toBe("Keyboard shortcuts");
    expect(document.getElementById("setting-shortcuts-editor")!.classList.contains("is-flash")).toBe(true);
    expect(screen.getByRole("searchbox", { name: "Find a command" })).toBeTruthy();
  });

  it("says when nothing matches, and Clear brings the group back", () => {
    render(<Settings />);
    type("zzzz");
    expect(screen.getByText("No settings match “zzzz”")).toBeTruthy();
    expect(screen.getByText("Nothing found")).toBeTruthy();
    expect(listed()).toEqual([]);
    fireEvent.click(within(document.querySelector<HTMLElement>(".kasten-set-empty")!).getByRole("button", { name: "Clear search" }));
    expect(search().value).toBe("");
    expect(title()).toBe("Appearance");
  });

  it("is emptied by Escape, in the box and outside it", () => {
    render(<Settings />);
    type("zoom");
    fireEvent.keyDown(search(), { key: "Escape" });
    expect(search().value).toBe("");
    expect(title()).toBe("Appearance");

    type("zoom");
    const row = document.getElementById("setting-appearance-zoom")!;
    fireEvent.keyDown(row.querySelector("button")!, { key: "Escape" });
    expect(search().value).toBe("");
  });

  it("takes a group in the list as a place to scroll to in the results", () => {
    render(<Settings />);
    type("calendar");
    const results = document.getElementById("settings-results-pages")!;
    const scroll = vi.spyOn(results, "scrollIntoView");
    fireEvent.click(item(/^Pages/));
    expect(scroll).toHaveBeenCalledWith({ block: "start" });
    expect(title()).toBe("Search results");
  });

  it("leaves search results as they were when the search is cleared", () => {
    render(<Settings />);
    fireEvent.click(item("Pages"));
    type("zoom");
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(title()).toBe("Pages");
  });
});

describe("opening Settings at a place", () => {
  it("goes to a group, and marks a row of it for a moment", async () => {
    render(<Settings />);
    act(() => openSettingsAt({ group: "browser", row: "browser.webLinks" }));
    await waitFor(() => expect(title()).toBe("Browser"));
    expect(document.getElementById("setting-browser-webLinks")!.classList.contains("is-flash")).toBe(true);
    expect(useSettingsJump.getState().target).toBeNull();
  });

  it("takes a group's old name, and one that was asked for before it was drawn", () => {
    openSettingsAt("History and backup");
    render(<Settings />);
    expect(title()).toBe("History and backup");
    expect(item("History and backup").getAttribute("aria-current")).toBe("page");
    act(() => openSettingsAt("settings/ai/ai.providers"));
    expect(title()).toBe("AI providers");
  });

  it("ends a search it was asked to leave, or starts the one it was asked for", () => {
    render(<Settings />);
    type("zoom");
    act(() => openSettingsAt({ group: "pages" }));
    expect(search().value).toBe("");
    expect(title()).toBe("Pages");
    act(() => openSettingsAt({ search: "calendar" }));
    expect(search().value).toBe("calendar");
    expect(title()).toBe("Search results");
  });

  it("puts the cursor in the search when the palette's Settings is run", async () => {
    render(<Settings />);
    fireEvent.click(item("Pages"));
    act(() => COMMANDS.find((c) => c.id === "settings")!.run());
    await waitFor(() => expect(document.activeElement).toBe(search()));
    // The group it was on stays.
    expect(title()).toBe("Pages");
  });
});

describe("a narrow window", () => {
  it("swaps the list for a drop-down of the groups", async () => {
    class Narrow {
      watch: ResizeObserverCallback;
      constructor(watch: ResizeObserverCallback) {
        this.watch = watch;
      }
      observe() {
        this.watch([{ contentRect: { width: 480 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", Narrow);
    const { container } = render(<Settings />);
    expect(container.querySelector(".kasten-settings")!.classList.contains("is-narrow")).toBe(true);
    const select = (await screen.findByRole("combobox", { name: "Settings group" })) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(GROUPS.map((g) => g.title));
    expect(select.value).toBe("appearance");
    fireEvent.change(select, { target: { value: "calendar" } });
    expect(title()).toBe("Calendar");
    // The search is still there, and the drop-down lists what it found.
    type("zoom");
    expect([...(screen.getByRole("combobox", { name: "Settings group" }) as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(["Appearance (1)"]);
  });
});

describe("reset all appearance", () => {
  it("is off while nothing is changed, and puts theme, accent, motion and sizes back", async () => {
    render(<Settings />);
    const reset = screen.getByRole("button", { name: "Reset all appearance" }) as HTMLButtonElement;
    expect(reset.disabled).toBe(true);
    act(() => {
      usePrefs.getState().setTheme("dark");
      usePrefs.getState().set({ accent: "pink", motion: "off", textSize: "xl" });
    });
    await act(async () => void (await chooseZoom(1.25)));
    await waitFor(() => expect(reset.disabled).toBe(false));
    await act(async () => fireEvent.click(reset));
    expect(usePrefs.getState()).toMatchObject({ theme: "system", accent: "blue", motion: "system", textSize: "normal" });
    await waitFor(() => expect(reset.disabled).toBe(true));
  });
});

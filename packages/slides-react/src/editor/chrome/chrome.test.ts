import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EditorUi } from "../ui-state.ts";
import { Chrome, PANEL_WIDTH, chromeOf, clampPanelWidth } from "./chrome.ts";
import { chooseHidden } from "./overflow.ts";
import { RECENT_COLOURS_MAX, noteColour, noteFont, pushRecent, recentColours, recentFonts } from "./recents.ts";
import { keyStep, scrubbed } from "./scrub.ts";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("which groups of the toolbar go into the more menu", () => {
  const slots = [
    { id: "history", width: 100, drop: 0 },
    { id: "insert", width: 200, drop: 1 },
    { id: "text", width: 300, drop: 3 },
    { id: "paragraph", width: 200, drop: 2 },
    { id: "slide", width: 150, drop: 4 },
  ];

  it("keeps everything when it fits", () => {
    expect(chooseHidden(slots, 950, 40).size).toBe(0);
  });

  it("does not leave room for the menu's own button when nothing goes", () => {
    expect(chooseHidden(slots, 950, 100).size).toBe(0);
  });

  it("sends the groups that matter least first, until the rest and the button fit", () => {
    // 950 needed, 800 of room, 40 of it for the button: the slide group (150) goes first, which still leaves 800 + 40 too much, so the text group follows.
    expect([...chooseHidden(slots, 800, 40)].sort()).toEqual(["slide", "text"]);
    expect([...chooseHidden(slots, 900, 40)].sort()).toEqual(["slide"]);
  });

  it("never moves a group that stays, however narrow the row", () => {
    const hidden = chooseHidden(slots, 50, 40);
    expect(hidden.has("history")).toBe(false);
    expect([...hidden].sort()).toEqual(["insert", "paragraph", "slide", "text"]);
  });

  it("takes, among groups that go equally soon, the one further along the row", () => {
    const equal = [
      { id: "a", width: 100, drop: 0 },
      { id: "b", width: 100, drop: 1 },
      { id: "c", width: 100, drop: 1 },
    ];
    expect([...chooseHidden(equal, 250, 40)]).toEqual(["c"]);
  });
});

describe("dragging across a number", () => {
  it("moves one step for each few pixels, and not at all for less", () => {
    expect(scrubbed({ start: 10, dx: 3, step: 1 })).toBe(10);
    expect(scrubbed({ start: 10, dx: 4, step: 1 })).toBe(11);
    expect(scrubbed({ start: 10, dx: 40, step: 1 })).toBe(20);
    expect(scrubbed({ start: 10, dx: -40, step: 1 })).toBe(0);
  });

  it("goes ten times as fast with Shift and a tenth as fast with Alt", () => {
    expect(scrubbed({ start: 0, dx: 8, step: 1, shift: true })).toBe(20);
    expect(scrubbed({ start: 0, dx: 8, step: 1, alt: true })).toBe(0.2);
  });

  it("stays between the least and the most, and keeps its decimals", () => {
    expect(scrubbed({ start: 5, dx: -400, step: 1, min: 1 })).toBe(1);
    expect(scrubbed({ start: 95, dx: 400, step: 1, max: 100 })).toBe(100);
    expect(scrubbed({ start: 1, dx: 12, step: 0.125, decimals: 2 })).toBe(1.38);
  });

  it("is stepped by the arrow keys, ten times as far with Shift or the page keys, a tenth with Alt", () => {
    expect(keyStep("ArrowUp", 2, {})).toBe(2);
    expect(keyStep("ArrowDown", 2, {})).toBe(-2);
    expect(keyStep("ArrowUp", 2, { shift: true })).toBe(20);
    expect(keyStep("PageDown", 2, {})).toBe(-20);
    expect(keyStep("ArrowUp", 2, { alt: true })).toBe(0.2);
    expect(keyStep("a", 2, {})).toBeNull();
  });
});

describe("what was used lately", () => {
  it("puts the newest first, drops a repeat whatever its case, and keeps a fixed number", () => {
    expect(pushRecent(["a", "b", "c"], "b", 5)).toEqual(["b", "a", "c"]);
    expect(pushRecent(["Arial", "Georgia"], "arial", 5)).toEqual(["arial", "Georgia"]);
    expect(pushRecent(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
  });

  it("is kept in the browser", () => {
    noteFont("Georgia");
    noteFont("Inter");
    expect(recentFonts()).toEqual(["Inter", "Georgia"]);
    noteColour("#FF0000");
    expect(recentColours()).toEqual(["#ff0000"]);
  });

  it("does not remember a theme colour, which follows the theme, or something that is not a colour", () => {
    noteColour("accent1");
    noteColour("red");
    expect(recentColours()).toEqual([]);
  });

  it("keeps only the most recent colours", () => {
    for (let i = 0; i < RECENT_COLOURS_MAX + 3; i++) noteColour(`#00000${i.toString(16)}`.padEnd(7, "0").slice(0, 7));
    expect(recentColours().length).toBe(RECENT_COLOURS_MAX);
  });

  it("comes back empty when the browser's store is unreadable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(recentFonts()).toEqual([]);
    expect(() => noteFont("Georgia")).not.toThrow();
  });
});

describe("the chrome's own state", () => {
  it("starts comfortable, with the panel at its usual width and every section as it starts", () => {
    const chrome = new Chrome();
    expect(chrome.state.density).toBe("comfortable");
    expect(chrome.state.panelWidth).toBe(PANEL_WIDTH.start);
    expect(chrome.isFolded("size")).toBe(false);
    expect(chrome.isFolded("access", true)).toBe(true);
  });

  it("remembers the density, the panel's width and the folded sections for the next editor", () => {
    const chrome = new Chrome();
    chrome.setDensity("compact");
    chrome.setPanelWidth(400);
    chrome.toggleFold("fill");
    chrome.toggleFold("access", true);
    const next = new Chrome();
    expect(next.state.density).toBe("compact");
    expect(next.state.panelWidth).toBe(400);
    expect(next.isFolded("fill")).toBe(true);
    expect(next.isFolded("access", true)).toBe(false);
    expect(next.isFolded("border")).toBe(false);
  });

  it("keeps the panel between its least and most width, and does not store the middle of a drag", () => {
    expect(clampPanelWidth(10)).toBe(PANEL_WIDTH.min);
    expect(clampPanelWidth(5000)).toBe(PANEL_WIDTH.max);
    const chrome = new Chrome();
    chrome.setPanelWidth(500, false);
    expect(chrome.state.panelWidth).toBe(500);
    expect(new Chrome().state.panelWidth).toBe(PANEL_WIDTH.start);
    chrome.setPanelWidth(500);
    expect(new Chrome().state.panelWidth).toBe(500);
  });

  it("tells the views that follow it, once for each change", () => {
    const chrome = new Chrome();
    const seen = vi.fn();
    chrome.subscribe(seen);
    chrome.setDensity("compact");
    chrome.setDensity("compact");
    chrome.toggleDensity();
    chrome.openMenuSearch();
    chrome.openMenuSearch();
    expect(seen).toHaveBeenCalledTimes(3);
    expect(chrome.state.density).toBe("comfortable");
    expect(chrome.state.menuSearch).toBe(true);
  });

  it("ignores stored values it cannot make sense of", () => {
    localStorage.setItem("ks-chrome-panel-width", '"wide"');
    localStorage.setItem("ks-chrome-density", '"huge"');
    localStorage.setItem("ks-chrome-folds", "[1,2]");
    const chrome = new Chrome();
    expect(chrome.state.panelWidth).toBe(PANEL_WIDTH.start);
    expect(chrome.state.density).toBe("comfortable");
    expect(chrome.state.folds).toEqual({});
  });

  it("is one for each editor", () => {
    const a = new EditorUi();
    expect(chromeOf(a)).toBe(chromeOf(a));
    expect(chromeOf(a)).not.toBe(chromeOf(new EditorUi()));
  });
});

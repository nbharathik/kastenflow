import type { Element } from "@kasten-slides/wasm";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { chromeOf } from "../chrome/chrome.ts";
import { recentPalette } from "../chrome/recents.ts";
import { textBox } from "../factory.ts";
import { modeOfQuery, recentFirst } from "./palette-modes.ts";
import type { PaletteItem } from "./insert-items.ts";
import { type Kit, mountDialogs } from "./test-kit.tsx";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const box = () => screen.getByRole("combobox", { name: "Search commands, things to insert and slides" }) as HTMLInputElement;
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });
const key = (name: string) => fireEvent.keyDown(box(), { key: name });
const options = () => within(screen.getByRole("listbox")).queryAllByRole("option");
const nameOf = (row: HTMLElement | null | undefined) => row?.querySelector(".ks-pl-label")?.firstChild?.textContent;
const names = () => options().map(nameOf);
const headings = () => [...document.querySelectorAll(".ks-pl-head")].map((h) => h.textContent);
const pressed = () => [...document.querySelectorAll(".ks-pl-mode[aria-pressed=true]")].map((b) => b.textContent);

/** Opens the palette as a command would, asking for a part of it. */
async function open(part?: "all" | "commands" | "insert" | "slides", elements: Element[] = []): Promise<Kit> {
  const kit = await mountDialogs({ dialog: null, elements });
  act(() => {
    if (part) chromeOf(kit.ui).askPalette(part);
    kit.ui.openDialog("insert");
  });
  return kit;
}

describe("the parts of the palette", () => {
  it("opens on all of it, with the buttons for each part", async () => {
    await open();
    expect(pressed()).toEqual(["All"]);
    expect([...document.querySelectorAll(".ks-pl-mode")].map((b) => b.textContent)).toEqual(["All", "Commands", "Insert", "Slides"]);
    expect(headings()).toContain("Commands");
    expect(headings()).toContain("Text & content");
  });

  it("opens on the commands alone when Alt+/ asked for them, and the buttons change the part", async () => {
    await open("commands");
    expect(pressed()).toEqual(["Commands"]);
    expect(headings()).toEqual(["Commands"]);
    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    expect(pressed()).toEqual(["Insert"]);
    expect(headings()).not.toContain("Commands");
    expect(names()).toContain("Text box");
    fireEvent.click(screen.getByRole("button", { name: "Slides" }));
    expect(headings()).toEqual(["Slides", "Go to slide"]);
  });

  it("opens on what to insert for the slash, and asks nothing of the next opening", async () => {
    const kit = await open("insert");
    expect(pressed()).toEqual(["Insert"]);
    act(() => kit.ui.openDialog(null));
    act(() => kit.ui.openDialog("insert"));
    expect(pressed()).toEqual(["All"]);
  });

  it("takes a character typed first as the part: > for commands, + for what to insert, # for slides", () => {
    expect(modeOfQuery(">bold", "all")).toEqual({ mode: "commands", words: "bold" });
    expect(modeOfQuery("  +table", "all")).toEqual({ mode: "insert", words: "table" });
    expect(modeOfQuery("#3", "commands")).toEqual({ mode: "slides", words: "3" });
    expect(modeOfQuery("table", "slides")).toEqual({ mode: "slides", words: "table" });
  });

  it("shows the part a typed character asks for", async () => {
    await open();
    type(">zoom");
    expect(pressed()).toEqual(["Commands"]);
    expect(names().slice(0, 3)).toEqual(["Zoom in", "Zoom out", "Zoom to fit"]);
    type("+table");
    expect(pressed()).toEqual(["Insert"]);
    expect(names()[0]).toMatch(/^Table/);
  });
});

describe("the commands", () => {
  it("are the rows of the menus, with the menu each is in and its keys", async () => {
    // Bold can be done when there is text to make bold.
    await open("commands", [textBox({ x: 10, y: 10, w: 200, h: 40 }, "Hi")]);
    type("bold");
    const [bold] = options();
    expect(nameOf(bold)).toBe("Bold");
    expect(bold?.querySelector(".ks-pl-desc")?.textContent).toBe("Format › Text");
    expect(bold?.querySelector("kbd")?.textContent).toMatch(/Ctrl\+B|⌘B/);
  });

  it("find a row by the menu it is in, with words that are not in its name", async () => {
    await open("commands");
    type("slide transition");
    expect(names().some((n) => n?.startsWith("Transition"))).toBe(true);
  });

  it("do not list the commands that open the palette, and none that cannot be done now", async () => {
    await open("commands");
    type("palette");
    expect(names()).not.toContain("Command palette…");
    type("search the menus");
    expect(names()).not.toContain("Search the menus");
    // Nothing is selected, so nothing can be brought to the front.
    type("bring to front");
    expect(names()).not.toContain("Bring to front");
  });

  it("run, and the palette closes first", async () => {
    const kit = await open("commands");
    type("page setup");
    key("Enter");
    expect(kit.ui.state.dialog).toBe("page");
  });

  it("include those only a command has, such as a text style", async () => {
    const kit = await mountDialogs({ dialog: "insert", elements: [textBox({ x: 10, y: 10, w: 200, h: 40 }, "Hi")] });
    type("text style caption");
    expect(names()[0]).toBe("Text style: Caption");
    key("Enter");
    const [made] = kit.session.slide.elements;
    expect(made?.type === "text" && made.text.paragraphs[0]?.style).toBe("caption");
  });
});

describe("the slides", () => {
  async function withSlides(): Promise<Kit> {
    const kit = await mountDialogs({ dialog: null });
    act(() => {
      kit.session.slides.add({ layout: "blank" });
      kit.session.slides.add({ layout: "blank" });
      kit.session.goTo(kit.session.deck.slides[0]!.id);
      chromeOf(kit.ui).askPalette("slides");
      kit.ui.openDialog("insert");
    });
    return kit;
  }

  it("are listed to go to, by number and by what is on them", async () => {
    const kit = await withSlides();
    const count = kit.session.deck.slides.length;
    expect(names().filter((n) => n?.startsWith("Slide "))).toHaveLength(count);
    expect(names().find((n) => n?.startsWith("Slide "))).toMatch(/^Slide 1: /);
  });

  it("are gone to by their number: typing 3 and Enter shows the third slide", async () => {
    const kit = await withSlides();
    type("go to 3");
    expect(names()[0]).toMatch(/^Slide 3:/);
    key("Enter");
    expect(kit.session.state.slideId).toBe(kit.session.deck.slides[2]?.id);
    expect(kit.ui.state.dialog).toBeNull();
  });

  it("are found by the words on them", async () => {
    const kit = await mountDialogs({ dialog: null, elements: [textBox({ x: 10, y: 10, w: 400, h: 60 }, "Quarterly results")] });
    act(() => {
      kit.session.slides.add({ layout: "blank" });
      chromeOf(kit.ui).askPalette("slides");
      kit.ui.openDialog("insert");
    });
    type("quarterly");
    expect(names()[0]).toMatch(/^Slide \d+: Quarterly results$/);
  });
});

describe("what was chosen lately", () => {
  it("is listed first under Recent, newest first, and is remembered in this browser", async () => {
    await open();
    expect(headings()).not.toContain("Recent");
    type("zoom to fit");
    key("Enter");
    expect(recentPalette()).toEqual(["view.zoom-fit"]);
    cleanup();
    const again = await open();
    expect(headings()[0]).toBe("Recent");
    expect(names()[0]).toBe("Zoom to fit");
    // It is listed once, not again under Commands.
    expect(names().filter((n) => n === "Zoom to fit")).toHaveLength(1);
    expect(again.errors).toEqual([]);
  });

  it("puts a recent row ahead of an equal match when words are typed", () => {
    const row = (id: string): PaletteItem => ({ id, group: "Commands", label: id, run: () => {} });
    const items = [row("a"), row("b"), row("c")];
    expect(recentFirst(items, ["c", "gone", "b"]).map((i) => i.id)).toEqual(["c", "b", "a"]);
  });
});

describe("the keys", () => {
  it("keep the box focused while the arrow keys walk the list, and Escape leaves", async () => {
    const kit = await open();
    const first = nameOf(options()[0]);
    key("ArrowDown");
    expect(document.activeElement).toBe(box());
    expect(options().filter((o) => o.getAttribute("aria-selected") === "true")).toHaveLength(1);
    expect(nameOf(document.getElementById(box().getAttribute("aria-activedescendant") ?? ""))).toBe(nameOf(options()[1]));
    expect(first).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(kit.ui.state.dialog).toBeNull();
  });
});

// Import layouts: choose another deck of the host's, tick the layouts, and they are added to this deck's, with the text styles they need.

import { DeckEngine } from "@kasten-slides/wasm";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { COMMANDS, isEnabled, runCommand } from "../commands/index.ts";
import type { DecksHost } from "../decks-host.ts";
import { expectFocusOn } from "../focus/testing.ts";
import { barMenus } from "../menus/bar-menus.ts";
import { mountDialogs } from "./test-kit.tsx";
import { importLayouts, previewDeck, readDeck, textStylesFor } from "./import-layouts.ts";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

/** A deck with two layouts of its own: a poster whose title has a text style the other decks lack, and a plain copy of Title + body. */
async function otherDeck(): Promise<string> {
  const engine = await newDeck("Posters");
  engine.apply("add_layout", { label: "Poster", from: "title-body" });
  engine.apply("add_layout", { label: "Quote card", from: "title-body" });
  const json = JSON.parse(engine.save()) as {
    theme: { textStyles: Record<string, unknown>; layouts: { name: string; placeholders: { role: string; style?: string }[] }[] };
  };
  json.theme.textStyles["callout"] = { ...(json.theme.textStyles["body"] as object), size: 44, bold: true };
  const poster = json.theme.layouts.find((layout) => layout.name === "poster")!;
  poster.placeholders.find((slot) => slot.role === "title")!.style = "callout";
  return JSON.stringify(json);
}

function decksHost(texts: Record<string, string>, titles: Record<string, string> = {}): DecksHost & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    list: async () => Object.keys(texts).map((id) => ({ id, title: titles[id] ?? id, slides: 3 })),
    read: async (id) => {
      reads.push(id);
      const text = texts[id];
      if (text === undefined) throw new Error("gone");
      return text;
    },
  };
}

async function open(texts: Record<string, string>, titles: Record<string, string> = {}) {
  const kit = await mountDialogs();
  const host = decksHost(texts, titles);
  kit.host.decks = host;
  act(() => kit.ui.openDialog("import-layouts"));
  await waitFor(() => expect(screen.queryByText("Looking for your decks…")).toBeNull());
  return { ...kit, decks: host };
}

const choose = async (id: string) => {
  fireEvent.change(screen.getByRole("combobox", { name: "Bring layouts from" }), { target: { value: id } });
  await screen.findByRole("listbox", { name: "Layouts to bring in" });
};
const grid = () => screen.getByRole("listbox", { name: "Layouts to bring in" });
const tiles = () => within(grid()).getAllByRole("option");
const tile = (label: string) => within(grid()).getByRole("option", { name: new RegExp(`^${label}`) });
const importButton = () => screen.getByRole("button", { name: /^Import( \d+ layouts?)?$/ }) as HTMLButtonElement;

describe("the command", () => {
  it("is Import layouts…, and works only where the host keeps other decks", async () => {
    const kit = await mountDialogs();
    const command = COMMANDS.get("layout.import")!;
    expect(command.label).toBe("Import layouts…");
    expect(isEnabled(command, kit)).toBe(false);
    kit.host.decks = decksHost({});
    expect(isEnabled(command, kit)).toBe(true);
    await act(async () => runCommand("layout.import", kit));
    expect(kit.ui.state.dialog).toBe("import-layouts");
  });
});

describe("where it is offered", () => {
  it("is a row of the Slide menu and of the Layouts manager, there only for a host that keeps other decks", async () => {
    const kit = await mountDialogs();
    const slideMenu = () => barMenus(kit).find((m) => m.id === "slide")!.items();
    const row = () => slideMenu().find((item) => item.kind !== "separator" && item.kind !== "heading" && item.label === "Import layouts…");
    expect(row()).toMatchObject({ disabled: true });
    kit.host.decks = decksHost({});
    expect(row()).toMatchObject({ disabled: false });
    act(() => kit.ui.openDialog("layouts-manage"));
    fireEvent.click(await screen.findByRole("button", { name: "Import layouts…" }));
    expect(kit.ui.state.dialog).toBe("import-layouts");
    // Without a host's decks the Layouts manager does not offer it.
    kit.host.decks = undefined;
    act(() => kit.ui.openDialog("layouts-manage"));
    expect(screen.queryByRole("button", { name: "Import layouts…" })).toBeNull();
  });
});

describe("the dialog", () => {
  it("says so when the host has no other decks", async () => {
    const kit = await mountDialogs({ dialog: "import-layouts" });
    expect(screen.getByText("This editor has no other decks to bring layouts from.")).toBeTruthy();
    expect(kit.session.deck.theme.layouts.length).toBeGreaterThan(0);
    expect((importButton()).disabled).toBe(true);
  });

  it("lists the decks of the host but this one, and nothing is imported until a deck is chosen and layouts are ticked", async () => {
    const own = await newDeck("Own");
    const kit = await mountDialogs();
    Object.defineProperty(kit.host, "deckPath", { value: "decks/own.deck" });
    kit.host.decks = decksHost({ "decks/own.deck": own.save(), "decks/posters.deck": await otherDeck() }, { "decks/own.deck": "Own", "decks/posters.deck": "Posters" });
    act(() => kit.ui.openDialog("import-layouts"));
    const select = await screen.findByRole("combobox", { name: "Bring layouts from" });
    expect([...within(select).getAllByRole("option")].map((o) => o.textContent)).toEqual(["Choose a deck", "Posters (3 slides)"]);
    expect(importButton().disabled).toBe(true);
    expect(screen.queryByRole("listbox", { name: "Layouts to bring in" })).toBeNull();
  });

  it("shows the layouts of the chosen deck as tiles and adds the ticked ones in one step, then closes", async () => {
    const { session, host, ui } = await open({ "decks/posters.deck": await otherDeck() }, { "decks/posters.deck": "Posters" });
    const before = session.deck.theme.layouts.length;
    const revision = session.state.revision;
    await choose("decks/posters.deck");
    expect(tiles().map((o) => o.getAttribute("aria-selected"))).not.toContain("true");
    fireEvent.click(tile("Poster"));
    fireEvent.click(tile("Quote card"));
    expect(importButton().textContent).toBe("Import 2 layouts");
    fireEvent.click(tile("Quote card"));
    expect(importButton().textContent).toBe("Import 1 layout");
    fireEvent.click(importButton());
    expect(session.deck.theme.layouts).toHaveLength(before + 1);
    expect(session.deck.theme.layouts.at(-1)?.label).toBe("Poster");
    expect(session.state.revision).toBe(revision + 1);
    expect(host.notices.at(-1)).toMatch(/Added 1 layout/);
    expect(ui.state.dialog).toBeNull();
    act(() => session.undo());
    expect(session.deck.theme.layouts).toHaveLength(before);
  });

  it("brings the text styles the layouts name and this deck lacks, and keeps the ones it has", async () => {
    const { session } = await open({ "decks/posters.deck": await otherDeck() });
    expect(session.deck.theme.textStyles["callout"]).toBeUndefined();
    await choose("decks/posters.deck");
    fireEvent.click(tile("Poster"));
    fireEvent.click(importButton());
    const added = session.deck.theme.layouts.at(-1)!;
    expect(added.placeholders.find((slot) => slot.role === "title")?.style).toBe("callout");
    expect(session.deck.theme.textStyles["callout"]).toMatchObject({ size: 44 });
    // The styles this deck already has are its own.
    expect(session.deck.theme.textStyles["body"]).toBeDefined();
  });

  it("selects all and none, and walks the tiles with the arrow keys, one stop for Tab", async () => {
    await open({ "decks/posters.deck": await otherDeck() });
    await choose("decks/posters.deck");
    const count = tiles().length;
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(tiles().filter((o) => o.getAttribute("aria-selected") === "true")).toHaveLength(count);
    expect(importButton().textContent).toBe(`Import ${count} layouts`);
    fireEvent.click(screen.getByRole("button", { name: "Select none" }));
    expect(importButton().disabled).toBe(true);
    const options = tiles();
    expect(options.filter((o) => o.tabIndex === 0)).toHaveLength(1);
    options[0]!.focus();
    fireEvent.keyDown(options[0]!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(options[1]);
    fireEvent.keyDown(options[1]!, { key: "End" });
    expect(document.activeElement).toBe(options.at(-1));
  });

  it("says when a deck cannot be read, and changes nothing", async () => {
    const { session } = await open({ broken: "this is not a deck", gone: "{}" }, { broken: "Broken" });
    const before = session.deck.theme.layouts.length;
    fireEvent.change(screen.getByRole("combobox", { name: "Bring layouts from" }), { target: { value: "broken" } });
    expect((await screen.findByRole("alert")).textContent).toMatch(/could not be read/);
    expect(importButton().disabled).toBe(true);
    expect(session.deck.theme.layouts).toHaveLength(before);
  });

  it("draws each layout the way it will look here: with this deck's theme and the other deck's text styles it names", async () => {
    const kit = await mountDialogs({ theme: "Dark" });
    const from = readDeck(await otherDeck());
    const drawn = previewDeck(kit.session.deck, from);
    expect(drawn.theme.colors).toEqual(kit.session.deck.theme.colors);
    expect(drawn.theme.layouts).toBe(from.theme.layouts);
    expect(drawn.theme.textStyles["callout"]).toBeDefined();
    // A style both have is this deck's.
    expect(drawn.theme.textStyles["body"]).toEqual(kit.session.deck.theme.textStyles["body"]);
  });

  it("is closed by Cancel and by Escape, and the keys go back to where they were", async () => {
    const kit = await mountDialogs();
    kit.host.decks = decksHost({ "decks/posters.deck": await otherDeck() });
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    act(() => kit.ui.openDialog("import-layouts"));
    await screen.findByRole("combobox", { name: "Bring layouts from" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(kit.ui.state.dialog).toBeNull();
    expectFocusOn(opener);
    act(() => kit.ui.openDialog("import-layouts"));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(kit.ui.state.dialog).toBeNull();
    expectFocusOn(opener);
    opener.remove();
  });
});

describe("the operation", () => {
  it("names only the text styles the layouts use", async () => {
    const from = readDeck(await otherDeck());
    const poster = from.theme.layouts.find((layout) => layout.name === "poster")!;
    expect(Object.keys(textStylesFor(from, [poster]))).toContain("callout");
    const quote = from.theme.layouts.find((layout) => layout.name === "quote-card")!;
    expect(Object.keys(textStylesFor(from, [quote]))).not.toContain("callout");
  });

  it("adds nothing for names the other deck does not have, and answers the names it gave the ones it added", async () => {
    const kit = await mountDialogs();
    const from = readDeck(await otherDeck());
    const before = kit.session.deck.theme.layouts.length;
    expect(importLayouts(kit.session, from, ["no-such-layout"])).toBeUndefined();
    expect(kit.session.deck.theme.layouts).toHaveLength(before);
    expect(importLayouts(kit.session, from, ["poster", "quote-card"])).toHaveLength(2);
    expect(kit.session.deck.theme.layouts).toHaveLength(before + 2);
  });

  it("sends the page size of the deck the layouts come from, and refits them to this deck's", async () => {
    await newDeck();
    const tall = DeckEngine.create("Tall", "Light", 1, { size: { w: 960, h: 720 } });
    tall.apply("add_layout", { label: "Poster", from: "title-body" });
    const from = readDeck(tall.save());
    tall.dispose();
    expect(from.size).toEqual({ w: 960, h: 720 });
    const kit = await mountDialogs();
    expect(kit.session.deck.size).toEqual({ w: 960, h: 540 });
    const titleOf = (layout: { placeholders: { role: string; h: number; w: number }[] }) => layout.placeholders.find((slot) => slot.role === "title")!;
    const made = from.theme.layouts.find((layout) => layout.name === "poster")!;
    const added = importLayouts(kit.session, from, ["poster"]);
    const brought = kit.session.deck.theme.layouts.find((layout) => layout.name === added?.[0])!;
    // 720 high slides come down to 540: heights follow, widths stay (both decks are 960 wide).
    expect(titleOf(brought).h).toBeCloseTo(titleOf(made).h * 0.75, 1);
    expect(titleOf(brought).w).toBeCloseTo(titleOf(made).w, 1);
  });

  it("leaves layouts from a deck of the same size as they were", async () => {
    const kit = await mountDialogs();
    const from = readDeck(await otherDeck());
    expect(from.size).toEqual(kit.session.deck.size);
    const made = from.theme.layouts.find((layout) => layout.name === "poster")!;
    const added = importLayouts(kit.session, from, ["poster"]);
    const brought = kit.session.deck.theme.layouts.find((layout) => layout.name === added?.[0])!;
    expect(brought.placeholders.map(({ x, y, w, h }) => ({ x, y, w, h }))).toEqual(made.placeholders.map(({ x, y, w, h }) => ({ x, y, w, h })));
  });

  it("reads a deck's text through the engine, and lets the engine go", async () => {
    const text = await otherDeck();
    const opened = DeckEngine.open(text).deck;
    expect(readDeck(text)).toEqual(opened);
  });
});

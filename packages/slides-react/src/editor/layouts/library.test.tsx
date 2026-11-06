// The layout library: layouts saved from one deck are in the layout picker of every deck, copied into a deck when used, kept in step by an
// explicit update, and a deck that holds a copy opens with no library at all.

import { DeckEngine, type Layout } from "@kasten-slides/wasm";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { mountDialogs } from "../dialogs/test-kit.tsx";
import { shape, textBox } from "../factory.ts";
import { NewSlideButton } from "../filmstrip/NewSlideButton.tsx";
import type { EditorSession } from "../session/session.ts";
import { TitleBar } from "../titlebar/TitleBar.tsx";
import { layoutRows } from "./LayoutMenu.tsx";
import type { LayoutLibraryHost } from "./library-host.ts";
import { copyLibraryLayout, copyOf, readEntry, refreshFromLibrary, saveSharedLayout, sendToLibrary } from "./library-ops.ts";
import { LIBRARY_KEY, libraryIdOf, libraryText, readLibraryText } from "./library.ts";
import { saveSlideAsLayout } from "./ops.ts";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

/** A library kept in memory, as a host would keep it in files. */
function memoryLibrary(): LayoutLibraryHost & { files: Map<string, string>; removed: string[] } {
  const files = new Map<string, string>();
  const removed: string[] = [];
  return {
    files,
    removed,
    list: async () => [...files].map(([id, text]) => ({ id, label: (JSON.parse(text) as { label: string }).label, slots: 0 })),
    read: async (id) => {
      const text = files.get(id);
      if (text === undefined) throw new Error("gone");
      return text;
    },
    save: async (text) => void files.set((JSON.parse(text) as { id: string }).id, text),
    remove: async (id) => {
      removed.push(id);
      files.delete(id);
    },
  };
}

/** A deck whose shown slide is a poster: a stripe, a heading and a list. */
async function poster(library?: LayoutLibraryHost) {
  const kit = await mountDialogs({
    elements: [shape("rect", box(0, 0, 40, 540)), textBox(box(80, 40, 800, 90), "Heading"), textBox(box(80, 160, 800, 300), "Words")],
  });
  if (library) kit.host.layoutLibrary = library;
  return { ...kit, roles: { [kit.ids[1]!]: "title", [kit.ids[2]!]: "body" } };
}

/** The layout of a deck by label. */
const labelled = (session: EditorSession, label: string): Layout | undefined => session.deck.theme.layouts.find((layout) => layout.label === label);

describe("the file", () => {
  it("is the layout, the text styles its slots name and the page size, under an id, without the mark of a copy", async () => {
    const kit = await poster();
    const name = saveSlideAsLayout(kit.session, { label: "Poster", roles: kit.roles })!;
    const text = libraryText(kit.session.deck, name, "L-one")!;
    const read = readLibraryText(text)!;
    expect(read).toMatchObject({ id: "L-one", label: "Poster", size: { w: 960, h: 540 } });
    expect(read.layout.placeholders.map((slot) => slot.role)).toEqual(["title", "body"]);
    expect(read.layout.elements).toHaveLength(1);
    expect(Object.keys(JSON.parse(text) as object)).toEqual(["format", "formatVersion", "id", "label", "size", "layout", "textStyles"]);
    expect(text.endsWith("\n")).toBe(true);
    expect((read.layout as unknown as Record<string, unknown>)[LIBRARY_KEY]).toBeUndefined();
  });

  it("keeps every field it does not know when the entry is written again, and never changes the id", async () => {
    const kit = await poster();
    const name = saveSlideAsLayout(kit.session, { label: "Poster", roles: kit.roles })!;
    const first = JSON.parse(libraryText(kit.session.deck, name, "L-one")!) as Record<string, unknown>;
    const newer = JSON.stringify({ ...first, "x-newer": { added: "later" }, formatVersion: 2 });
    editLayoutLabel(kit.session, name, "Event poster");
    const again = JSON.parse(libraryText(kit.session.deck, name, "L-one", newer)!) as Record<string, unknown>;
    expect(again["x-newer"]).toEqual({ added: "later" });
    expect(again.formatVersion).toBe(2);
    expect(again.label).toBe("Event poster");
    // Another entry's file is not merged into this one.
    const other = JSON.parse(libraryText(kit.session.deck, name, "L-two", newer)!) as Record<string, unknown>;
    expect(other["x-newer"]).toBeUndefined();
  });

  it("is refused when it is not a layout file", () => {
    for (const text of ["", "[]", "{}", JSON.stringify({ format: "kasten-deck" }), JSON.stringify({ format: "kasten-layout", id: "x", label: "X", size: { w: 1, h: 1 }, layout: {} })]) {
      expect(readLibraryText(text), text).toBeUndefined();
    }
  });
});

function editLayoutLabel(session: EditorSession, name: string, label: string) {
  session.run(() => session.core.apply("edit_layout", { name, label }));
}

describe("saving a layout for all decks", () => {
  it("keeps it in the library and leaves the deck a marked copy that the slide is on, in one step", async () => {
    const library = memoryLibrary();
    const kit = await poster(library);
    const revision = kit.session.state.revision;
    const name = await saveSharedLayout(kit.session, library, { label: "Poster", roles: kit.roles });
    expect(library.files.size).toBe(1);
    const [id, text] = [...library.files][0]!;
    const here = labelled(kit.session, "Poster")!;
    expect(here.name).toBe(name);
    expect(libraryIdOf(here)).toBe(id);
    expect(readLibraryText(text)?.layout.elements).toHaveLength(1);
    expect(kit.session.slide.layout).toBe(name);
    expect(kit.session.slide.elements).toHaveLength(2);
    expect(kit.session.state.revision).toBe(revision + 1);
    act(() => kit.session.undo());
    expect(labelled(kit.session, "Poster")).toBeUndefined();
    expect(kit.session.slide.layout).toBe("blank");
    expect(kit.session.slide.elements).toHaveLength(3);
    expect(library.files.size, "the library keeps it").toBe(1);
  });

  it("starts new slides from the copy that stays when asked to", async () => {
    const library = memoryLibrary();
    const kit = await poster(library);
    const name = await saveSharedLayout(kit.session, library, { label: "Poster", roles: kit.roles, newSlideDefault: true });
    expect(kit.session.deck.theme.newSlideLayout).toBe(name);
  });

  it("changes nothing in the deck when the library cannot be written", async () => {
    const library = { ...memoryLibrary(), save: async () => Promise.reject(new Error("disk full")) };
    const kit = await poster(library);
    const before = kit.session.deck.theme.layouts.length;
    expect(await saveSharedLayout(kit.session, library, { label: "Poster", roles: kit.roles })).toBeUndefined();
    expect(kit.session.deck.theme.layouts).toHaveLength(before);
    expect(kit.host.notices.at(-1)).toContain("disk full");
  });
});

describe("using a library layout in another deck", () => {
  async function both() {
    const library = memoryLibrary();
    const a = await poster(library);
    await saveSharedLayout(a.session, library, { label: "Poster", roles: a.roles });
    cleanup();
    const b = await mountDialogs({ theme: "Dark" });
    b.host.layoutLibrary = library;
    const entry = readLibraryText([...library.files.values()][0]!)!;
    return { library, a, b, entry };
  }

  it("copies it into the deck, whose colours and fonts it takes, and does not copy it twice", async () => {
    const { b, entry } = await both();
    const colors = b.session.deck.theme.colors;
    const name = copyLibraryLayout(b.session, entry)!;
    const copy = b.session.deck.theme.layouts.find((layout) => layout.name === name)!;
    expect(copy.label).toBe("Poster");
    expect(copy.placeholders.map((slot) => slot.role)).toEqual(["title", "body"]);
    expect(copy.elements).toEqual(entry.layout.elements);
    expect(libraryIdOf(copy)).toBe(entry.id);
    expect(b.session.deck.theme.colors, "the deck keeps its own palette").toEqual(colors);
    // The stripe names a theme colour, not a colour of the deck it was made in.
    expect(JSON.stringify(copy.elements)).toContain('"accent1"');
    const count = b.session.deck.theme.layouts.length;
    expect(copyLibraryLayout(b.session, entry)).toBe(name);
    expect(b.session.deck.theme.layouts).toHaveLength(count);
    expect(copyOf(b.session.deck, entry.id)?.name).toBe(name);
  });

  it("is one step of undo", async () => {
    const { b, entry } = await both();
    const count = b.session.deck.theme.layouts.length;
    copyLibraryLayout(b.session, entry);
    act(() => b.session.undo());
    expect(b.session.deck.theme.layouts).toHaveLength(count);
  });

  it("refits a layout drawn for another page size to this deck's", async () => {
    await newDeck();
    const tall = DeckEngine.create("Tall", "Light", 1, { size: { w: 960, h: 720 } });
    tall.apply("add_layout", { label: "Tall poster", from: "title-body" });
    const entry = readLibraryText(libraryText(tall.deck, "tall-poster", "L-tall")!)!;
    tall.dispose();
    const kit = await mountDialogs();
    const name = copyLibraryLayout(kit.session, entry)!;
    const title = (layout: { placeholders: { role: string; h: number }[] }) => layout.placeholders.find((slot) => slot.role === "title")!.h;
    const brought = kit.session.deck.theme.layouts.find((layout) => layout.name === name)!;
    expect(title(brought)).toBeCloseTo(title(entry.layout) * 0.75, 1);
  });

  it("opens with no library, and keeps the mark through a save and a reopen", async () => {
    const { b, entry } = await both();
    const name = copyLibraryLayout(b.session, entry)!;
    const reopened = DeckEngine.open(b.session.core.save());
    const copy = reopened.deck.theme.layouts.find((layout) => layout.name === name)!;
    expect(libraryIdOf(copy)).toBe(entry.id);
    expect(copy.elements).toEqual(entry.layout.elements);
    reopened.dispose();
    // A host with no library: the deck and its layout are all there is.
    const bare = await mountDialogs({
      prepare: (engine) =>
        void engine.apply("import_layouts", { layouts: [{ ...entry.layout, [LIBRARY_KEY]: { id: entry.id } } as typeof entry.layout], textStyles: entry.textStyles }),
    });
    expect(bare.host.layoutLibrary).toBeUndefined();
    act(() => bare.ui.openDialog("layouts-manage"));
    expect(screen.queryByRole("region", { name: "My layouts" })).toBeNull();
    expect(screen.queryByRole("button", { name: /from My layouts/ })).toBeNull();
    expect(screen.getAllByText("Poster").length).toBeGreaterThan(0);
  });
});

describe("keeping a copy in step with the library", () => {
  it("sets the copy to the library's version, keeping its name and its slides, as one step", async () => {
    const library = memoryLibrary();
    const kit = await poster(library);
    const name = (await saveSharedLayout(kit.session, library, { label: "Poster", roles: kit.roles }))!;
    const [id, text] = [...library.files][0]!;
    // Someone adds a second stripe to the library's version.
    const file = JSON.parse(text) as { layout: { elements: { id: string; x: number }[] } };
    file.layout.elements.push({ ...file.layout.elements[0]!, id: "stripe-2", x: 920 });
    await library.save(JSON.stringify(file));
    const revision = kit.session.state.revision;
    expect(await refreshFromLibrary(kit.session, library, name)).toBe(true);
    const copy = kit.session.deck.theme.layouts.find((layout) => layout.name === name)!;
    expect(copy.elements).toHaveLength(2);
    expect(libraryIdOf(copy)).toBe(id);
    expect(kit.session.slide.layout).toBe(name);
    expect(kit.session.slide.elements).toHaveLength(2);
    expect(kit.session.state.revision).toBe(revision + 1);
    act(() => kit.session.undo());
    expect(kit.session.deck.theme.layouts.find((layout) => layout.name === name)!.elements).toHaveLength(1);
  });

  it("says so, and changes nothing, when the entry is gone from the library", async () => {
    const library = memoryLibrary();
    const kit = await poster(library);
    const name = (await saveSharedLayout(kit.session, library, { label: "Poster", roles: kit.roles }))!;
    library.files.clear();
    const revision = kit.session.state.revision;
    expect(await refreshFromLibrary(kit.session, library, name)).toBe(false);
    expect(kit.session.state.revision).toBe(revision);
    expect(kit.host.notices.at(-1)).toContain("no longer in My layouts");
  });

  it("adds a layout made in this deck to the library as a marked copy in its place, and updates the entry the second time", async () => {
    const library = memoryLibrary();
    const kit = await poster(library);
    const name = saveSlideAsLayout(kit.session, { label: "Poster", roles: kit.roles })!;
    const at = kit.session.deck.theme.layouts.findIndex((layout) => layout.name === name);
    expect(await sendToLibrary(kit.session, library, name)).toBe("added");
    expect(library.files.size).toBe(1);
    const copy = labelled(kit.session, "Poster")!;
    expect(libraryIdOf(copy)).toBe([...library.files.keys()][0]);
    expect(kit.session.deck.theme.layouts.indexOf(copy)).toBe(at);
    expect(kit.session.slide.layout).toBe(copy.name);
    expect(await sendToLibrary(kit.session, library, copy.name)).toBe("updated");
    expect(library.files.size).toBe(1);
    expect(await readEntry(library, libraryIdOf(copy)!)).toMatchObject({ label: "Poster" });
  });
});

describe("the New slide menu", () => {
  async function menu(library?: LayoutLibraryHost) {
    const kit = await poster(library);
    render(<NewSlideButton session={kit.session} ui={kit.ui} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose a layout for the new slide" }));
    return kit;
  }

  it("shows My layouts next to the deck's own, and a new slide on one copies it into the deck", async () => {
    const library = memoryLibrary();
    const a = await poster(library);
    await saveSharedLayout(a.session, library, { label: "Poster", roles: a.roles });
    cleanup();
    const kit = await menu(library);
    const mine = await screen.findByRole("listbox", { name: "My layouts" });
    expect(screen.getByRole("listbox", { name: "Layouts" })).toBeTruthy();
    expect(labelled(kit.session, "Poster")).toBeUndefined();
    fireEvent.click(within(mine).getByRole("option", { name: "Poster" }));
    const copy = labelled(kit.session, "Poster")!;
    expect(libraryIdOf(copy)).toBeDefined();
    expect(kit.session.slide.layout).toBe(copy.name);
    expect(kit.session.slide.elements.map((element) => element.placeholder)).toEqual(["title", "body"]);
  });

  it("says what it is for while the library is empty, and is not there at all in a host with no library", async () => {
    await menu(memoryLibrary());
    expect(await screen.findByText(/Layouts you save for all decks show up here/)).toBeTruthy();
    cleanup();
    await menu();
    expect(screen.queryByRole("region", { name: "My layouts" })).toBeNull();
    expect(screen.getByRole("listbox", { name: "Layouts" })).toBeTruthy();
  });

  it("says so when the library cannot be read, and tries again", async () => {
    let fail = true;
    const library: LayoutLibraryHost = { ...memoryLibrary(), list: async () => (fail ? Promise.reject(new Error("no")) : []) };
    await menu(library);
    expect((await screen.findByRole("alert")).textContent).toContain("could not be loaded");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/Layouts you save for all decks show up here/)).toBeTruthy();
  });
});

describe("Save slide as layout", () => {
  async function dialog(library?: LayoutLibraryHost) {
    const kit = await poster(library);
    act(() => kit.ui.openDialog("layout-save"));
    return kit;
  }

  it("asks where to keep it, all decks first, and keeps it for all of them", async () => {
    const library = memoryLibrary();
    const kit = await dialog(library);
    expect((screen.getByRole("radio", { name: "All my decks" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: "This deck only" }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Save layout" }));
    await waitFor(() => expect(kit.ui.state.dialog).toBeNull());
    expect(library.files.size).toBe(1);
    expect(libraryIdOf(labelled(kit.session, "My layout")!)).toBeDefined();
    expect(kit.host.notices.at(-1)).toContain("all your decks");
  });

  it("keeps it in this deck alone when told to, and the library is not touched", async () => {
    const library = memoryLibrary();
    const kit = await dialog(library);
    fireEvent.click(screen.getByRole("radio", { name: "This deck only" }));
    fireEvent.click(screen.getByRole("button", { name: "Save layout" }));
    await waitFor(() => expect(kit.ui.state.dialog).toBeNull());
    expect(library.files.size).toBe(0);
    expect(libraryIdOf(labelled(kit.session, "My layout")!)).toBeUndefined();
  });

  it("has nothing to ask in a host with no library", async () => {
    const kit = await dialog();
    expect(screen.queryByRole("radio", { name: "All my decks" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save layout" }));
    expect(kit.ui.state.dialog).toBeNull();
    expect(labelled(kit.session, "My layout")).toBeDefined();
  });
});

describe("the Layout menu", () => {
  it("lists My layouts the deck has no copy of, after the deck's own, and choosing one copies it in and puts the slide on it", async () => {
    const library = memoryLibrary();
    const a = await poster(library);
    await saveSharedLayout(a.session, library, { label: "Poster", roles: a.roles });
    cleanup();
    const kit = await poster(library);
    expect(layoutRows(kit.session).some((row) => row.label === "Poster"), "nothing is read yet").toBe(false);
    render(<TitleBar session={kit.session} ui={kit.ui} />);
    await waitFor(() => expect(layoutRows(kit.session).some((row) => row.label === "Poster")).toBe(true));
    const rows = layoutRows(kit.session);
    const mine = rows.find((row) => row.label === "Poster")!;
    expect(rows.indexOf(mine)).toBe(rows.length - 1);
    expect(mine.description).toBe("My layouts");
    act(() => mine.run?.());
    const copy = labelled(kit.session, "Poster")!;
    expect(libraryIdOf(copy)).toBeDefined();
    expect(kit.session.slide.layout).toBe(copy.name);
    // Once the deck has its copy, the library entry is not listed a second time.
    expect(layoutRows(kit.session).filter((row) => row.label === "Poster")).toHaveLength(1);
  });

  it("is the deck's own layouts alone in a host with no library", async () => {
    const kit = await poster();
    render(<TitleBar session={kit.session} ui={kit.ui} />);
    expect(layoutRows(kit.session).every((row) => row.description !== "My layouts")).toBe(true);
  });
});

describe("the layout manager", () => {
  async function manager() {
    const library = memoryLibrary();
    const kit = await poster(library);
    const name = (await saveSharedLayout(kit.session, library, { label: "Poster", roles: kit.roles }))!;
    act(() => kit.ui.openDialog("layouts-manage"));
    return { ...kit, library, name };
  }
  const row = (name: string) => screen.getByRole("list", { name: "Layouts of this deck" }).querySelector<HTMLElement>(`[data-layout="${name}"]`)!;

  it("marks a copy, updates it from the library and sends its changes back", async () => {
    const { name, library, session, host } = await manager();
    expect(row(name).textContent).toContain("In My layouts");
    fireEvent.click(within(row(name)).getByRole("button", { name: "Update Poster from My layouts" }));
    await waitFor(() => expect(host.notices.at(-1)).toContain("Updated “Poster” from My layouts"));
    act(() => editLayoutLabel(session, name, "Event poster"));
    fireEvent.click(within(row(name)).getByRole("button", { name: "Update My layouts from Event poster" }));
    await waitFor(() => expect(host.notices.at(-1)).toContain("Updated My layouts from"));
    expect(readLibraryText([...library.files.values()][0]!)?.label).toBe("Event poster");
  });

  it("offers a layout of the deck that is not in the library, and adds it", async () => {
    const { session, library } = await manager();
    let own = "";
    act(() => {
      own = session.run(() => session.core.apply("add_layout", { label: "Quote card", from: "title-body" }))!.output.layout;
    });
    fireEvent.click(await within(row(own)).findByRole("button", { name: "Add Quote card to My layouts" }));
    await waitFor(() => expect(library.files.size).toBe(2));
    await waitFor(() => expect(row(labelled(session, "Quote card")!.name).textContent).toContain("In My layouts"));
  });

  it("lists the library, adds a layout to the deck once, and takes one out only after asking", async () => {
    const { session, library, name } = await manager();
    const list = await screen.findByRole("list", { name: "Layouts kept for every deck" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect((within(list).getByRole("button", { name: "Poster is in this deck already" }) as HTMLButtonElement).disabled).toBe(true);
    // Drop the deck's copy and the entry can be added again.
    act(() => void session.run(() => session.core.apply("delete_layout", { name, moveTo: "blank" })));
    fireEvent.click(await within(list).findByRole("button", { name: "Add Poster to this deck" }));
    expect(labelled(session, "Poster")).toBeDefined();
    fireEvent.click(within(list).getByRole("button", { name: "Take Poster out of My layouts" }));
    expect(library.files.size, "not yet").toBe(1);
    fireEvent.click(within(list).getByRole("button", { name: "Take it out" }));
    await waitFor(() => expect(library.files.size).toBe(0));
    expect(library.removed).toHaveLength(1);
    expect(labelled(session, "Poster"), "decks keep their copy").toBeDefined();
  });
});

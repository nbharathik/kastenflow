// The layouts a person makes: saved from a slide, listed in the New slide menu, managed, designed, and the slides that follow.

import { DeckEngine } from "@kasten-slides/wasm";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SlideView } from "../../render/index.ts";
import { COMMANDS, runCommand } from "../commands/index.ts";
import { Dialogs } from "../dialogs/Dialogs.tsx";
import { mountDialogs } from "../dialogs/test-kit.tsx";
import { shape, textBox } from "../factory.ts";
import { NewSlideButton } from "../filmstrip/NewSlideButton.tsx";
import { barMenus } from "../menus/bar-menus.ts";
import { addSlide } from "../new-slide.ts";
import type { DialogName } from "../ui-state.ts";
import type { MenuItem } from "../ui/Menu.tsx";
import { isOwnLayout, myDefaultLayout } from "./default-layout.ts";
import { layoutRows } from "./LayoutMenu.tsx";
import { editLayout, saveSlideAsLayout, setLayoutDesign } from "./ops.ts";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

/** A deck whose shown slide is a poster: a stripe, a heading and a list. */
async function poster(dialog: DialogName | null = null) {
  return mountDialogs({
    dialog,
    elements: [shape("rect", box(0, 0, 40, 540)), textBox(box(80, 40, 800, 90), "Heading"), textBox(box(80, 160, 800, 300), "Words")],
  });
}

describe("Save slide as layout", () => {
  it("names the design, marks the slots, and the layout and the slide are one step", async () => {
    const kit = await poster("layout-save");
    const list = screen.getByRole("list", { name: "What is on the slide" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    // A shape can only be decoration; words can be any slot but a picture.
    expect(within(rows[0]!).queryByRole("combobox")).toBeNull();
    const choices = within(rows[1]!).getAllByRole("option").map((option) => option.textContent);
    expect(choices).toEqual(["Decoration", "Title slot", "Subtitle slot", "Body (bullets) slot", "Text slot", "Caption slot"]);
    fireEvent.change(within(rows[1]!).getByRole("combobox"), { target: { value: "title" } });
    fireEvent.change(within(rows[2]!).getByRole("combobox"), { target: { value: "body" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Poster" } });
    const revision = kit.session.state.revision;
    fireEvent.click(screen.getByRole("button", { name: "Save layout" }));

    const layout = kit.session.deck.theme.layouts.find((l) => l.name === "poster");
    expect(layout?.label).toBe("Poster");
    expect(layout?.elements).toHaveLength(1);
    expect(layout?.placeholders.map((p) => p.role)).toEqual(["title", "body"]);
    expect(kit.session.slide.layout).toBe("poster");
    expect(kit.session.slide.elements).toHaveLength(2);
    expect(kit.session.state.revision).toBe(revision + 1);
    expect(kit.ui.state.dialog).toBeNull();
    expect(kit.host.notices.at(-1)).toContain("Poster");
    expect(kit.errors).toEqual([]);

    act(() => kit.session.undo());
    expect(kit.session.deck.theme.layouts.some((l) => l.name === "poster")).toBe(false);
    expect(kit.session.slide.layout).toBe("blank");
    expect(kit.session.slide.elements).toHaveLength(3);
  });

  it("keeps the slide as it was when asked not to put it on the layout, and can make the layout the default", async () => {
    const kit = await poster("layout-save");
    fireEvent.click(screen.getByLabelText("Put this slide on the new layout"));
    fireEvent.click(screen.getByLabelText("Start new slides from it"));
    fireEvent.click(screen.getByRole("button", { name: "Save layout" }));
    expect(kit.session.slide.layout).toBe("blank");
    expect(kit.session.deck.theme.newSlideLayout).toBe("my-layout");
    expect(myDefaultLayout(kit.session.deck)).toBe("my-layout");
  });

  it("will not save with no name", async () => {
    const kit = await poster("layout-save");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  " } });
    expect((screen.getByRole("button", { name: "Save layout" }) as HTMLButtonElement).disabled).toBe(true);
    expect(kit.session.deck.theme.layouts.some((l) => isOwnLayout(l.name))).toBe(false);
  });

  it("says what a slot already is, and has nothing to ask about an empty slide", async () => {
    const kit = await mountDialogs({ dialog: "layout-save", blank: false });
    expect(kit.session.slide.layout).toBe("title");
    expect(screen.getAllByText(/slot, as it is/)).toHaveLength(2);
  });
});

describe("the layouts of a deck in the New slide menu", () => {
  async function menu() {
    const kit = await poster();
    expect(saveSlideAsLayout(kit.session, { label: "Poster", roles: { [kit.ids[1]!]: "title", [kit.ids[2]!]: "body" } })).toBe("poster");
    render(<NewSlideButton session={kit.session} ui={kit.ui} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose a layout for the new slide" }));
    return { ...kit, picker: screen.getByRole("listbox", { name: "Layouts" }) };
  }

  it("lists the layout beside the built-in ones, with a thumbnail that carries its decoration", async () => {
    const { picker, session } = await menu();
    const option = within(picker).getByRole("option", { name: "Poster" });
    expect(option.textContent).toContain("Yours");
    expect(within(picker).getByRole("option", { name: "Title + body" }).textContent).not.toContain("Yours");
    expect(picker.querySelectorAll(".ks-lt .ks-slide")).toHaveLength(session.deck.theme.layouts.length);
    const thumb = option.querySelector(".ks-lt");
    expect(thumb?.querySelectorAll("[data-master]").length, "the stripe of the layout").toBeGreaterThan(0);
  });

  it("makes a slide of the layout with its slots ready to be typed into", async () => {
    const { picker, session } = await menu();
    fireEvent.click(within(picker).getByRole("option", { name: "Poster" }));
    const made = session.slide;
    expect(made.layout).toBe("poster");
    expect(made.elements.map((e) => e.placeholder)).toEqual(["title", "body"]);
    expect(made.elements.every((e) => e.x === undefined), "they stand where the layout puts them").toBe(true);
  });

  it("offers a way to save and to manage layouts, and starts new slides from the one marked as the default", async () => {
    const { session, ui } = await menu();
    fireEvent.click(screen.getByRole("radio", { name: "My default" }));
    expect(ui.state.newSlides).toBe("mine");
    expect(screen.getByText(/No layout is marked as the default/)).toBeTruthy();
    act(() => editLayout(session, "poster", { defaultForNew: true }));
    expect(screen.getByText("My default is “Poster”.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Manage layouts…" }));
    expect(ui.state.dialog).toBe("layouts-manage");
    expect(screen.queryByRole("listbox", { name: "Layouts" }), "the menu closes").toBeNull();
    act(() => void addSlide(session, ui));
    expect(session.slide.layout).toBe("poster");
  });

  it("falls back to blank for the default while none is marked", async () => {
    const kit = await poster();
    expect(myDefaultLayout(kit.session.deck)).toBe("blank");
    act(() => kit.ui.setNewSlides("mine"));
    act(() => void addSlide(kit.session, kit.ui));
    expect(kit.session.slide.layout).toBe("blank");
  });
});

describe("the layout manager", () => {
  async function manager() {
    const kit = await poster();
    saveSlideAsLayout(kit.session, { label: "Poster", roles: { [kit.ids[1]!]: "title" } });
    act(() => kit.ui.openDialog("layouts-manage"));
    return kit;
  }
  const rowOf = (label: string) => screen.getByRole("list", { name: "Layouts of this deck" }).querySelector<HTMLElement>(`[data-layout="${label}"]`)!;

  it("lists every layout with how many slides use it, and tells the person's own from the built-in ones", async () => {
    const kit = await manager();
    const rows = within(screen.getByRole("list", { name: "Layouts of this deck" })).getAllByRole("listitem");
    expect(rows).toHaveLength(kit.session.deck.theme.layouts.length);
    expect(rowOf("poster").textContent).toContain("Yours");
    expect(rowOf("poster").textContent).toContain("1 slide uses it");
    expect(rowOf("blank").textContent).toContain("Built in");
  });

  it("renames a layout, which its slides keep using by name", async () => {
    const kit = await manager();
    fireEvent.click(within(rowOf("poster")).getByRole("button", { name: "Rename Poster" }));
    const input = within(rowOf("poster")).getByRole("textbox", { name: "Name of Poster" });
    fireEvent.change(input, { target: { value: "Event poster" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(kit.session.deck.theme.layouts.find((l) => l.name === "poster")?.label).toBe("Event poster");
    expect(kit.session.slide.layout).toBe("poster");
  });

  it("copies a layout, marks one as the default, and orders them", async () => {
    const kit = await manager();
    fireEvent.click(within(rowOf("poster")).getByRole("button", { name: "Duplicate Poster" }));
    expect(kit.session.deck.theme.layouts.at(-1)?.label).toBe("Poster copy");
    fireEvent.click(within(rowOf("poster")).getByRole("button", { name: "Start new slides from Poster" }));
    expect(kit.session.deck.theme.newSlideLayout).toBe("poster");
    expect(rowOf("poster").textContent).toContain("New slides start here");
    // The person's own come first and move among themselves: the first cannot go up past the built-in ones, and down it swaps with the copy.
    expect((within(rowOf("poster")).getByRole("button", { name: "Move Poster up" }) as HTMLButtonElement).disabled).toBe(true);
    const before = kit.session.deck.theme.layouts.findIndex((l) => l.name === "poster");
    fireEvent.click(within(rowOf("poster")).getByRole("button", { name: "Move Poster down" }));
    expect(kit.session.deck.theme.layouts.findIndex((l) => l.name === "poster")).toBe(before + 1);
    expect((within(rowOf("poster")).getByRole("button", { name: "Move Poster down" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(rowOf("blank")).getByRole("button", { name: "Move Blank up" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("asks where the slides of a layout go before it deletes it, and nothing is lost", async () => {
    const kit = await manager();
    fireEvent.click(within(rowOf("poster")).getByRole("button", { name: "Delete Poster" }));
    expect(kit.session.deck.theme.layouts.some((l) => l.name === "poster"), "not yet").toBe(true);
    const ask = within(rowOf("poster")).getByRole("group", { name: "Delete Poster" });
    fireEvent.change(within(ask).getByRole("combobox", { name: "Move its slides to" }), { target: { value: "title-only" } });
    fireEvent.click(within(ask).getByRole("button", { name: "Delete layout" }));
    expect(kit.session.deck.theme.layouts.some((l) => l.name === "poster")).toBe(false);
    expect(kit.session.slide.layout).toBe("title-only");
    expect(kit.session.slide.elements.some((e) => e.type === "text" && e.text.paragraphs[0]?.runs[0]?.t === "Heading")).toBe(true);
    act(() => kit.session.undo());
    expect(kit.session.deck.theme.layouts.some((l) => l.name === "poster")).toBe(true);
  });

  it("deletes a layout no slide uses at once", async () => {
    const kit = await manager();
    fireEvent.click(within(rowOf("code")).getByRole("button", { name: "Delete Code" }));
    expect(kit.session.deck.theme.layouts.some((l) => l.name === "code")).toBe(false);
  });

  it("makes a blank layout of your own the default, and opens the designer on it", async () => {
    const kit = await manager();
    fireEvent.click(screen.getByRole("button", { name: "Design my blank layout…" }));
    const mine = kit.session.deck.theme.layouts.find((l) => l.label === "Blank (mine)");
    expect(mine?.placeholders).toEqual([]);
    expect(kit.session.deck.theme.newSlideLayout).toBe(mine?.name);
    expect(kit.ui.state.newSlides).toBe("mine");
    expect(kit.ui.state.dialog).toBe("layout-design");
    expect(kit.ui.state.layoutDesign).toBe(mine?.name);
  });
});

describe("the layout designer", () => {
  /** The designer open on a layout, inside a stand-in for the deck's editor that hears every key that gets out of it. */
  async function designer(name = "title-body") {
    const kit = await mountDialogs({ blank: false, prepare: (engine) => void engine.apply("add_slide", { layout: "title-body", content: { title: "Findings", body: "- one" } }) });
    kit.view.unmount();
    const heard = vi.fn();
    render(
      <div onKeyDown={heard}>
        <Dialogs session={kit.session} ui={kit.ui} />
      </div>,
    );
    act(() => kit.session.goTo(kit.session.deck.slides[1]!.id));
    act(() => kit.ui.openLayoutDesign(name));
    // The designer is loaded when it is first asked for, which takes a while in a test that has to transform the editor's modules.
    const root = await screen.findByTestId("layout-designer", {}, { timeout: 60_000 });
    return { ...kit, root, heard };
  }

  it("opens the layout on the editor's own canvas, its slots as boxes with what they ask for", async () => {
    const { root } = await designer();
    expect(root.getAttribute("aria-label")).toBe("Edit layout Title + body");
    expect(root.textContent).toContain("1 slide follows it");
    expect(root.querySelector(".ks-slide")).toBeTruthy();
    expect(within(root).getByRole("button", { name: "Add slot" })).toBeTruthy();
    expect(root.textContent).toContain("Click to add title");
  });

  it("changes the layout and every slide that follows it when it is done, in one step, and leaves the words alone", async () => {
    const { root, session, ui } = await designer();
    const before = session.deck.theme.layouts.find((l) => l.name === "title-body")!.placeholders.length;
    const revision = session.state.revision;
    fireEvent.click(within(root).getByRole("button", { name: "Add slot" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Picture/ }));
    fireEvent.click(within(root).getByRole("button", { name: "Done" }));
    const layout = session.deck.theme.layouts.find((l) => l.name === "title-body")!;
    expect(layout.placeholders).toHaveLength(before + 1);
    expect(layout.placeholders.at(-1)).toMatchObject({ role: "image", kind: "image" });
    expect(session.state.revision).toBe(revision + 1);
    expect(ui.state.dialog).toBeNull();
    expect(ui.state.layoutDesign).toBeNull();
    // The slide that uses it has its own words, still.
    expect(session.slide.elements.some((e) => e.type === "text" && e.text.paragraphs[0]?.runs[0]?.t === "Findings")).toBe(true);
    act(() => session.undo());
    expect(session.deck.theme.layouts.find((l) => l.name === "title-body")!.placeholders).toHaveLength(before);
  });

  it("changes nothing when cancelled, and asks first if something was changed", async () => {
    const { root, session, ui } = await designer();
    const deck = session.deck;
    fireEvent.click(within(root).getByRole("button", { name: "Add slot" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Title/ }));
    fireEvent.click(within(root).getByRole("button", { name: "Cancel" }));
    expect(within(root).getByRole("alert").textContent).toContain("Throw away");
    fireEvent.click(within(root).getByRole("button", { name: "Discard" }));
    expect(session.deck).toBe(deck);
    expect(ui.state.layoutDesign).toBeNull();
  });

  it("keeps its keys to itself: what is pressed there never reaches the deck's editor underneath", async () => {
    const { root, session, heard } = await designer();
    const elements = session.slide.elements.length;
    fireEvent.keyDown(root, { key: "Delete" });
    fireEvent.keyDown(within(root).getByRole("button", { name: "Add slot" }), { key: "a", ctrlKey: true });
    expect(heard).not.toHaveBeenCalled();
    expect(session.slide.elements).toHaveLength(elements);
  });

  it("offers the slide's background but not what belongs to the deck: no layout, theme or transition", async () => {
    const { root } = await designer();
    const bar = within(within(root).getByRole("toolbar", { name: "Toolbar" }));
    expect(bar.getByRole("button", { name: "Background" })).toBeTruthy();
    for (const name of ["Layout", "Theme", "Transition"]) expect(bar.queryByRole("button", { name })).toBeNull();
    expect(root.querySelector(".ks-ld-panel")).toBeTruthy();
  });

  it("hides the theme's graphics on the layout when asked", async () => {
    const { root, session } = await designer();
    fireEvent.click(within(root).getByRole("checkbox", { name: "Hide the theme's graphics" }));
    fireEvent.click(within(root).getByRole("button", { name: "Done" }));
    expect(session.deck.theme.layouts.find((l) => l.name === "title-body")?.hideMaster).toBe(true);
  });
});

describe("layout changes and the slides that follow", () => {
  it("moves a slot with the layout unless it was moved by hand, and keeps the words either way", async () => {
    const kit = await mountDialogs({ blank: false });
    const { session } = kit;
    const first = addSlide(session, kit.ui, { layout: "title-body" })!;
    const second = addSlide(session, kit.ui, { layout: "title-body" })!;
    const moved = session.deck.slides.find((s) => s.id === second)!.elements[0]!;
    session.elements.transform([{ id: moved.id, x: 400, y: 300 }]);
    const design = DeckEngine.open(session.core.layoutDesign("title-body")).deck.slides[0]!;
    const title = design.elements.find((e) => e.placeholder === "title")!;
    (title as { x: number }).x = 200;
    expect(setLayoutDesign(session, "title-body", design)).toEqual([]);
    const at = (id: string) => session.deck.slides.find((s) => s.id === id)!.elements.find((e) => e.placeholder === "title")!;
    expect(at(first).x, "it follows the layout").toBeUndefined();
    expect(at(second).x, "this one was put somewhere").toBe(400);
    expect(session.deck.theme.layouts.find((l) => l.name === "title-body")?.placeholders[0]?.x).toBe(200);
  });
});

describe("what a slide on a layout shows", () => {
  it("draws the layout's decoration on every slide of it, whatever the slide holds", async () => {
    const kit = await poster();
    saveSlideAsLayout(kit.session, { label: "Poster", roles: { [kit.ids[1]!]: "title" } });
    const { deck } = kit.session;
    const draw = (layout: string) => render(<SlideView deck={deck} slide={{ id: "x", layout, elements: [] }} mode="thumbnail" />).container.querySelectorAll("[data-master]").length;
    const decorated = draw("poster");
    cleanup();
    expect(decorated, "the stripe and the list that were not made slots").toBe(2);
    expect(draw("blank"), "a layout without decoration draws nothing behind the slide").toBe(0);
  });

  it("paints the layout's background, and the slide's own over it", async () => {
    const kit = await poster();
    kit.session.core.apply("set_background", { slide: kit.session.state.slideId, background: { color: "accent3" } });
    kit.session.core.apply("save_layout", { slide: kit.session.state.slideId, label: "Tinted", roles: {} });
    const { deck } = kit.session;
    const paint = (own?: { color: string }) => {
      const slide = { id: "x", layout: "tinted", elements: [], ...(own ? { background: own } : {}) };
      return render(<SlideView deck={deck} slide={slide} mode="thumbnail" />).container.querySelector<HTMLElement>(".ks-slide")!.style.background;
    };
    const layoutBackground = paint();
    cleanup();
    expect(paint({ color: "#112233" })).not.toBe(layoutBackground);
    expect(layoutBackground).not.toBe("");
  });
});

/** Every label in a menu, sub-menus included. */
function labelsOf(items: readonly MenuItem[]): string[] {
  return items.flatMap((item) => (item.kind === "separator" || item.kind === "heading" ? [] : [item.label, ...(item.items ? labelsOf(item.items) : [])]));
}

describe("where the layouts and templates are in the menus", () => {
  it("lists the person's own layouts first in the Layout menu, each with a drawing, the one in use checked", async () => {
    const kit = await poster();
    saveSlideAsLayout(kit.session, { label: "Poster", roles: { [kit.ids[1]!]: "title" } });
    const rows = layoutRows(kit.session);
    expect(rows).toHaveLength(kit.session.deck.theme.layouts.length);
    expect(rows[0]).toMatchObject({ id: "layout-poster", label: "Poster", checked: true });
    expect(rows[1]).toMatchObject({ checked: false });
    expect(rows.every((row) => row.trailing)).toBe(true);
  });

  it("has saving, editing, resetting and managing layouts in the Slide menu, and templates in the File menu", async () => {
    const kit = await poster();
    const menu = (id: string) => labelsOf(barMenus(kit).find((m) => m.id === id)!.items());
    expect(menu("slide")).toEqual(expect.arrayContaining(["Save slide as layout…", "Edit this layout…", "Reset slide to layout", "Manage layouts…"]));
    expect(menu("file")).toEqual(expect.arrayContaining(["Save as template…", "Apply a template…"]));
    expect(menu("view")).toContain("My default layout");
  });
});

describe("the commands", () => {
  it("are all there, and the ones that need a host's templates are off without one", async () => {
    const kit = await poster();
    for (const id of ["slide.save-as-layout", "slide.reset-layout", "layout.edit", "layout.manage", "slide.new-mine", "deck.save-template", "deck.apply-template"]) expect(COMMANDS.has(id), id).toBe(true);
    const enabled = (id: string) => COMMANDS.get(id)!.enabled?.(kit.session.state, kit.ui.state, kit.session.host) ?? true;
    expect(enabled("deck.save-template")).toBe(false);
    kit.host.templates = { list: async () => [], read: async () => "", save: async () => "x" };
    expect(enabled("deck.save-template")).toBe(true);
    await runCommand("slide.save-as-layout", kit);
    expect(kit.ui.state.dialog).toBe("layout-save");
    await runCommand("layout.edit", kit);
    expect(kit.ui.state.layoutDesign).toBe(kit.session.slide.layout);
  });

  it("puts a slide's slots back where its layout has them", async () => {
    const kit = await mountDialogs({ blank: false });
    const made = addSlide(kit.session, kit.ui, { layout: "title-body" })!;
    const title = kit.session.slide.elements[0]!;
    expect(kit.session.slide.id).toBe(made);
    kit.session.elements.transform([{ id: title.id, x: 500, y: 400 }]);
    expect(kit.session.slide.elements[0]!.x).toBe(500);
    await runCommand("slide.reset-layout", kit);
    expect(kit.session.slide.elements[0]!.x).toBeUndefined();
  });
});

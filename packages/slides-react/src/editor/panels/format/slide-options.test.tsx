import { DeckEngine } from "@kasten-slides/wasm";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { newDeck } from "../../../test/engine.ts";
import * as files from "../../files.ts";
import { MemoryHost } from "../../memory-host.ts";
import { EditorSession } from "../../session/session.ts";
import { EditorUi } from "../../ui-state.ts";
import { SidePanel } from "../SidePanel.tsx";
import { edit, mount, pickColor, sections } from "./test-kit.tsx";

vi.mock("../../files.ts", () => ({ pickFiles: vi.fn(), readImage: vi.fn() }));

const pickFiles = vi.mocked(files.pickFiles);
const readImage = vi.mocked(files.readImage);

beforeEach(() => {
  pickFiles.mockReset();
  readImage.mockReset();
  // The host makes a URL for a picture it keeps; the test page has no real blobs to make one of.
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:picture");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** An editor with nothing selected, on a title and body slide. Before it come the title slide a new deck has and a blank one; after it, a title only. */
async function slides() {
  const kit = await mount({ panel: "format" });
  edit(() => {
    const body = kit.session.slides.add({ layout: "title-body" });
    kit.session.slides.add({ layout: "title-only" });
    kit.session.goTo(body as string);
  });
  return kit;
}

const slideOf = (kit: Awaited<ReturnType<typeof mount>>) => kit.session.slide;

describe("Slide options", () => {
  it("are what the panel shows when nothing is selected", async () => {
    const kit = await slides();
    expect(sections()).toEqual(["background", "layout", "transition", "numbers", "theme"]);
    edit(() => kit.session.elements.insert([{ type: "text", id: "", x: 10, y: 10, w: 100, h: 30, text: { paragraphs: [{ runs: [{ t: "Hi" }] }] } } as never]));
    expect(sections()).not.toContain("background");
    edit(() => kit.session.select([]));
    expect(sections()).toContain("background");
  });

  describe("Background", () => {
    it("sets a colour from the palette, and the theme's own with the first entry", async () => {
      const kit = await slides();
      const button = () => screen.getByRole("button", { name: "Background colour" });
      expect(button().textContent).toContain("Theme default");
      pickColor("Background colour", "accent2");
      expect(slideOf(kit).background).toEqual({ color: "accent2" });
      expect(button().textContent).toContain("accent2");
      pickColor("Background colour", "#ff9900");
      expect(slideOf(kit).background).toEqual({ color: "#ff9900" });
      fireEvent.click(button());
      fireEvent.click(screen.getByRole("button", { name: "Theme default" }));
      expect(slideOf(kit).background).toBeUndefined();
      expect(kit.errors).toEqual([]);
    });

    it("changes the slide that is shown, not the others", async () => {
      const kit = await slides();
      pickColor("Background colour", "accent3");
      expect(kit.session.deck.slides.map((s) => s.background)).toEqual([undefined, undefined, { color: "accent3" }, undefined]);
    });

    it("adds an image the host keeps, and a colour after it replaces it", async () => {
      const kit = await slides();
      const file = new File([new Uint8Array([1, 2, 3])], "sky.png", { type: "image/png" });
      pickFiles.mockResolvedValue([file]);
      readImage.mockResolvedValue({ name: "sky.png", bytes: new Uint8Array([1, 2, 3]), size: { w: 10, h: 10 } });
      fireEvent.click(screen.getByRole("button", { name: "Add image…" }));
      await waitFor(() => expect(slideOf(kit).background).toEqual({ image: "assets/sky.png" }));
      expect(pickFiles).toHaveBeenCalledWith("image/*");
      expect(await kit.host.images()).toHaveLength(1);
      expect(screen.getByRole("button", { name: "Background colour" }).textContent).toContain("Picture");
      pickColor("Background colour", "bg2");
      expect(slideOf(kit).background).toEqual({ color: "bg2" });
    });

    it("does nothing when no picture is chosen", async () => {
      const kit = await slides();
      pickFiles.mockResolvedValue([]);
      fireEvent.click(screen.getByRole("button", { name: "Add image…" }));
      await waitFor(() => expect(pickFiles).toHaveBeenCalled());
      await Promise.resolve();
      expect(slideOf(kit).background).toBeUndefined();
      expect(await kit.host.images()).toHaveLength(0);
    });

    it("tells the person when the picture cannot be kept, and changes nothing", async () => {
      const kit = await slides();
      pickFiles.mockResolvedValue([new File([new Uint8Array([1])], "broken.png")]);
      readImage.mockRejectedValue(new Error("not a picture"));
      fireEvent.click(screen.getByRole("button", { name: "Add image…" }));
      await waitFor(() => expect(kit.host.notices).toEqual(["The picture could not be added: not a picture"]));
      expect(slideOf(kit).background).toBeUndefined();
    });

    it("gives the picture to the slide that was shown when the button was pressed", async () => {
      const kit = await slides();
      const second = kit.session.slide.id;
      const first = kit.session.deck.slides[0]!.id;
      let choose: (files: File[]) => void = () => {};
      pickFiles.mockReturnValue(new Promise((resolve) => (choose = resolve)));
      readImage.mockResolvedValue({ name: "sky.png", bytes: new Uint8Array([1]), size: null });
      fireEvent.click(screen.getByRole("button", { name: "Add image…" }));
      edit(() => kit.session.goTo(first));
      choose([new File([new Uint8Array([1])], "sky.png")]);
      await waitFor(() => expect(kit.session.deck.slides.find((s) => s.id === second)?.background).toEqual({ image: "assets/sky.png" }));
      expect(kit.session.deck.slides.find((s) => s.id === first)?.background).toBeUndefined();
    });

    it("resets to the theme's background, and cannot when it already is", async () => {
      const kit = await slides();
      const reset = () => screen.getByRole("button", { name: "Reset" });
      expect(reset().hasAttribute("disabled")).toBe(true);
      pickColor("Background colour", "accent1");
      expect(reset().hasAttribute("disabled")).toBe(false);
      fireEvent.click(reset());
      expect(slideOf(kit).background).toBeUndefined();
      expect(reset().hasAttribute("disabled")).toBe(true);
    });
  });

  describe("Layout", () => {
    it("lists the theme's layouts as pictures with their names, and marks the one the slide has", async () => {
      const kit = await slides();
      const list = screen.getByRole("listbox", { name: "Layouts" });
      const options = within(list).getAllByRole("option");
      expect(options).toHaveLength(12);
      expect(options.map((o) => o.textContent)).toContain("Two columns");
      expect(within(list).getByRole("option", { selected: true }).textContent).toBe("Title + body");
      // Each is a drawing of where its slots are.
      expect(within(list).getByRole("option", { name: /Two columns/ }).querySelectorAll("rect.ks-wf-text")).toHaveLength(3);
      expect(within(list).getByRole("option", { name: /Title \+ image/ }).querySelectorAll("rect.ks-wf-image")).toHaveLength(1);
      expect(within(list).getByRole("option", { name: /Blank/ }).querySelectorAll("rect.ks-wf-text")).toHaveLength(0);
      expect(kit.session.slide.layout).toBe("title-body");
    });

    it("puts the slide on the layout that is clicked", async () => {
      const kit = await slides();
      fireEvent.click(screen.getByRole("option", { name: /Two columns/ }));
      expect(slideOf(kit).layout).toBe("two-columns");
      expect(within(screen.getByRole("listbox", { name: "Layouts" })).getByRole("option", { selected: true }).textContent).toBe("Two columns");
      // The words it held are kept, and the new slots come empty.
      expect(slideOf(kit).elements.map((e) => e.placeholder)).toEqual(expect.arrayContaining(["title", "body", "body2"]));
      expect(kit.errors).toEqual([]);
    });

    it("does not make a step of undo of clicking the layout it has", async () => {
      const kit = await slides();
      const before = kit.session.state.revision;
      fireEvent.click(within(screen.getByRole("listbox", { name: "Layouts" })).getByRole("option", { selected: true }));
      expect(kit.session.state.revision).toBe(before);
    });

    it("puts every slide picked in the filmstrip on the layout, as one step", async () => {
      const kit = await slides();
      const ids = kit.session.deck.slides.map((s) => s.id);
      edit(() => kit.session.selectSlides([ids[2] as string, ids[3] as string], ids[2]));
      const before = kit.session.state.revision;
      fireEvent.click(screen.getByRole("option", { name: /Code/ }));
      expect(kit.session.deck.slides.map((s) => s.layout)).toEqual(["title", "blank", "code", "code"]);
      expect(kit.session.state.revision).toBe(before + 1);
      edit(() => kit.session.undo());
      expect(kit.session.deck.slides.map((s) => s.layout)).toEqual(["title", "blank", "title-body", "title-only"]);
    });
  });

  describe("Keys in the lists", () => {
    it("makes a list one stop for Tab, at the choice, and walks it with the arrows", async () => {
      await slides();
      const list = screen.getByRole("listbox", { name: "Layouts" });
      const options = within(list).getAllByRole("option");
      expect(options.filter((o) => o.tabIndex === 0).map((o) => o.textContent)).toEqual(["Title + body"]);
      options[2]?.focus();
      fireEvent.keyDown(options[2] as HTMLElement, { key: "ArrowDown" });
      expect(document.activeElement).toBe(options[3]);
      fireEvent.keyDown(options[3] as HTMLElement, { key: "ArrowUp" });
      fireEvent.keyDown(options[2] as HTMLElement, { key: "ArrowUp" });
      expect(document.activeElement).toBe(options[1]);
      fireEvent.keyDown(options[1] as HTMLElement, { key: "End" });
      expect(document.activeElement).toBe(options[11]);
      fireEvent.keyDown(options[11] as HTMLElement, { key: "ArrowDown" });
      expect(document.activeElement).toBe(options[11]);
      fireEvent.keyDown(options[11] as HTMLElement, { key: "Home" });
      expect(document.activeElement).toBe(options[0]);
    });

    it("walks the themes in two columns", async () => {
      await slides();
      const options = within(screen.getByRole("listbox", { name: "Theme" })).getAllByRole("option");
      options[0]?.focus();
      fireEvent.keyDown(options[0] as HTMLElement, { key: "ArrowRight" });
      expect(document.activeElement).toBe(options[1]);
      fireEvent.keyDown(options[1] as HTMLElement, { key: "ArrowDown" });
      expect(document.activeElement).toBe(options[3]);
      fireEvent.keyDown(options[3] as HTMLElement, { key: "ArrowLeft" });
      expect(document.activeElement).toBe(options[2]);
    });
  });

  describe("Transition", () => {
    it("says what the slide has, and opens the transitions panel to change it", async () => {
      const kit = await slides();
      const row = screen.getByRole("button", { name: "Change…" }).parentElement as HTMLElement;
      expect(row.textContent).toContain("None");
      fireEvent.click(screen.getByRole("button", { name: "Change…" }));
      expect(kit.ui.state.panel).toBe("transitions");
      expect(kit.ui.state.dialog).toBeNull();
    });

    it("names a transition a deck already holds", async () => {
      const engine = await newDeck("Old");
      const doc = JSON.parse(engine.save());
      doc.slides[0].transition = { kind: "morph", duration: 0.6 };
      const session = new EditorSession(DeckEngine.open(JSON.stringify(doc)), new MemoryHost(), { saveDelay: 60_000 });
      const ui = new EditorUi();
      ui.openPanel("format");
      render(<SidePanel session={session} ui={ui} />);
      expect(screen.getByRole("button", { name: "Change…" }).parentElement?.textContent).toContain("Morph, 0.6 s");
    });
  });

  describe("Slide numbers", () => {
    const toggle = () => screen.getByRole("checkbox", { name: "Show slide numbers" }) as HTMLInputElement;

    it("are off for a new deck, switch on and off for the whole deck, and each is a step of undo", async () => {
      const kit = await slides();
      expect(toggle().checked).toBe(false);
      expect(kit.session.deck.present.slideNumbers).toBe(false);
      fireEvent.click(toggle());
      expect(kit.session.deck.present.slideNumbers).toBe(true);
      expect(toggle().checked).toBe(true);
      expect(kit.session.state.undoLabel).toBe("set_present");
      fireEvent.click(toggle());
      expect(kit.session.deck.present.slideNumbers).toBe(false);
      edit(() => kit.session.undo());
      expect(kit.session.deck.present.slideNumbers).toBe(true);
      expect(toggle().checked).toBe(true);
      expect(kit.errors).toEqual([]);
    });

    it("do not touch the slides", async () => {
      const kit = await slides();
      const before = kit.session.deck.slides;
      fireEvent.click(toggle());
      expect(kit.session.deck.slides).toEqual(before);
    });
  });

  describe("Theme", () => {
    it("offers the built-in themes and checks the deck's", async () => {
      await slides();
      const group = screen.getByRole("listbox", { name: "Theme" });
      const radios = within(group).getAllByRole("option");
      expect(radios.map((r) => r.textContent)).toEqual(["Light", "Dark", "Serif", "Lecture", "Minimal", "Bold", "Modern", "Academic", "Pitch", "Dark Studio", "Warm Paper"]);
      expect(within(group).getByRole("option", { selected: true }).textContent).toBe("Light");
      // Each has a strip of its colours.
      expect(radios.every((r) => r.querySelectorAll(".ks-sp-strip > span").length === 6)).toBe(true);
      expect((radios[1]?.querySelector(".ks-sp-strip > span") as HTMLElement).style.background).toBe("rgb(15, 17, 21)");
    });

    it("applies the theme that is clicked", async () => {
      const kit = await slides();
      fireEvent.click(screen.getByRole("option", { name: "Dark" }));
      expect(kit.session.deck.theme.name).toBe("Dark");
      expect(within(screen.getByRole("listbox", { name: "Theme" })).getByRole("option", { selected: true }).textContent).toBe("Dark");
      expect(kit.session.slide.layout).toBe("title-body");
      // One step, and undo brings the old one back.
      edit(() => kit.session.undo());
      expect(kit.session.deck.theme.name).toBe("Light");
      expect(kit.errors).toEqual([]);
    });

    it("opens the theme dialog to edit it", async () => {
      const kit = await slides();
      fireEvent.click(screen.getByRole("button", { name: "Edit theme…" }));
      expect(kit.ui.state.dialog).toBe("theme");
    });
  });
});

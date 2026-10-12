import type { Element } from "@kasten-slides/wasm";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { withPages } from "../../pages/fake-pages.ts";
import { plainText, textBox } from "../factory.ts";
import { settleFresh } from "../quick-add/fresh.ts";
import { type Kit, mountDialogs } from "./test-kit.tsx";

afterEach(cleanup);

const box = () => screen.getByRole("combobox", { name: "Insert or run a command" }) as HTMLInputElement;
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });
const key = (name: string) => fireEvent.keyDown(box(), { key: name });
const options = () => within(screen.getByRole("listbox")).getAllByRole("option");
// The name is the label's own words; under it, a line says what the thing makes.
const nameOf = (row: HTMLElement | null | undefined) => row?.querySelector(".ks-pl-label")?.firstChild?.textContent;
const names = () => options().map(nameOf);
const activeName = () => nameOf(document.getElementById(box().getAttribute("aria-activedescendant") ?? ""));
const onSlide = (kit: Kit): Element[] => kit.session.slide.elements;

describe("the insert gallery", () => {
  it("opens with the box focused and everything listed under the groups of the Insert menu", async () => {
    await mountDialogs({ dialog: "insert" });
    expect(screen.getByRole("dialog", { name: "Insert gallery" })).toBeTruthy();
    expect(document.activeElement).toBe(box());
    expect(box().getAttribute("aria-expanded")).toBe("true");
    const headings = [...document.querySelectorAll(".ks-pl-head")].map((h) => h.textContent);
    expect(headings).toEqual(["Text & content", "Media", "Shapes & lines", "Data", "Pages & links", "Smart parts", "Slides", "Commands"]);
    const all = names();
    for (const wanted of ["Text box", "Image from computer…", "Table…", "Code block", "Formula", "Conversation", "Token probabilities", "Card grid", "Citation…", "Step label", "Web page…", "Video…", "Rectangle", "Oval", "Right arrow", "Line", "Elbow arrow connector", "Zoom in"]) {
      expect(all, wanted).toContain(wanted);
    }
    expect(all.some((n) => n?.startsWith("New slide: "))).toBe(true);
  });

  it("says what each thing to insert makes, in a line under its name, and shows its keys", async () => {
    await mountDialogs({ dialog: "insert" });
    const row = options().find((o) => nameOf(o) === "Formula");
    expect(row?.querySelector(".ks-pl-desc")?.textContent).toMatch(/LaTeX/);
    expect(options().find((o) => nameOf(o) === "Text box")?.querySelector("kbd")?.textContent).toBe("T");
  });

  it("lists no chart, timer or QR code, which the editor cannot make or change yet", async () => {
    await mountDialogs({ dialog: "insert" });
    for (const name of ["Chart", "Timer", "QR code", "QR code…"]) expect(names()).not.toContain(name);
    type("chart");
    expect(names()).not.toContain("Chart");
  });

  it("lists a page of the vault, and a diagram, only where the host has them", async () => {
    await mountDialogs({ dialog: "insert" });
    expect(names()).not.toContain("Page…");
    expect(names()).not.toContain("Diagram…");
    cleanup();
    const kit = await mountDialogs({ dialog: null });
    withPages(kit.host, []);
    act(() => kit.ui.openDialog("insert"));
    expect(names()).toContain("Page…");
    const page = options().find((o) => nameOf(o) === "Page…");
    expect(page?.querySelector(".ks-pl-desc")?.textContent).toMatch(/vault/);
  });

  it("lists every primitive, every composite, every layout of the theme and no command that inserts (the palette does that itself)", async () => {
    const kit = await mountDialogs({ dialog: "insert" });
    const all = names();
    expect(all.filter((n) => n?.startsWith("New slide: "))).toHaveLength(kit.session.deck.theme.layouts.length);
    // Each command that inserts is a row of the palette, not a second one under Commands.
    const commands = [...document.querySelectorAll('[aria-label="Commands"] .ks-pl-label')].map((n) => n.textContent);
    expect(commands).not.toContain("Code block");
    expect(commands).not.toContain("Table…");
    expect(commands).not.toContain("Text box");
    expect(commands).not.toContain("Insert gallery…");
  });

  it("lists only the commands that can be done now", async () => {
    const kit = await mountDialogs({ dialog: "insert", elements: [textBox({ x: 10, y: 10, w: 100, h: 40 }, "Hi")], select: [] });
    expect(names()).not.toContain("Bring to front");
    cleanup();
    const selected = await mountDialogs({ dialog: "insert", elements: [textBox({ x: 10, y: 10, w: 100, h: 40 }, "Hi")] });
    expect(names()).toContain("Bring to front");
    expect(selected.errors).toEqual([]);
    expect(kit.errors).toEqual([]);
  });

  it("narrows and ranks the list as words are typed, best first, with no headings", async () => {
    await mountDialogs({ dialog: "insert" });
    type("form");
    expect(names()[0]).toBe("Formula");
    expect(document.querySelectorAll(".ks-pl-head")).toHaveLength(0);
    expect(activeName()).toBe("Formula");
    type("equation");
    expect(names()).toEqual(["Formula"]);
    type("zoom");
    expect(names().slice(0, 3)).toEqual(["Zoom in", "Zoom out", "Zoom to fit"]);
  });

  it("says so when nothing matches", async () => {
    await mountDialogs({ dialog: "insert" });
    type("qqqqq");
    expect(screen.getByText("Nothing matches “qqqqq”.")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("No results");
    key("Enter");
    expect(document.querySelector("[role=dialog]")).not.toBeNull();
  });

  it("walks the list with the arrow keys, round the ends, and the box keeps the focus", async () => {
    await mountDialogs({ dialog: "insert" });
    const first = activeName();
    key("ArrowDown");
    expect(activeName()).toBe(names()[1]);
    key("ArrowUp");
    expect(activeName()).toBe(first);
    key("ArrowUp");
    expect(activeName()).toBe(names().at(-1));
    key("ArrowDown");
    expect(activeName()).toBe(first);
    key("PageDown");
    expect(activeName()).toBe(names()[8]);
    key("PageUp");
    expect(activeName()).toBe(first);
    expect(document.activeElement).toBe(box());
    expect(options().filter((o) => o.getAttribute("aria-selected") === "true")).toHaveLength(1);
  });

  it("starts again at the top when the words change", async () => {
    await mountDialogs({ dialog: "insert" });
    key("ArrowDown");
    key("ArrowDown");
    type("c");
    expect(activeName()).toBe(names()[0]);
  });

  it("does the one in view on Enter, and closes first", async () => {
    const kit = await mountDialogs({ dialog: "insert" });
    type("code block");
    key("Enter");
    expect(kit.ui.state.dialog).toBeNull();
    const [made] = onSlide(kit);
    expect(made?.type).toBe("code");
    expect(kit.session.state.selection).toEqual([made?.id]);
    expect(kit.errors).toEqual([]);
  });

  it("does what a click does", async () => {
    const kit = await mountDialogs({ dialog: "insert" });
    type("formula");
    fireEvent.click(options()[0] as HTMLElement);
    expect(onSlide(kit).map((e) => e.type)).toEqual(["math"]);
    expect(kit.ui.state.dialog).toBeNull();
  });

  it("closes on Escape without doing anything", async () => {
    const kit = await mountDialogs({ dialog: "insert" });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(kit.ui.state.dialog).toBeNull();
    expect(onSlide(kit)).toHaveLength(0);
  });

  it("puts each composite on the slide, one undo step each", async () => {
    for (const [words, type] of [["conversation", "chat"], ["token", "token-probs"], ["card grid", "card-grid"], ["step label", "step-label"]] as const) {
      const kit = await mountDialogs({ dialog: "insert" });
      const before = kit.session.state.undoLabel;
      fireEvent.change(box(), { target: { value: words } });
      key("Enter");
      expect(onSlide(kit).map((e) => e.type), words).toEqual([type]);
      kit.session.undo();
      expect(kit.session.state.undoLabel).toBe(before);
      expect(onSlide(kit)).toHaveLength(0);
      cleanup();
    }
  });

  it("asks which works to cite, in a dialog of its own", async () => {
    const kit = await mountDialogs({ dialog: "insert" });
    type("citation");
    key("Enter");
    expect(kit.ui.state.dialog).toBe("citation");
    expect(onSlide(kit)).toHaveLength(0);
  });

  it("asks for an address, for a page or a video, in a dialog of its own", async () => {
    const kit = await mountDialogs({ dialog: "insert" });
    type("web page");
    key("Enter");
    expect(kit.ui.state.dialog).toBe("embed");
    expect(onSlide(kit)).toHaveLength(0);
  });

  it("opens the table dialog, which asks for a size", async () => {
    const kit = await mountDialogs({ dialog: "insert" });
    type("table");
    key("Enter");
    expect(kit.ui.state.dialog).toBe("table");
  });

  it("puts a text box on the slide and opens it for typing", async () => {
    const kit = await mountDialogs({ dialog: "insert" });
    type("text box");
    key("Enter");
    const [made] = onSlide(kit);
    expect(made?.type).toBe("text");
    expect(kit.session.state.editing).toBe(made?.id);
  });

  it("takes that text box away again when it is closed with nothing typed, as the tool and the T key do", async () => {
    const kit = await mountDialogs({ dialog: "insert" });
    type("text box");
    key("Enter");
    const [made] = onSlide(kit);
    act(() => kit.session.stopEditing());
    settleFresh(kit.session, made?.id ?? "");
    expect(onSlide(kit)).toHaveLength(0);
    expect(kit.errors).toEqual([]);
  });

  it("keeps that text box when words were typed in it", async () => {
    const kit = await mountDialogs({ dialog: "insert" });
    type("text box");
    key("Enter");
    const [made] = onSlide(kit);
    kit.session.elements.setText(made?.id ?? "", plainText("Hello"));
    act(() => kit.session.stopEditing());
    settleFresh(kit.session, made?.id ?? "");
    expect(onSlide(kit).map((e) => e.id)).toEqual([made?.id]);
  });

  it("puts a shape on the slide where there is room, selected", async () => {
    const kit = await mountDialogs({ dialog: "insert", elements: [textBox({ x: 40, y: 40, w: 880, h: 90 }, "A title")], select: [] });
    type("rounded rectangle");
    key("Enter");
    const shapes = onSlide(kit).filter((e) => e.type === "shape");
    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toMatchObject({ shape: "roundRect" });
    expect(kit.session.state.selection).toEqual([shapes[0]?.id]);
    // Below the title, not on it.
    expect(shapes[0]?.y).toBeGreaterThanOrEqual(130);
  });

  it("puts a line across the free place", async () => {
    const kit = await mountDialogs({ dialog: "insert" });
    type("elbow arrow");
    key("Enter");
    const lines = onSlide(kit).filter((e) => e.type === "line");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ route: "elbow" });
    expect(lines[0]?.w).toBeGreaterThan(100);
  });

  it("adds a slide on the layout named", async () => {
    const kit = await mountDialogs({ dialog: "insert" });
    const before = kit.session.deck.slides.length;
    type("new slide two columns");
    expect(activeName()).toBe("New slide: Two columns");
    key("Enter");
    expect(kit.session.deck.slides).toHaveLength(before + 1);
    expect(kit.session.slide.layout).toBe("two-columns");
  });

  it("runs a command, and shows its keys", async () => {
    const kit = await mountDialogs({ dialog: "insert" });
    type("zoom in");
    const row = options()[0] as HTMLElement;
    expect(row.querySelector("kbd")?.textContent).toMatch(/Ctrl\+=|⌘=/);
    key("Enter");
    expect(kit.ui.state.zoom).not.toBe("fit");
    expect(kit.ui.state.dialog).toBeNull();
  });

  it("offers the pictures the host holds, and places the one picked", async () => {
    const kit = await mountDialogs({ dialog: null });
    kit.host.images = async () => [{ path: "assets/chart.png", name: "chart.png", width: 800, height: 400 }];
    act(() => kit.ui.openDialog("insert"));
    await waitFor(() => expect(names()).toContain("Image: chart.png"));
    type("chart");
    expect(names()[0]).toBe("Image: chart.png");
    key("Enter");
    const [made] = onSlide(kit);
    expect(made).toMatchObject({ type: "image", src: "assets/chart.png", alt: "chart" });
    expect(kit.session.state.selection).toEqual([made?.id]);
    // At the picture's shape, not stretched to the slide.
    expect((made?.w ?? 1) / (made?.h ?? 1)).toBeCloseTo(2, 1);
  });

  it("has no picture section when the host holds none", async () => {
    await mountDialogs({ dialog: "insert" });
    expect([...document.querySelectorAll(".ks-pl-head")].map((h) => h.textContent)).not.toContain("Images");
  });
});

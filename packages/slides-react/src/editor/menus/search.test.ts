import { describe, expect, it, vi } from "vitest";

import type { MenuItem } from "../ui/Menu.tsx";
import { type MenuHit, flattenMenus, placeOf, searchMenus } from "./search.ts";
import { barMenus } from "./bar-menus.ts";
import { openEditor } from "./testing.ts";

const row = (label: string, extra: Partial<Extract<MenuItem, { id: string }>> = {}): MenuItem => ({ id: label, label, run: vi.fn(), ...extra });

const menus = [
  { label: "File", items: () => [row("New slide", { keys: "Ctrl+M" }), { kind: "separator" } as MenuItem, row("Print", { disabled: true })] },
  {
    label: "Format",
    items: () => [
      { id: "text", label: "Text", items: [row("Bold", { keys: "Ctrl+B", checked: true }), row("Italic"), row("Strikethrough")] },
      row("Clear formatting"),
    ],
  },
  { label: "Slide", items: () => [{ kind: "heading", label: "Slides" } as MenuItem, row("New slide from layout"), row("Delete slide")] },
];

describe("flattening the menus", () => {
  it("lists every row that does something with the menus above it, and leaves out separators and headings", () => {
    const hits = flattenMenus(menus);
    expect(hits.map((hit) => `${placeOf(hit)} › ${hit.label}`)).toEqual([
      "File › New slide",
      "File › Print",
      "Format › Text › Bold",
      "Format › Text › Italic",
      "Format › Text › Strikethrough",
      "Format › Clear formatting",
      "Slide › New slide from layout",
      "Slide › Delete slide",
    ]);
  });

  it("keeps the keys, the check and whether the row can be run", () => {
    const [newSlide, print, bold] = flattenMenus(menus);
    expect(newSlide).toMatchObject({ keys: "Ctrl+M", disabled: false });
    expect(print?.disabled).toBe(true);
    expect(bold).toMatchObject({ keys: "Ctrl+B", checked: true });
  });

  it("calls a row the way its menu does", () => {
    const run = vi.fn();
    const [hit] = flattenMenus([{ label: "File", items: () => [row("Open", { run })] }]);
    hit?.run();
    expect(run).toHaveBeenCalledOnce();
  });

  it("counts everything inside a sub-menu that cannot be used as unusable", () => {
    const hits = flattenMenus([{ label: "Arrange", items: () => [{ id: "order", label: "Order", disabled: true, items: [row("Bring to front")] }] }]);
    expect(hits[0]?.disabled).toBe(true);
  });
});

describe("searching them", () => {
  const hits = flattenMenus(menus);
  const labels = (found: MenuHit[]) => found.map((hit) => hit.label);

  it("finds nothing for nothing", () => {
    expect(searchMenus(hits, "")).toEqual([]);
    expect(searchMenus(hits, "   ")).toEqual([]);
  });

  it("puts a row that starts with the words before one that only holds them", () => {
    expect(labels(searchMenus(hits, "new"))).toEqual(["New slide", "New slide from layout"]);
    expect(labels(searchMenus(hits, "slide"))[0]).toBe("New slide");
  });

  it("puts an exact name first", () => {
    expect(labels(searchMenus(hits, "delete slide"))[0]).toBe("Delete slide");
    expect(labels(searchMenus(hits, "bold"))).toEqual(["Bold"]);
  });

  it("finds a row by the menu it is in", () => {
    expect(labels(searchMenus(hits, "format text"))).toEqual(["Bold", "Italic", "Strikethrough"]);
  });

  it("matches the start of any word, in any case", () => {
    // A word of the row's own name comes before the rows found only through the menu they are in.
    expect(labels(searchMenus(hits, "FORM"))).toEqual(["Clear formatting", "Bold", "Italic", "Strikethrough"]);
    expect(labels(searchMenus(hits, "layout"))).toEqual(["New slide from layout"]);
  });

  it("lists a row that cannot be run after one that can at the same level", () => {
    const two = flattenMenus([{ label: "A", items: () => [row("Print setup", { disabled: true }), row("Print now")] }]);
    expect(labels(searchMenus(two, "print"))).toEqual(["Print now", "Print setup"]);
  });

  it("stops at the limit", () => {
    const many = flattenMenus([{ label: "M", items: () => Array.from({ length: 30 }, (_, i) => row(`Item ${i}`)) }]);
    expect(searchMenus(many, "item").length).toBe(12);
    expect(searchMenus(many, "item", 5).length).toBe(5);
  });

  it("finds nothing for words that are nowhere", () => {
    expect(searchMenus(hits, "zebra")).toEqual([]);
  });
});

describe("the real menus", () => {
  it("find Bold under Format, with its keys, and can run it", async () => {
    const { session, ui } = await openEditor();
    const found = searchMenus(flattenMenus(barMenus({ session, ui })), "bold");
    expect(found[0]).toMatchObject({ label: "Bold", path: ["Format", "Text"] });
    expect(found[0]?.keys).toMatch(/B$/);
  });

  it("find a command by a word of its name, wherever it is", async () => {
    const { session, ui } = await openEditor();
    const all = flattenMenus(barMenus({ session, ui }));
    expect(searchMenus(all, "page setup").map(placeOf)).toContain("File");
    expect(searchMenus(all, "transition").map((hit) => hit.path[0])).toEqual(expect.arrayContaining(["Slide", "View"]));
    expect(searchMenus(all, "present").length).toBeGreaterThan(1);
  });
});

import { describe, expect, it, vi } from "vitest";

import type { MenuItem } from "../ui/Menu.tsx";
import { flattenMenus, placeOf } from "./search.ts";
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

describe("the real menus", () => {
  it("list Bold under Format, with its keys", async () => {
    const { session, ui } = await openEditor();
    const found = flattenMenus(barMenus({ session, ui })).filter((hit) => hit.label === "Bold");
    expect(found[0]).toMatchObject({ label: "Bold", path: ["Format", "Text"] });
    expect(found[0]?.keys).toMatch(/B$/);
  });

  it("list a command wherever it is", async () => {
    const { session, ui } = await openEditor();
    const all = flattenMenus(barMenus({ session, ui }));
    expect(all.filter((hit) => /page setup/i.test(hit.label)).map(placeOf)).toContain("File");
    expect(all.filter((hit) => /transition/i.test(hit.label)).length).toBeGreaterThan(0);
  });
});

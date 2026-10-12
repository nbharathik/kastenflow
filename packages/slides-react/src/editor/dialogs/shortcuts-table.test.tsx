import type { Element } from "@kasten-slides/wasm";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { COMMANDS, showCombo } from "../commands/index.ts";
import { shortcutGroups } from "./ShortcutsDialog.tsx";
import { mountDialogs } from "./test-kit.tsx";

afterEach(cleanup);

const button = (name: string) => screen.getByRole("button", { name });

describe("Keyboard shortcuts", () => {
  it("lists every command that has keys, once, with its keys as they read on this system", async () => {
    await mountDialogs({ dialog: "shortcuts" });
    const withKeys = [...COMMANDS.values()].filter((c) => c.keys && c.keys.length > 0);
    expect(withKeys.length).toBeGreaterThan(30);
    const rows = [...document.querySelectorAll(".ks-dg-keys-group li")];
    expect(rows).toHaveLength(withKeys.length);
    for (const command of withKeys) {
      const row = rows.find((r) => r.querySelector(".ks-dg-keys-label")?.textContent === command.label && [...r.querySelectorAll("kbd")].map((k) => k.textContent).join("|") === command.keys?.map((k) => showCombo(k)).join("|"));
      expect(row, `${command.id} (${command.label})`).toBeTruthy();
    }
  });

  it("does not list a command that has no keys", async () => {
    await mountDialogs({ dialog: "shortcuts" });
    expect(screen.queryByText("Triangle")).toBeNull();
    expect(screen.queryByText("Bring to front")).not.toBeNull();
    expect(screen.queryByText("Group")).not.toBeNull();
    expect(screen.queryByText("Rotate clockwise 90°")).toBeNull();
  });

  it("groups them by the start of the id, in a set order", async () => {
    await mountDialogs({ dialog: "shortcuts" });
    const areas = [...document.querySelectorAll(".ks-dg-keys-area")].map((h) => h.textContent);
    expect(areas).toEqual(["Edit", "Text", "Slides", "Steps", "Arrange", "View", "Embedded page", "File", "Insert", "Help"]);
    expect(within(screen.getByRole("region", { name: "Slides" })).getByText("New slide")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Text" })).getByText("Bold")).toBeTruthy();
    const groups = shortcutGroups();
    expect(groups.flatMap((g) => g.rows).length).toBe([...COMMANDS.values()].filter((c) => c.keys?.length).length);
  });

  it("narrows the list by name as it is typed, and hides an area with nothing left", async () => {
    await mountDialogs({ dialog: "shortcuts" });
    fireEvent.change(screen.getByLabelText("Search shortcuts"), { target: { value: "  ALIGN " } });
    const labels = [...document.querySelectorAll(".ks-dg-keys-label")].map((l) => l.textContent);
    expect(labels.length).toBeGreaterThan(2);
    expect(labels.every((l) => /align/i.test(l ?? ""))).toBe(true);
    expect([...document.querySelectorAll(".ks-dg-keys-area")].map((h) => h.textContent)).toEqual(["Text"]);
    fireEvent.change(screen.getByLabelText("Search shortcuts"), { target: { value: "no such thing" } });
    expect(screen.getByText("No shortcut has that name.")).toBeTruthy();
    expect(document.querySelectorAll(".ks-dg-keys-group")).toHaveLength(0);
  });

  it("lists the keys that add things to the slide, each with its command", async () => {
    await mountDialogs({ dialog: "shortcuts" });
    const insert = within(screen.getByRole("region", { name: "Insert" }));
    for (const [label, key] of [
      ["Text box", "T"],
      ["Rectangle", "R"],
      ["Oval", "O"],
      ["Line", "L"],
      ["Arrow", "A"],
      ["Image from the gallery…", "I"],
    ] as const) {
      const row = insert.getByText(label).closest("li");
      expect(row, label).toBeTruthy();
      expect([...(row?.querySelectorAll("kbd") ?? [])].map((k) => k.textContent), label).toEqual([key]);
    }
  });

  it("says in one line how a block is moved, with the sizes the arrow keys really nudge by", async () => {
    await mountDialogs({ dialog: "shortcuts" });
    expect(screen.getByText("Drag the move handle to move a block; arrow keys nudge by 1, Shift+arrow by 10")).toBeTruthy();
    // It stays when the list is narrowed to nothing.
    fireEvent.change(screen.getByLabelText("Search shortcuts"), { target: { value: "no such thing" } });
    expect(screen.getByText(/Drag the move handle/)).toBeTruthy();
  });

  it("shows keys with an alternative side by side", async () => {
    await mountDialogs({ dialog: "shortcuts" });
    const redo = [...document.querySelectorAll(".ks-dg-keys-group li")].find((r) => r.textContent?.startsWith("Redo"));
    expect([...(redo?.querySelectorAll("kbd") ?? [])].map((k) => k.textContent)).toEqual([showCombo("Mod+Shift+Z"), showCombo("Mod+Y")]);
    expect(redo?.querySelector(".ks-dg-or")?.textContent).toBe("or");
  });
});

describe("Insert table", () => {
  const cell = (columns: number, rows: number) => screen.getByRole("button", { name: `${columns} ${columns === 1 ? "column" : "columns"} by ${rows} ${rows === 1 ? "row" : "rows"}` });
  const tables = (kit: Awaited<ReturnType<typeof mountDialogs>>) => kit.session.slide.elements.filter((e): e is Extract<Element, { type: "table" }> => e.type === "table");

  it("is a grid of eight by eight, that says the size it points at", async () => {
    await mountDialogs({ dialog: "table" });
    expect(document.querySelectorAll(".ks-dg-cell")).toHaveLength(64);
    expect(screen.getByRole("status").textContent).toBe("1 × 1");
    fireEvent.mouseEnter(cell(5, 3));
    expect(screen.getByRole("status").textContent).toBe("5 × 3");
    expect(document.querySelectorAll(".ks-dg-cell.is-in")).toHaveLength(15);
    fireEvent.mouseEnter(cell(8, 8));
    expect(screen.getByRole("status").textContent).toBe("8 × 8");
    expect(document.querySelectorAll(".ks-dg-cell.is-in")).toHaveLength(64);
  });

  it("puts a table of that size in the middle of the slide, selects it, and closes", async () => {
    const kit = await mountDialogs({ dialog: "table" });
    fireEvent.mouseEnter(cell(5, 3));
    fireEvent.click(cell(5, 3));
    const [made] = tables(kit);
    expect(made?.rows).toHaveLength(3);
    expect(made?.columns).toHaveLength(5);
    expect(made?.rows.every((r) => r.cells.length === 5)).toBe(true);
    expect(made?.headerRow).toBe(true);
    // 5 columns of 160 by 3 rows of 44, centred on 960 by 540.
    expect([made?.x, made?.y, made?.w, made?.h]).toEqual([80, 204, 800, 132]);
    expect(kit.session.state.selection).toEqual([made?.id]);
    expect(kit.ui.state.dialog).toBeNull();
    expect(kit.errors).toEqual([]);
  });

  it("keeps a big table inside the slide", async () => {
    const kit = await mountDialogs({ dialog: "table" });
    fireEvent.click(cell(8, 8));
    const [made] = tables(kit);
    // Eight columns would be 1280 wide: the slide less a margin of 64 each side is 832. Eight rows of 44 fit.
    expect([made?.x, made?.y, made?.w, made?.h]).toEqual([64, 94, 832, 352]);
  });

  it("takes the arrow keys and Enter", async () => {
    const kit = await mountDialogs({ dialog: "table" });
    const grid = screen.getByRole("group", { name: "Table size" });
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(screen.getByRole("status").textContent).toBe("3 × 2");
    // Only the place the keys are at can be tabbed to.
    expect(cell(3, 2).getAttribute("tabindex")).toBe("0");
    expect(cell(1, 1).getAttribute("tabindex")).toBe("-1");
    // They stop at the edges.
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    fireEvent.keyDown(grid, { key: "ArrowLeft" });
    expect(screen.getByRole("status").textContent).toBe("2 × 1");
    fireEvent.click(cell(2, 1));
    expect(tables(kit)[0]?.columns).toHaveLength(2);
  });

  it("can be left with Cancel, putting nothing on the slide", async () => {
    const kit = await mountDialogs({ dialog: "table" });
    fireEvent.click(button("Cancel"));
    expect(kit.ui.state.dialog).toBeNull();
    expect(tables(kit)).toHaveLength(0);
  });
});

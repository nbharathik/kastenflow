// The table's click model: one click picks a cell, a double-click (or Enter,
// F2, or typing) edits it. Pickers and ticks keep their one click.

import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/api")>()),
  openUrl: vi.fn(async () => {}),
}));

import * as api from "../../../../lib/api";
import { useWorkspace } from "../../../workspace/store";
import { NOTES, cellOf, openTable, propsOf, taskYaml, titles } from "./testing";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const FLIGHTS = "library/flights.md";
const WITH_LINK = { ...NOTES, [FLIGHTS]: "---\nid: n-flights\ntitle: Book flights\ntags: [task]\nprops:\n  status: Todo\n  points: 5\n  summary: Window seats\n  link: https://example.com/seats\n---\nB\n" };
const open = () => openTable({ "tags/task.yaml": taskYaml(), ...WITH_LINK });
const picked = (cell: HTMLElement) => cell.getAttribute("aria-selected") === "true";

describe("text and number cells", () => {
  it("a click picks the cell, a double-click edits it", async () => {
    const { grid } = await open();
    const cell = cellOf(grid, "Book flights", "summary");
    fireEvent.click(cell);
    expect(picked(cell)).toBe(true);
    expect(screen.queryByRole("textbox", { name: "summary of Book flights" })).toBeNull();
    fireEvent.doubleClick(cell);
    const input = screen.getByRole("textbox", { name: "summary of Book flights" }) as HTMLInputElement;
    expect(input.value).toBe("Window seats");
  });

  it("a number cell behaves the same", async () => {
    const { vault, grid } = await open();
    const cell = cellOf(grid, "Write intro", "points");
    fireEvent.click(cell);
    expect(screen.queryByRole("textbox", { name: "points of Write intro" })).toBeNull();
    fireEvent.doubleClick(cell);
    const input = screen.getByRole("textbox", { name: "points of Write intro" });
    fireEvent.change(input, { target: { value: "8" } });
    await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
    await expect.poll(async () => (await propsOf(vault, "library/intro.md")).points).toBe(8);
  });

  it("Enter and F2 edit the picked cell, and a character replaces its value", async () => {
    const { grid } = await open();
    const cell = cellOf(grid, "Book flights", "summary");
    fireEvent.click(cell);
    fireEvent.keyDown(grid, { key: "F2" });
    expect((screen.getByRole("textbox", { name: "summary of Book flights" }) as HTMLInputElement).value).toBe("Window seats");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "summary of Book flights" }), { key: "Escape" });
    fireEvent.click(cell);
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(screen.getByRole("textbox", { name: "summary of Book flights" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "summary of Book flights" }), { key: "Escape" });
    fireEvent.keyDown(grid, { key: "x" });
    expect((screen.getByRole("textbox", { name: "summary of Book flights" }) as HTMLInputElement).value).toBe("x");
  });
});

describe("a link cell", () => {
  it("a click picks it without opening or editing", async () => {
    const { grid } = await open();
    const cell = cellOf(grid, "Book flights", "link");
    fireEvent.click(within(cell).getByRole("link"));
    expect(picked(cell)).toBe(true);
    expect(api.openUrl).not.toHaveBeenCalled();
    expect(within(cell).queryByRole("textbox")).toBeNull();
  });

  it("a double-click edits the address", async () => {
    const { grid } = await open();
    const cell = cellOf(grid, "Book flights", "link");
    fireEvent.doubleClick(within(cell).getByRole("link"));
    expect((screen.getByRole("textbox", { name: "link of Book flights" }) as HTMLInputElement).value).toBe("https://example.com/seats");
    expect(api.openUrl).not.toHaveBeenCalled();
  });

  it("the arrow button and Ctrl+click open the address", async () => {
    const { grid } = await open();
    const cell = cellOf(grid, "Book flights", "link");
    fireEvent.click(within(cell).getByRole("button", { name: "Open link of Book flights" }));
    expect(api.openUrl).toHaveBeenCalledWith("https://example.com/seats");
    fireEvent.click(within(cell).getByRole("link"), { ctrlKey: true });
    expect(api.openUrl).toHaveBeenCalledTimes(2);
    expect(within(cell).queryByRole("textbox")).toBeNull();
  });
});

describe("the title cell", () => {
  it("a click picks the row's title without opening the note", async () => {
    const { grid } = await open();
    const openPath = vi.fn();
    const real = useWorkspace.getState().openPath;
    useWorkspace.setState({ openPath });
    try {
      const cell = cellOf(grid, "Book flights", "Title");
      fireEvent.click(cell);
      expect(picked(cell)).toBe(true);
      expect(openPath).not.toHaveBeenCalled();
      fireEvent.keyDown(grid, { key: "Enter" });
      fireEvent.keyDown(grid, { key: "Enter", shiftKey: true });
      expect(openPath.mock.calls).toEqual([
        [FLIGHTS, "peek"],
        [FLIGHTS, "here"],
      ]);
    } finally {
      useWorkspace.setState({ openPath: real });
    }
  });

  it("a double-click renames in place, through the workspace's rename", async () => {
    const { vault, grid } = await open();
    fireEvent.doubleClick(cellOf(grid, "Book flights", "Title"));
    const input = screen.getByRole("textbox", { name: "Title of Book flights" }) as HTMLInputElement;
    expect(input.value).toBe("Book flights");
    fireEvent.change(input, { target: { value: "Book trains" } });
    await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
    await expect.poll(async () => (await vault.read(FLIGHTS)).meta.title).toBe("Book trains");
    expect(screen.queryByRole("textbox", { name: "Title of Book flights" })).toBeNull();
    await expect.poll(() => titles(grid)).toContain("Book trains");
  });

  it("Escape and an empty title leave the name as it was", async () => {
    const { vault, grid } = await open();
    fireEvent.doubleClick(cellOf(grid, "Book flights", "Title"));
    let input = screen.getByRole("textbox", { name: "Title of Book flights" });
    fireEvent.change(input, { target: { value: "Nope" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Title of Book flights" })).toBeNull();
    fireEvent.doubleClick(cellOf(grid, "Book flights", "Title"));
    input = screen.getByRole("textbox", { name: "Title of Book flights" });
    fireEvent.change(input, { target: { value: "  " } });
    await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
    expect((await vault.read(FLIGHTS)).meta.title).toBe("Book flights");
  });

  it("F2 renames the picked row", async () => {
    const { grid } = await open();
    fireEvent.click(cellOf(grid, "Book flights", "Title"));
    fireEvent.keyDown(grid, { key: "F2" });
    expect(screen.getByRole("textbox", { name: "Title of Book flights" })).toBeTruthy();
  });

  it("the Open button opens the note beside the table", async () => {
    const { grid } = await open();
    const openPath = vi.fn();
    const real = useWorkspace.getState().openPath;
    useWorkspace.setState({ openPath });
    try {
      fireEvent.click(within(cellOf(grid, "Book flights", "Title")).getByRole("button", { name: /^Open Book flights/ }));
      expect(openPath).toHaveBeenCalledTimes(1);
    } finally {
      useWorkspace.setState({ openPath: real });
    }
  });
});

describe("cells that keep one click", () => {
  it("a choice, a date and a relation open their pickers on a click", async () => {
    const { grid } = await open();
    fireEvent.click(cellOf(grid, "Book flights", "status"));
    expect(screen.getByRole("listbox", { name: "Options" })).toBeTruthy();
    fireEvent.pointerDown(document.body);
    fireEvent.click(cellOf(grid, "Book flights", "due"));
    expect(screen.getByLabelText("due of Book flights")).toBeTruthy();
    fireEvent.keyDown(screen.getByLabelText("due of Book flights"), { key: "Escape" });
    fireEvent.click(cellOf(grid, "Book flights", "blocks"));
    expect(screen.getByRole("textbox", { name: "Find a page" })).toBeTruthy();
  });

  it("a checkbox ticks on a click", async () => {
    const { vault, grid } = await open();
    await act(async () => fireEvent.click(within(cellOf(grid, "Write intro", "urgent")).getByRole("checkbox")));
    await expect.poll(async () => (await propsOf(vault, "library/intro.md")).urgent).toBe(true);
  });
});

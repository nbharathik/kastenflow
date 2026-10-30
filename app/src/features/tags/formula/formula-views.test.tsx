import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FormulaFill } from "../../../lib/vault/types";
import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { useTags } from "../store";
import { TagDatabase } from "../TagDatabase";
import { cellOf, headers, titles } from "../views/table/testing";

afterEach(cleanup);

// days_left = days_until(due): 100 for Write intro, 9 for Book flights, none for Plan budget (no date).
const FILL: FormulaFill = {
  values: {
    "library/intro.md": { left: 100 },
    "library/flights.md": { left: 9 },
    "library/budget.md": { left: null },
  },
  problems: { "library/budget.md": { left: "“due” is not a date, so days_until has nothing to count from" } },
};

const yaml = (view: string) =>
  `name: task\nproperties:\n  - {key: status, type: select, options: [Todo, Doing, Done]}\n  - {key: due, type: date}\n  - {key: left, type: formula, formula: "days_until(due)"}\nviews:\n  - ${view}\n`;

const FILES = {
  "library/intro.md": "---\nid: n-intro\ntitle: Write intro\ntags: [task]\nprops:\n  status: Doing\n  due: 2026-10-02\n---\nA\n",
  "library/flights.md": "---\nid: n-flights\ntitle: Book flights\ntags: [task]\nprops:\n  status: Todo\n  due: 2026-11-01\n---\nB\n",
  "library/budget.md": "---\nid: n-budget\ntitle: Plan budget\ntags: [task]\nprops:\n  status: Done\n---\nC\n",
};

async function open(view: string, fill: FormulaFill = FILL) {
  localStorage.clear();
  const vault = new MemoryVault({ "tags/task.yaml": yaml(view), ...FILES });
  const asked = vi.fn(async (_tag: string, _today: string) => fill);
  vault.tagFormulas = asked;
  useTags.setState({ schemas: null });
  useWorkspace.setState({ place: { view: "tags", path: "#task" }, toasts: [] });
  await useWorkspace.getState().connect({ client: vault });
  render(<TagDatabase tag="task" />);
  await waitFor(() => expect(useTags.getState().schemas).not.toBeNull());
  await act(async () => {});
  return { vault, asked };
}

describe("formula cells in the table", () => {
  it("asks the core for this window's day and shows each value with a calculated cue", async () => {
    const { asked } = await open("{name: All, type: table}");
    const grid = await screen.findByRole("grid");
    await waitFor(() => expect(cellOf(grid, "Write intro", "left").textContent).toBe("100"));
    expect(asked).toHaveBeenCalledWith("task", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    const cell = cellOf(grid, "Book flights", "left");
    expect(cell.textContent).toBe("9");
    expect(cell.getAttribute("aria-readonly")).toBe("true");
    expect(cell.title).toMatch(/Calculated/);
    expect(cell.querySelector(".kasten-formula-cue")).not.toBeNull();
  });

  it("shows an empty cell as empty and an error as a small warning with the sentence, and the row stays", async () => {
    await open("{name: All, type: table}");
    const grid = await screen.findByRole("grid");
    await waitFor(() => expect(within(cellOf(grid, "Plan budget", "left")).getByRole("note")).toBeTruthy());
    const chip = within(cellOf(grid, "Plan budget", "left")).getByRole("note");
    expect(chip.textContent).toContain("is not a date");
    expect(titles(grid)).toContain("Plan budget");
  });

  it("shows a value that is merely missing as an empty cell, with no chip and no cue", async () => {
    await open("{name: All, type: table}", { values: { "library/budget.md": { left: null }, "library/flights.md": { left: 9 } }, problems: {} });
    const grid = await screen.findByRole("grid");
    await waitFor(() => expect(cellOf(grid, "Book flights", "left").textContent).toBe("9"));
    const cell = cellOf(grid, "Plan budget", "left");
    expect(cell.textContent).toBe("");
    expect(cell.querySelector(".kasten-formula-cue")).toBeNull();
    expect(within(cell).queryByRole("note")).toBeNull();
  });

  it("sorts by the number, not the text, and keeps empty last", async () => {
    await open("{name: All, type: table, sort: [{key: left, dir: asc}]}");
    const grid = await screen.findByRole("grid");
    await waitFor(() => expect(titles(grid)).toEqual(["Book flights", "Write intro", "Plan budget"]));
    cleanup();
    await open("{name: All, type: table, sort: [{key: left, dir: desc}]}");
    const down = await screen.findByRole("grid");
    await waitFor(() => expect(titles(down)).toEqual(["Write intro", "Book flights", "Plan budget"]));
  });

  it("filters by 'is more than' on the calculated number", async () => {
    await open("{name: All, type: table, filter: [{key: left, op: gt, value: 50}]}");
    const grid = await screen.findByRole("grid");
    await waitFor(() => expect(titles(grid)).toEqual(["Write intro"]));
  });

  it("never edits a calculated cell: Enter, typing and Delete do nothing", async () => {
    const { vault } = await open("{name: All, type: table, columns: [left, status]}");
    const grid = await screen.findByRole("grid");
    await waitFor(() => expect(cellOf(grid, "Book flights", "left").textContent).toBe("9"));
    expect(headers(grid)).toEqual(["Title", "left", "status"]);
    grid.focus();
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    expect(grid.querySelector('[aria-selected="true"]')).toBe(cellOf(grid, "Book flights", "left"));
    for (const key of ["Enter", "x", "F2", "Delete", "Backspace", " "]) fireEvent.keyDown(grid, { key });
    fireEvent.click(cellOf(grid, "Book flights", "left"));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(grid.querySelector(".is-editing")).toBeNull();
    expect((await vault.read("library/flights.md")).meta.props).toEqual({ status: "Todo", due: "2026-11-01" });
  });

  it("asks again when the notes change", async () => {
    const { vault, asked } = await open("{name: All, type: table}");
    await screen.findByRole("grid");
    const before = asked.mock.calls.length;
    await vault.updateProps("library/flights.md", { due: "2026-12-01" });
    act(() => useWorkspace.setState((s) => ({ notes: s.notes.map((n) => ({ ...n })) })));
    await waitFor(() => expect(asked.mock.calls.length).toBeGreaterThan(before));
  });
});

describe("formula values in the other views", () => {
  it("shows them in a gallery, calculated and read-only, with the error chip for a bad cell", async () => {
    await open("{name: Tiles, type: gallery}");
    await waitFor(() => expect(screen.getByText("100")).toBeTruthy());
    const value = screen.getByText("9");
    expect(value.getAttribute("title")).toMatch(/left: Calculated/);
    expect(value.querySelector(".kasten-formula-cue")).not.toBeNull();
    expect(screen.getByRole("note").textContent).toContain("is not a date");
  });

  it("shows them in a list", async () => {
    await open("{name: Rows, type: list}");
    await waitFor(() => expect(screen.getByText("100")).toBeTruthy());
    expect(screen.getByRole("note").textContent).toContain("is not a date");
  });

  it("shows them on board cards as a chip", async () => {
    await open("{name: Board, type: kanban, group_by: status}");
    await waitFor(() => expect(screen.getByText("left 100")).toBeTruthy());
    expect(screen.getByText("left 9").getAttribute("title")).toMatch(/calculated/);
    expect(screen.getByRole("note").textContent).toContain("is not a date");
  });
});

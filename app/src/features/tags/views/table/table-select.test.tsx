// Picking rows in the table (checkbox, Shift ranges, Space, Shift+arrows, a
// group's checkbox) and the bar that acts on them: every action a batch can
// carry is ONE batch with one Undo; Duplicate and Trash go row by row; Open
// shows a row in the side peek and Shift+Enter in full.

import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useWorkspace } from "../../../workspace/store";
import { fakeBatch, press, toastAction, toasts } from "./select-testing";
import { NOTES, openTable, rowOf, taskYaml, titles } from "./testing";

afterEach(cleanup);

const open = async (view?: string, more: Record<string, string> = {}) => {
  const opened = await openTable({ "tags/task.yaml": taskYaml(view), ...NOTES, ...more });
  return { ...opened, ...fakeBatch(opened.vault) };
};
// Rows by title: Book flights (flights.md), Plan budget (budget.md), Write intro (intro.md).
const box = (grid: HTMLElement, title: string) => within(rowOf(grid, title)).getByRole("checkbox", { name: `Select ${title}` });
const bar = () => screen.getByRole("toolbar", { name: "Selected rows" });
const barText = () => bar().textContent ?? "";
const pickTwo = (grid: HTMLElement) => {
  fireEvent.click(box(grid, "Book flights"));
  fireEvent.click(box(grid, "Plan budget"));
};
const choose = (name: string | RegExp) => fireEvent.click(screen.getByRole("option", { name }));
const push = (name: string) => fireEvent.click(within(bar()).getByRole("button", { name }));

describe("picking rows", () => {
  it("ticks a row with its checkbox and shows the bar; the note is not opened", async () => {
    const { grid } = await open();
    const openPath = vi.fn();
    const real = useWorkspace.getState().openPath;
    useWorkspace.setState({ openPath });
    try {
      expect(screen.queryByRole("toolbar", { name: "Selected rows" })).toBeNull();
      fireEvent.click(box(grid, "Plan budget"));
      expect(barText()).toContain("1 selected");
      expect(rowOf(grid, "Plan budget").getAttribute("aria-selected")).toBe("true");
      expect(rowOf(grid, "Book flights").getAttribute("aria-selected")).toBeNull();
      expect(openPath).not.toHaveBeenCalled();
      fireEvent.click(box(grid, "Plan budget"));
      expect(screen.queryByRole("toolbar", { name: "Selected rows" })).toBeNull();
    } finally {
      useWorkspace.setState({ openPath: real });
    }
  });

  it("picks a range with Shift-click", async () => {
    const { grid } = await open();
    fireEvent.click(box(grid, "Book flights"));
    fireEvent.click(box(grid, "Write intro"), { shiftKey: true });
    expect(barText()).toContain("3 selected");
    // The range takes the anchor's state: from a row just cleared, the range clears.
    fireEvent.click(box(grid, "Plan budget"));
    expect(barText()).toContain("2 selected");
    fireEvent.click(box(grid, "Write intro"), { shiftKey: true });
    expect(barText()).toContain("1 selected");
    expect(rowOf(grid, "Book flights").getAttribute("aria-selected")).toBe("true");
  });

  it("picks the active row with Space on its title, and Shift+arrows pick a run", async () => {
    const { grid } = await open();
    grid.focus();
    press(grid, "ArrowDown");
    press(grid, " ");
    expect(rowOf(grid, "Book flights").getAttribute("aria-selected")).toBe("true");
    press(grid, " ");
    expect(screen.queryByRole("toolbar", { name: "Selected rows" })).toBeNull();
    press(grid, "ArrowDown", { shiftKey: true });
    expect(barText()).toContain("2 selected");
    // The active cell went down with it.
    expect(grid.querySelector('[role="rowheader"][aria-selected="true"]')?.textContent).toContain("Plan budget");
    press(grid, "ArrowDown", { shiftKey: true });
    expect(barText()).toContain("3 selected");
    press(grid, "ArrowUp", { shiftKey: true });
    expect(barText()).toContain("2 selected");
    expect(rowOf(grid, "Write intro").getAttribute("aria-selected")).toBeNull();
  });

  it("leaves Space alone on the other cells, where it edits", async () => {
    const { grid } = await open("{name: All, type: table, columns: [summary]}");
    grid.focus();
    press(grid, "ArrowDown");
    press(grid, "ArrowRight");
    press(grid, " ");
    expect(screen.queryByRole("toolbar", { name: "Selected rows" })).toBeNull();
    expect(within(grid).getByRole("textbox")).toBeTruthy();
  });

  it("selects every row from the bar, and Escape lets go", async () => {
    const { grid } = await open();
    fireEvent.click(box(grid, "Plan budget"));
    push("Select all 3");
    expect(barText()).toContain("3 selected");
    expect(within(bar()).queryByRole("button", { name: /Select all/ })).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("toolbar", { name: "Selected rows" })).toBeNull();
    fireEvent.click(box(grid, "Plan budget"));
    push("Clear selection");
    expect(screen.queryByRole("toolbar", { name: "Selected rows" })).toBeNull();
  });

  it("picks a whole group from its header, and takes it off again", async () => {
    const extra = { "library/extra.md": "---\nid: n-extra\ntitle: Extra\ntags: [task]\nprops:\n  status: Doing\n---\nX\n" };
    const { grid } = await open("{name: G, type: table, group_by: status, columns: [status]}", extra);
    // Groups follow the property's options: Todo, Doing, Done.
    expect([...grid.querySelectorAll(".kasten-table-title")].map((e) => e.textContent)).toEqual(["Book flights", "Extra", "Write intro", "Plan budget"]);
    const doing = within(grid).getByRole("checkbox", { name: "Select all in Doing" }) as HTMLInputElement;
    fireEvent.click(doing);
    expect(barText()).toContain("2 selected");
    expect(rowOf(grid, "Extra").getAttribute("aria-selected")).toBe("true");
    expect(doing.checked).toBe(true);
    fireEvent.click(box(grid, "Extra"));
    expect(doing.indeterminate).toBe(true);
    fireEvent.click(doing);
    expect(barText()).toContain("2 selected");
    fireEvent.click(doing);
    expect(screen.queryByRole("toolbar", { name: "Selected rows" })).toBeNull();
  });

  it("picks the active row's whole group with Ctrl+Shift+Space, and lets go with it again", async () => {
    const extra = { "library/extra.md": "---\nid: n-extra\ntitle: Extra\ntags: [task]\nprops:\n  status: Doing\n---\nX\n" };
    const { grid } = await open("{name: G, type: table, group_by: status, columns: [status]}", extra);
    grid.focus();
    press(grid, "ArrowDown");
    press(grid, "ArrowDown");
    // Ctrl+Shift+Space on a row of "Doing".
    press(grid, " ", { ctrlKey: true, shiftKey: true });
    expect(barText()).toContain("2 selected");
    expect(rowOf(grid, "Extra").getAttribute("aria-selected")).toBe("true");
    press(grid, " ", { ctrlKey: true, shiftKey: true });
    expect(screen.queryByRole("toolbar", { name: "Selected rows" })).toBeNull();
  });

  it("keeps a shut group's rows picked", async () => {
    const { grid } = await open("{name: G, type: table, group_by: status, columns: [status]}");
    fireEvent.click(within(grid).getByRole("checkbox", { name: "Select all in Doing" }));
    fireEvent.click(within(grid).getByRole("button", { name: "Collapse the group Doing" }));
    expect(barText()).toContain("1 selected");
  });
});

describe("the bar's actions are one batch each", () => {
  it("sets a property on the picked rows: one batch, one notice, one Undo", async () => {
    const { grid, runBatch, undoCommit } = await open();
    pickTwo(grid);
    push("Set property…");
    choose(/^status/);
    choose("Doing");
    await waitFor(() => expect(runBatch).toHaveBeenCalledTimes(1));
    expect(runBatch.mock.calls[0]![0]).toEqual([
      { kind: "update_props", path: "library/flights.md", props: { status: "Doing" } },
      { kind: "update_props", path: "library/budget.md", props: { status: "Doing" } },
    ]);
    await waitFor(() => expect(toasts().at(-1)).toBe("Set status to Doing on 2 rows"));
    // The selection stays, so another property can be set on the same rows.
    expect(barText()).toContain("2 selected");
    expect(toastAction()?.label).toBe("Undo");
    await act(async () => toastAction()!.run());
    expect(undoCommit).toHaveBeenCalledTimes(1);
    expect(undoCommit).toHaveBeenCalledWith("c1");
    await waitFor(() => expect(toasts().at(-1)).toBe("Took back the change to status"));
    expect(runBatch).toHaveBeenCalledTimes(1);
  });

  it("reads a typed value by the property's type and says when it does not fit", async () => {
    const { grid, runBatch } = await open();
    pickTwo(grid);
    push("Set property…");
    choose(/^points/);
    const field = screen.getByRole("textbox", { name: "Set points" });
    fireEvent.change(field, { target: { value: "lots" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(toasts().at(-1)).toBe("“lots” is not a number.");
    expect(runBatch).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "8" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(runBatch).toHaveBeenCalledTimes(1));
    expect(runBatch.mock.calls[0]![0]).toEqual([
      { kind: "update_props", path: "library/flights.md", props: { points: 8 } },
      { kind: "update_props", path: "library/budget.md", props: { points: 8 } },
    ]);
  });

  it("clears a property", async () => {
    const { grid, runBatch } = await open();
    pickTwo(grid);
    push("Set property…");
    choose(/^status/);
    choose(/^Clear status/);
    await waitFor(() => expect(runBatch).toHaveBeenCalledTimes(1));
    expect(runBatch.mock.calls[0]![0]).toEqual([
      { kind: "update_props", path: "library/flights.md", props: { status: null } },
      { kind: "update_props", path: "library/budget.md", props: { status: null } },
    ]);
  });

  it("adds a tag, and takes one off", async () => {
    const { grid, runBatch } = await open();
    pickTwo(grid);
    push("Add tag…");
    choose(/^#idea/);
    await waitFor(() => expect(runBatch).toHaveBeenCalledTimes(1));
    expect(runBatch.mock.calls[0]![0]).toEqual([
      { kind: "tags", path: "library/flights.md", add: ["idea"], remove: [] },
      { kind: "tags", path: "library/budget.md", add: ["idea"], remove: [] },
    ]);
    await waitFor(() => expect(toasts().at(-1)).toBe("Tagged 2 rows #idea"));
    push("Remove tag…");
    choose(/#task/);
    await waitFor(() => expect(runBatch).toHaveBeenCalledTimes(2));
    expect(runBatch.mock.calls[1]![0]).toEqual([
      { kind: "tags", path: "library/flights.md", add: [], remove: ["task"] },
      { kind: "tags", path: "library/budget.md", add: [], remove: ["task"] },
    ]);
  });

  it("makes a new tag from what is typed", async () => {
    const { grid, runBatch } = await open();
    pickTwo(grid);
    push("Add tag…");
    const field = screen.getByRole("textbox", { name: "Add tag" });
    fireEvent.change(field, { target: { value: "fresh" } });
    choose("Add #fresh");
    await waitFor(() => expect(runBatch).toHaveBeenCalledTimes(1));
    expect(runBatch.mock.calls[0]![0]).toEqual([
      { kind: "tags", path: "library/flights.md", add: ["fresh"], remove: [] },
      { kind: "tags", path: "library/budget.md", add: ["fresh"], remove: [] },
    ]);
  });

  it("says so, and changes nothing, when the rows are already where they would go", async () => {
    const { grid, runBatch } = await open();
    pickTwo(grid);
    push("Move to…");
    choose(/Pages/);
    await waitFor(() => expect(toasts().at(-1)).toBe("Nothing to change: the picked rows are already like that."));
    expect(runBatch).not.toHaveBeenCalled();
  });

  it("adds the rows to a board in one change", async () => {
    const { grid, vault, runBatch } = await open();
    vi.spyOn(vault, "boards").mockResolvedValue([{ path: "boards/plan.canvas", title: "Plan", project: null, nodes: 0, modified: 0 }]);
    pickTwo(grid);
    push("Add to board…");
    await act(async () => {});
    choose("Plan");
    await waitFor(() => expect(runBatch).toHaveBeenCalledTimes(1));
    expect(runBatch.mock.calls[0]![0]).toEqual([{ kind: "add_to_board", board: "boards/plan.canvas", notes: ["library/flights.md", "library/budget.md"], layout: "grid" }]);
    await waitFor(() => expect(toasts().at(-1)).toBe("Added 2 rows to “Plan”"));
    // These rows are done with: the selection goes.
    expect(screen.queryByRole("toolbar", { name: "Selected rows" })).toBeNull();
  });

  it("tells a refusal in one plain sentence, changes nothing and keeps the selection", async () => {
    const { grid, runBatch } = await open();
    runBatch.mockRejectedValueOnce(new Error('Change 2 of 2 (update_props): No property called "zzz". Nothing in the batch was changed.'));
    pickTwo(grid);
    push("Set property…");
    choose(/^status/);
    choose("Done");
    await waitFor(() => expect(toasts().at(-1)).toBe('Nothing was changed: no property called "zzz".'));
    expect(barText()).toContain("2 selected");
  });

  it("holds back more than a batch takes, and offers the first hundred", async () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 101; i++) many[`library/m${String(i).padStart(3, "0")}.md`] = `---\nid: n-m${i}\ntitle: M ${String(i).padStart(3, "0")}\ntags: [task]\n---\nM\n`;
    const { grid, runBatch } = await open("{name: All, type: table}", many);
    fireEvent.click(box(grid, "Book flights"));
    push("Select all 104");
    expect(barText()).toContain("104 selected");
    push("Set property…");
    choose(/^status/);
    choose("Done");
    await waitFor(() => expect(toasts().at(-1)).toBe("You can change up to 100 rows at once and this would change 103. Pick fewer and try again."));
    expect(runBatch).not.toHaveBeenCalled();
    expect(toastAction()?.label).toBe("Keep the first 100");
    act(() => toastAction()!.run());
    expect(barText()).toContain("100 selected");
  });
});

describe("the two actions a batch cannot carry", () => {
  it("duplicates row by row, with one notice and one Undo", async () => {
    const { grid, runBatch } = await open();
    pickTwo(grid);
    push("Duplicate");
    await waitFor(() => expect(titles(grid)).toContain("Plan budget (copy)"));
    expect(titles(grid)).toContain("Book flights (copy)");
    expect(runBatch).not.toHaveBeenCalled();
    expect(toasts().at(-1)).toBe("Made 2 copies of 2 rows");
    expect(screen.queryByRole("toolbar", { name: "Selected rows" })).toBeNull();
    await act(async () => toastAction()!.run());
    await waitFor(() => expect(titles(grid)).toEqual(["Book flights", "Plan budget", "Write intro"]));
  });

  it("trashes up to five rows at once, and Undo brings them back", async () => {
    const { grid } = await open();
    pickTwo(grid);
    push("Trash");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(titles(grid)).toEqual(["Write intro"]));
    expect(toasts().at(-1)).toBe("Moved 2 rows to the trash");
    await act(async () => toastAction()!.run());
    await waitFor(() => expect(titles(grid)).toEqual(["Book flights", "Plan budget", "Write intro"]));
  });

  it("asks before trashing more than five, and only for trash", async () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 4; i++) many[`library/t${i}.md`] = `---\nid: n-t${i}\ntitle: T${i}\ntags: [task]\n---\nT\n`;
    const { grid, runBatch } = await open("{name: All, type: table}", many);
    fireEvent.click(box(grid, "Book flights"));
    push("Select all 7");
    // Other actions never ask.
    push("Add tag…");
    choose(/^#idea/);
    await waitFor(() => expect(runBatch).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    push("Trash");
    const ask = await screen.findByRole("alertdialog", { name: "Move 7 rows to the trash?" });
    fireEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
    expect(titles(grid)).toHaveLength(7);
    push("Trash");
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Move to trash" }));
    await waitFor(() => expect(within(grid).queryAllByRole("rowheader")).toHaveLength(0));
  });
});

describe("opening a row", () => {
  it("shows it in the side peek from its Open button, and in full with Shift+Enter", async () => {
    const { grid } = await open();
    const openPath = vi.fn();
    const real = useWorkspace.getState().openPath;
    useWorkspace.setState({ openPath });
    try {
      fireEvent.click(within(rowOf(grid, "Book flights")).getByRole("button", { name: "Open Book flights beside the table" }));
      grid.focus();
      press(grid, "ArrowDown");
      press(grid, "Enter", { shiftKey: true });
      press(grid, "Enter");
      expect(openPath.mock.calls).toEqual([
        ["library/flights.md", "peek-side"],
        ["library/flights.md", "here"],
        ["library/flights.md", "peek"],
      ]);
    } finally {
      useWorkspace.setState({ openPath: real });
    }
  });
});

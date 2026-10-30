// Putting rows in order by hand (drag by the grip, Alt+↑/↓; only while the view
// has no sort) and pasting a block of cells from a spreadsheet: each is ONE
// batch, one commit, one Undo.

import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ORDER_TYPE } from "./row-tools";
import { dragData, fakeBatch, paste, press, toastAction, toasts } from "./select-testing";
import { NOTES, openTable, rowOf, taskYaml, titles } from "./testing";

afterEach(cleanup);

const open = async (view?: string, more: Record<string, string> = {}) => {
  const opened = await openTable({ "tags/task.yaml": taskYaml(view), ...NOTES, ...more });
  return { ...opened, ...fakeBatch(opened.vault) };
};
const grips = () => screen.queryAllByRole("button", { name: /^Move / });
// Rows by title: Book flights (n-flights), Plan budget (n-budget), Write intro (n-intro).

describe("rows in order by hand", () => {
  it("offers a grip on each row while the view has no sort", async () => {
    await open();
    expect(grips().map((g) => g.getAttribute("aria-label"))).toEqual(["Move Book flights", "Move Plan budget", "Move Write intro"]);
  });

  it("offers none when the view sorts, groups or shows sub-items, and Alt+arrows do nothing", async () => {
    for (const view of ["{name: S, type: table, sort: [{key: status, dir: asc}]}", "{name: G, type: table, group_by: status}", "{name: T, type: table, sub_items: true}"]) {
      const { grid, runBatch } = await open(view);
      expect(grips()).toEqual([]);
      grid.focus();
      press(grid, "ArrowDown");
      press(grid, "ArrowDown", { altKey: true });
      expect(runBatch).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("moves the active row down with Alt+↓: one batch with the whole new order, one Undo", async () => {
    const { grid, runBatch, undoCommit } = await open();
    grid.focus();
    press(grid, "ArrowDown");
    press(grid, "ArrowDown", { altKey: true });
    await waitFor(() => expect(runBatch).toHaveBeenCalledTimes(1));
    expect(runBatch.mock.calls[0]![0]).toEqual([{ kind: "set_view_order", tag: "task", view: "All", ids: ["n-budget", "n-flights", "n-intro"] }]);
    await waitFor(() => expect(titles(grid)).toEqual(["Plan budget", "Book flights", "Write intro"]));
    await waitFor(() => expect(toasts().at(-1)).toBe("Moved “Book flights”"));
    // The active cell went with its row, so the next Alt+↓ moves the same row again.
    press(grid, "ArrowDown", { altKey: true });
    await waitFor(() => expect(runBatch).toHaveBeenCalledTimes(2));
    expect(runBatch.mock.calls[1]![0]).toEqual([{ kind: "set_view_order", tag: "task", view: "All", ids: ["n-budget", "n-intro", "n-flights"] }]);
    await act(async () => toastAction()!.run());
    expect(undoCommit).toHaveBeenCalledWith("c1");
  });

  it("moves up with Alt+↑, and at the ends does nothing", async () => {
    const { grid, runBatch } = await open();
    grid.focus();
    press(grid, "ArrowDown");
    press(grid, "ArrowUp", { altKey: true });
    expect(runBatch).not.toHaveBeenCalled();
    press(grid, "ArrowDown");
    press(grid, "ArrowDown");
    press(grid, "ArrowUp", { altKey: true });
    await waitFor(() => expect(runBatch).toHaveBeenCalledTimes(1));
    expect(runBatch.mock.calls[0]![0]).toEqual([{ kind: "set_view_order", tag: "task", view: "All", ids: ["n-flights", "n-intro", "n-budget"] }]);
  });

  it("reorders by dragging a grip onto another row, above or below it", async () => {
    const { grid, runBatch } = await open();
    const drag = dragData();
    fireEvent.dragStart(within(rowOf(grid, "Write intro")).getByRole("button", { name: "Move Write intro" }), { dataTransfer: drag });
    expect(drag.types).toContain(ORDER_TYPE);
    expect(drag.getData(ORDER_TYPE)).toBe("library/intro.md");
    const over = rowOf(grid, "Book flights");
    fireEvent.dragOver(over, { dataTransfer: drag, clientY: 0 });
    expect(over.getAttribute("data-drop")).toBe("before");
    fireEvent.drop(over, { dataTransfer: drag, clientY: 0 });
    expect(over.getAttribute("data-drop")).toBeNull();
    await waitFor(() => expect(runBatch).toHaveBeenCalledTimes(1));
    expect(runBatch.mock.calls[0]![0]).toEqual([{ kind: "set_view_order", tag: "task", view: "All", ids: ["n-intro", "n-flights", "n-budget"] }]);
    await waitFor(() => expect(titles(grid)).toEqual(["Write intro", "Book flights", "Plan budget"]));
  });

  it("leaves other drags alone", async () => {
    const { grid, runBatch } = await open();
    const other = dragData();
    other.setData("text/plain", "something");
    const over = rowOf(grid, "Book flights");
    fireEvent.dragOver(over, { dataTransfer: other });
    expect(over.getAttribute("data-drop")).toBeNull();
    fireEvent.drop(over, { dataTransfer: other });
    expect(runBatch).not.toHaveBeenCalled();
  });

  it("puts the old order back, with a sentence, when the core refuses", async () => {
    const { grid, runBatch } = await open();
    runBatch.mockRejectedValueOnce(new Error("Change 1 of 1 (set_view_order): No view called All. Nothing in the batch was changed."));
    grid.focus();
    press(grid, "ArrowDown");
    press(grid, "ArrowDown", { altKey: true });
    await waitFor(() => expect(toasts().at(-1)).toBe("Nothing was changed: no view called All."));
    await waitFor(() => expect(titles(grid)).toEqual(["Book flights", "Plan budget", "Write intro"]));
  });

  it("says so when a page has no id yet", async () => {
    const { grid, runBatch } = await open("{name: All, type: table}", { "library/loose.md": "---\ntitle: Loose\ntags: [task]\n---\nL\n" });
    grid.focus();
    press(grid, "ArrowDown");
    press(grid, "ArrowDown", { altKey: true });
    expect(toasts().at(-1)).toBe("Some of these pages have no id yet, so the rows cannot be put in order by hand here.");
    expect(runBatch).not.toHaveBeenCalled();
  });

  it("follows the order the view keeps, with new rows after", async () => {
    const { grid } = await open("{name: All, type: table, order: [n-intro, n-budget]}");
    expect(titles(grid)).toEqual(["Write intro", "Plan budget", "Book flights"]);
  });

  it("ignores the kept order while the view sorts", async () => {
    const { grid } = await open("{name: All, type: table, order: [n-intro, n-budget], sort: [{key: title, dir: asc}]}");
    expect(titles(grid)).toEqual(["Book flights", "Plan budget", "Write intro"]);
  });
});

describe("pasting from a spreadsheet", () => {
  const start = (grid: HTMLElement, rights = 0) => {
    grid.focus();
    press(grid, "ArrowDown");
    for (let i = 0; i < rights; i++) press(grid, "ArrowRight");
  };

  it("fills a 20 by 5 block in ONE batch: three rows changed, seventeen made", async () => {
    const { grid, runBatch, undoCommit } = await open();
    const lines = Array.from({ length: 20 }, (_, i) => [`Task ${i}`, i % 2 ? "Done" : "Todo", `2026-10-${String(i + 1).padStart(2, "0")}`, String(i), i % 3 ? "no" : "yes"].join("\t"));
    start(grid);
    paste(grid, `${lines.join("\r\n")}\r\n`);
    await waitFor(() => expect(runBatch).toHaveBeenCalledTimes(1));
    const changes = runBatch.mock.calls[0]![0];
    expect(changes.filter((c) => c.kind === "create_note")).toHaveLength(17);
    expect(changes.filter((c) => c.kind === "rename")).toHaveLength(3);
    expect(changes.length).toBeLessThanOrEqual(100);
    expect(changes.find((c) => c.kind === "create_note")).toEqual({
      kind: "create_note",
      type: "page",
      title: "Task 3",
      tags: ["task"],
      props: { status: "Done", due: "2026-10-04", points: 3, urgent: true },
    });
    await waitFor(() => expect(toasts().at(-1)).toBe("Pasted 20 rows (17 new)"));
    await act(async () => toastAction()!.run());
    expect(undoCommit).toHaveBeenCalledWith("c1");
    expect(runBatch).toHaveBeenCalledTimes(1);
  });

  it("reads quoted cells with tabs and line breaks, and CRLF line ends", async () => {
    const { grid, runBatch } = await open("{name: P, type: table, columns: [summary, status]}");
    start(grid, 1);
    paste(grid, '"two\nlines"\tDone\r\n"a\tb"\tTodo\r\n');
    await waitFor(() => expect(runBatch).toHaveBeenCalledTimes(1));
    expect(runBatch.mock.calls[0]![0]).toEqual([
      { kind: "update_props", path: "library/flights.md", props: { summary: "two\nlines", status: "Done" } },
      { kind: "update_props", path: "library/budget.md", props: { summary: "a\tb", status: "Todo" } },
    ]);
  });

  it("reads CSV text too", async () => {
    const { grid, runBatch } = await open("{name: P, type: table, columns: [status, points]}");
    start(grid, 1);
    paste(grid, "Done,7\nDoing,8\n");
    await waitFor(() => expect(runBatch).toHaveBeenCalledTimes(1));
    expect(runBatch.mock.calls[0]![0]).toEqual([
      { kind: "update_props", path: "library/flights.md", props: { status: "Done", points: 7 } },
      { kind: "update_props", path: "library/budget.md", props: { status: "Doing", points: 8 } },
    ]);
  });

  it("leaves a value that does not fit empty and names it, filling the rest", async () => {
    const { grid, runBatch } = await open("{name: P, type: table, columns: [status, points]}");
    start(grid, 1);
    paste(grid, "Done\tabc");
    await waitFor(() => expect(runBatch).toHaveBeenCalledTimes(1));
    expect(runBatch.mock.calls[0]![0]).toEqual([{ kind: "update_props", path: "library/flights.md", props: { status: "Done" } }]);
    await waitFor(() => expect(toasts().at(-1)).toBe("Pasted 1 row. 1 value did not fit and was left empty: “abc” in points"));
  });

  it("changes nothing when nothing fits", async () => {
    const { grid, runBatch } = await open("{name: P, type: table, columns: [points]}");
    start(grid, 1);
    paste(grid, "abc");
    expect(runBatch).not.toHaveBeenCalled();
    expect(toasts().at(-1)).toBe("Nothing was pasted. 1 value did not fit and was left empty: “abc” in points");
  });

  it("skips a column that cannot take a paste and says so", async () => {
    const { grid, runBatch } = await open("{name: P, type: table, columns: [status, blocks]}");
    start(grid, 1);
    paste(grid, "Done\tsome note");
    await waitFor(() => expect(runBatch).toHaveBeenCalledTimes(1));
    expect(runBatch.mock.calls[0]![0]).toEqual([{ kind: "update_props", path: "library/flights.md", props: { status: "Done" } }]);
    await waitFor(() => expect(toasts().at(-1)).toBe("Pasted 1 row. Skipped blocks: they are calculated, linked or read-only"));
  });

  it("asks before pasting more than one batch holds, and pastes the first part in one batch", async () => {
    const { grid, runBatch } = await open("{name: P, type: table, columns: [status]}");
    start(grid, 1);
    // Book flights is Todo, Plan budget already Done, Write intro Doing: two change, then 98 new rows fit.
    paste(grid, Array.from({ length: 150 }, () => "Done").join("\n"));
    expect(runBatch).not.toHaveBeenCalled();
    expect(toasts().at(-1)).toBe("One paste holds up to 100 changes, so 101 of these 150 rows fit. Paste those?");
    expect(toastAction()?.label).toBe("Paste the first 101");
    await act(async () => toastAction()!.run());
    await waitFor(() => expect(runBatch).toHaveBeenCalledTimes(1));
    expect(runBatch.mock.calls[0]![0]).toHaveLength(100);
    await waitFor(() => expect(toasts().at(-1)).toBe("Pasted 101 of 150 rows (98 new)"));
  });

  it("asks before making more than twenty new pages, and makes none until told", async () => {
    const { grid, runBatch } = await open("{name: P, type: table, columns: [status]}");
    start(grid, 0);
    // Three rows exist; 40 lines make 37 new pages.
    paste(grid, Array.from({ length: 40 }, (_, i) => `Line ${i}`).join("\n"));
    expect(runBatch).not.toHaveBeenCalled();
    expect(toasts().at(-1)).toBe("This paste would make 37 new pages. Make them?");
    expect(toastAction()?.label).toBe("Make 37 pages");
    await act(async () => toastAction()!.run());
    await waitFor(() => expect(runBatch).toHaveBeenCalledTimes(1));
    expect(runBatch.mock.calls[0]![0].filter((c) => c.kind === "create_note")).toHaveLength(37);
  });

  it("refuses more than a thousand rows in one plain sentence", async () => {
    const { grid, runBatch } = await open("{name: P, type: table, columns: [status]}");
    start(grid, 1);
    paste(grid, Array.from({ length: 1001 }, () => "Done").join("\n"));
    expect(runBatch).not.toHaveBeenCalled();
    expect(toasts().at(-1)).toBe("A paste can hold up to 1,000 rows and this one has 1,001. Paste it in smaller parts.");
  });

  it("asks for a cell to start from when none is active", async () => {
    const { grid, runBatch } = await open();
    paste(grid, "Done");
    expect(runBatch).not.toHaveBeenCalled();
    expect(toasts().at(-1)).toBe("Click the cell where the pasted cells should start, then paste.");
  });

  it("leaves a paste into an open editor to the editor", async () => {
    const { grid, runBatch } = await open("{name: P, type: table, columns: [summary]}");
    start(grid, 1);
    press(grid, "Enter");
    const input = within(grid).getByRole("textbox");
    paste(input, "typed text");
    expect(runBatch).not.toHaveBeenCalled();
  });
});

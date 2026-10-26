// Everything on at once: groups, sub-items, a sort, a filter and a picked set
// of rows. Each feature is tested alone elsewhere; this pins how they meet.

import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { usePrefs } from "../../../workspace/prefs";
import { fakeBatch, press, toasts } from "./select-testing";
import { count, openTable, rowOf, taskYaml } from "./testing";

afterEach(cleanup);
beforeEach(() => usePrefs.setState({ subItemsOpen: {} }));

const note = (id: string, title: string, props: string, parent?: string) => `---\nid: n-${id}\ntitle: ${title}\n${parent ? `parent: n-${parent}\n` : ""}tags: [task]\nprops:\n${props}---\nB\n`;
const FILES: Record<string, string> = {
  "library/epic.md": note("epic", "Epic", "  status: Doing\n  points: 8\n"),
  "library/s1.md": note("s1", "Story one", "  status: Todo\n  points: 2\n", "epic"),
  "library/s2.md": note("s2", "Story two", "  status: Done\n  points: 0\n", "epic"),
  "library/solo.md": note("solo", "Solo", "  status: Todo\n  points: 4\n"),
  "library/zero.md": note("zero", "Zero", "  status: Todo\n  points: 0\n"),
  "library/quiet.md": note("quiet", "Quiet parent", "  status: Done\n"),
  "library/loud.md": note("loud", "Loud child", "  status: Done\n  points: 9\n", "quiet"),
};
const VIEW = "{name: Both, type: table, sub_items: true, group_by: status, columns: [status, points], sort: [{key: points, dir: desc}], filter: [{key: points, op: gt, value: 0}]}";

async function open() {
  const opened = await openTable({ "tags/task.yaml": taskYaml(VIEW), ...FILES });
  return { ...opened, ...fakeBatch(opened.vault) };
}
const names = (grid: HTMLElement) => [...grid.querySelectorAll(".kasten-table-title")].map((e) => e.textContent);
const heads = (grid: HTMLElement) => [...grid.querySelectorAll(".kasten-table-group-name")].map((e) => e.textContent);
const counts = (grid: HTMLElement) => [...grid.querySelectorAll(".kasten-table-group-count")].map((e) => e.textContent);
const bar = () => screen.getByRole("toolbar", { name: "Selected rows" });

describe("groups, sub-items, a sort, a filter and a selection together", () => {
  it("groups the top-level rows, hides what the filter hides, and greys a parent only kept for its match", async () => {
    const { grid } = await open();
    expect(heads(grid)).toEqual(["Todo", "Doing", "Done"]);
    // Sub-items are shut: the epic's children and the quiet parent's child wait inside.
    expect(names(grid)).toEqual(["Solo", "Epic", "Quiet parent", "Loud child"]);
    expect(rowOf(grid, "Quiet parent").classList.contains("is-dim")).toBe(true);
    expect(rowOf(grid, "Loud child").classList.contains("is-dim")).toBe(false);
    // Zero and Story two do not match the filter: the foot counts matching rows only.
    expect(count()).toBe("4 notes");
    expect(counts(grid).length).toBe(3);
  });

  it("opens a parent in its group and sorts its children by the view's sort", async () => {
    const { grid } = await open();
    fireEvent.click(screen.getByRole("button", { name: "Expand the sub-items of Epic" }));
    // Story one matches; Story two (0 points) does not.
    expect(names(grid)).toEqual(["Solo", "Epic", "Story one", "Quiet parent", "Loud child"]);
  });

  it("picks rows across groups and sub-items; the bar counts only the rows listed, and one batch changes exactly those", async () => {
    const { grid, runBatch } = await open();
    fireEvent.click(screen.getByRole("button", { name: "Expand the sub-items of Epic" }));
    fireEvent.click(within(rowOf(grid, "Story one")).getByRole("checkbox", { name: "Select Story one" }));
    fireEvent.click(within(grid).getByRole("checkbox", { name: "Select all in Done" }));
    // Done holds only Loud child among the matching rows (the quiet parent is shown for it).
    expect(bar().textContent).toContain("2 selected");
    fireEvent.click(within(bar()).getByRole("button", { name: /Select all/ }));
    expect(bar().textContent).toContain(`${names(grid).filter((n) => n !== "Quiet parent").length} selected`);
    fireEvent.click(within(bar()).getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByRole("toolbar", { name: "Selected rows" })).toBeNull();
    fireEvent.click(within(rowOf(grid, "Story one")).getByRole("checkbox", { name: "Select Story one" }));
    fireEvent.click(within(rowOf(grid, "Solo")).getByRole("checkbox", { name: "Select Solo" }));
    fireEvent.click(within(bar()).getByRole("button", { name: "Add tag…" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Add tag" }), { target: { value: "fresh" } });
    fireEvent.click(await screen.findByRole("option", { name: "Add #fresh" }));
    await expect.poll(() => runBatch.mock.calls.length).toBe(1);
    const sent = runBatch.mock.calls[0]![0] as { kind: string; path: string }[];
    expect(sent.map((c) => c.kind)).toEqual(["tags", "tags"]);
    expect(sent.map((c) => c.path).sort()).toEqual(["library/s1.md", "library/solo.md"]);
    await expect.poll(() => toasts().at(-1)).toBe("Tagged 2 rows #fresh");
  });

  it("has no drag handles or Alt+arrows for the order with a sort, groups or sub-items on", async () => {
    const { grid, runBatch } = await open();
    expect(grid.querySelector('[aria-label^="Move "]')).toBeNull();
    grid.focus();
    press(grid, "ArrowDown");
    press(grid, "ArrowDown", { altKey: true });
    expect(runBatch).not.toHaveBeenCalled();
  });
});

// The table with groups, calculations and display settings: group headers
// (order, counts, folding, keys, sub-items inside a group), the calculations
// row and its menu, and the view bar's group, display, sort-order and
// match-any controls, all saved with the view.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { usePrefs } from "../../../workspace/prefs";
import { NOTES, count, openTable, savedView, taskYaml } from "./testing";

afterEach(cleanup);
beforeEach(() => usePrefs.setState({ subItemsOpen: {} }));

const LOOSE = { "library/loose.md": "---\ntitle: Loose\ntags: [task]\nprops:\n  points: 4\n---\nL\n" };
const open = (view: string, more: Record<string, string> = {}) => openTable({ "tags/task.yaml": taskYaml(view), ...NOTES, ...LOOSE, ...more });

const heads = (grid: HTMLElement) => [...grid.querySelectorAll(".kasten-table-group-name")].map((e) => e.textContent);
const counts = (grid: HTMLElement) => [...grid.querySelectorAll(".kasten-table-group-count")].map((e) => e.textContent);
/** The rows' titles, group headers left out. */
const rowTitles = (grid: HTMLElement) => [...grid.querySelectorAll(".kasten-table-title")].map((e) => e.textContent);
const headRow = (grid: HTMLElement, label: string) => [...grid.querySelectorAll<HTMLElement>(".kasten-table-group")].find((r) => r.querySelector(".kasten-table-group-name")?.textContent === label)!;
const press = (grid: HTMLElement, key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(grid, { key, ...init });
const view = async (vault: Parameters<typeof savedView>[0]) => savedView(vault);

describe("a grouped table", () => {
  it("groups by a select in the order of its options, with the notes without a value last", async () => {
    const { grid } = await open("{name: G1, type: table, group_by: status, columns: [status, points]}");
    expect(heads(grid)).toEqual(["Todo", "Doing", "Done", "No value"]);
    expect(counts(grid)).toEqual(["1", "1", "1", "1"]);
    expect(rowTitles(grid)).toEqual(["Book flights", "Write intro", "Plan budget", "Loose"]);
    // Headers are rows of the grid: they count in its size, and the foot still counts the notes.
    expect(grid.getAttribute("aria-rowcount")).toBe("9");
    expect(count()).toBe("4 notes");
  });

  it("groups a checkbox and a date by month", async () => {
    const checks = await open("{name: G2, type: table, group_by: urgent, columns: [urgent]}");
    expect(heads(checks.grid)).toEqual(["Checked", "Not checked"]);
    expect(counts(checks.grid)).toEqual(["1", "3"]);
    cleanup();
    const dates = await open("{name: G3, type: table, group_by: due, columns: [due]}");
    expect(heads(dates.grid)).toHaveLength(2);
    expect(heads(dates.grid)[0]).toMatch(/2026/);
    expect(heads(dates.grid)[1]).toBe("No value");
    expect(counts(dates.grid)).toEqual(["1", "3"]);
  });

  it("folds a group shut from its header, remembers it, and opens it again", async () => {
    const first = await open("{name: G4, type: table, group_by: status, columns: [status]}");
    fireEvent.click(screen.getByRole("button", { name: "Collapse the group Todo" }));
    expect(rowTitles(first.grid)).toEqual(["Write intro", "Plan budget", "Loose"]);
    // The header stays, with its count; the foot still counts every note.
    expect(heads(first.grid)).toEqual(["Todo", "Doing", "Done", "No value"]);
    expect(headRow(first.grid, "Todo").getAttribute("aria-expanded")).toBe("false");
    expect(count()).toBe("4 notes");
    cleanup();
    const again = await open("{name: G4, type: table, group_by: status, columns: [status]}");
    expect(rowTitles(again.grid)).toEqual(["Write intro", "Plan budget", "Loose"]);
    fireEvent.click(screen.getByRole("button", { name: "Expand the group Todo" }));
    expect(rowTitles(again.grid)).toEqual(["Book flights", "Write intro", "Plan budget", "Loose"]);
  });

  it("folds the active row's group with Ctrl+Shift+Up and opens every group with Ctrl+Shift+Down", async () => {
    const { grid } = await open("{name: G5, type: table, group_by: status, columns: [status]}");
    grid.focus();
    press(grid, "ArrowDown");
    expect(grid.querySelector('[aria-selected="true"]')?.textContent).toContain("Book flights");
    press(grid, "ArrowUp", { ctrlKey: true, shiftKey: true });
    expect(rowTitles(grid)).toEqual(["Write intro", "Plan budget", "Loose"]);
    press(grid, "ArrowDown", { ctrlKey: true, shiftKey: true });
    expect(rowTitles(grid)).toEqual(["Book flights", "Write intro", "Plan budget", "Loose"]);
  });

  it("moves down over the notes, not the headers", async () => {
    const { grid } = await open("{name: G6, type: table, group_by: status, columns: [status]}");
    grid.focus();
    press(grid, "ArrowDown");
    press(grid, "ArrowDown");
    expect(grid.querySelector('[aria-selected="true"]')?.textContent).toContain("Write intro");
  });

  it("folds or opens every group from a header's menu", async () => {
    const { grid } = await open("{name: G7, type: table, group_by: status, columns: [status]}");
    fireEvent.contextMenu(headRow(grid, "Doing"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Collapse all groups/ }));
    expect(rowTitles(grid)).toEqual([]);
    expect(heads(grid)).toHaveLength(4);
    fireEvent.contextMenu(headRow(grid, "Doing"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Expand all groups/ }));
    expect(rowTitles(grid)).toHaveLength(4);
  });

  it("keeps sub-items under their parent, in the parent's group", async () => {
    const stories = {
      "library/epic.md": "---\nid: n-epic\ntitle: Epic\ntags: [task]\nprops:\n  status: Doing\n---\nE\n",
      "library/s1.md": "---\nid: n-s1\ntitle: Story one\nparent: n-epic\ntags: [task]\nprops:\n  status: Todo\n---\nS\n",
      "library/s2.md": "---\nid: n-s2\ntitle: Story two\nparent: n-epic\ntags: [task]\nprops:\n  status: Done\n---\nS\n",
      "library/solo.md": "---\nid: n-solo\ntitle: Solo\ntags: [task]\nprops:\n  status: Todo\n---\nS\n",
    };
    const { grid } = await openTable({ "tags/task.yaml": taskYaml("{name: G8, type: table, sub_items: true, group_by: status, columns: [status]}"), ...stories });
    expect(heads(grid)).toEqual(["Todo", "Doing"]);
    // The children count in the parent's group, folded or not.
    expect(counts(grid)).toEqual(["1", "3"]);
    fireEvent.click(screen.getByRole("button", { name: "Expand the sub-items of Epic" }));
    expect(rowTitles(grid)).toEqual(["Solo", "Epic", "Story one", "Story two"]);
    fireEvent.click(screen.getByRole("button", { name: "Collapse the group Doing" }));
    expect(rowTitles(grid)).toEqual(["Solo"]);
  });
});

describe("the calculations row", () => {
  it("is not there until the view has calculations", async () => {
    const { grid } = await open("{name: C1, type: table, columns: [points]}");
    expect(grid.querySelector(".kasten-table-calcs")).toBeNull();
  });

  it("calculates over the filtered rows, and per group in the headers", async () => {
    const { grid } = await open("{name: C2, type: table, group_by: status, columns: [status, points], calcs: {points: sum, status: unique}}");
    const foot = grid.querySelector<HTMLElement>(".kasten-table-calcs")!;
    expect(within(foot).getByRole("button", { name: /points: Sum 12/ })).toBeTruthy();
    expect(within(foot).getByRole("button", { name: /status: Unique 3/ })).toBeTruthy();
    expect(within(headRow(grid, "Todo")).getByText("Sum 5")).toBeTruthy();
    expect(within(headRow(grid, "No value")).getByText("Sum 4")).toBeTruthy();
    cleanup();
    const filtered = await open("{name: C3, type: table, columns: [points], filter: [{key: status, op: is, value: Todo}], calcs: {points: max}}");
    expect(within(filtered.grid.querySelector<HTMLElement>(".kasten-table-calcs")!).getByRole("button", { name: /Max 5/ })).toBeTruthy();
  });

  it("is chosen from the foot cell's menu and saved with the view", async () => {
    const { vault, grid } = await open("{name: C4, type: table, columns: [points, status], calcs: {}, mine: 1}");
    const foot = grid.querySelector<HTMLElement>(".kasten-table-calcs")!;
    fireEvent.click(within(foot).getByRole("button", { name: "Calculate points" }));
    // A number offers sums; a text-like select offers counts only.
    expect(screen.getByRole("menuitemradio", { name: "Median" })).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("menuitemradio", { name: "Average" })));
    await expect.poll(async () => (await view(vault)).calcs).toEqual({ points: "average" });
    expect((await view(vault)).mine).toBe(1);
    expect(within(foot).getByRole("button", { name: /points: Avg 4/ })).toBeTruthy();
    fireEvent.click(within(foot).getByRole("button", { name: "Calculate status" }));
    expect(screen.queryByRole("menuitemradio", { name: "Average" })).toBeNull();
    expect(screen.getByRole("menuitemradio", { name: "Count unique values" })).toBeTruthy();
  });

  it("starts from a column's menu, which shows the row", async () => {
    const { vault, grid } = await open("{name: C5, type: table, columns: [points]}");
    fireEvent.click(screen.getByTitle("points · Number"));
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: "Calculate" })));
    await expect.poll(async () => (await view(vault)).calcs).toEqual({ points: "sum" });
    expect(grid.querySelector(".kasten-table-calcs")).not.toBeNull();
  });
});

describe("the view bar's table settings", () => {
  it("groups from the Group menu and from a column's menu, and ungroups", async () => {
    const { vault } = await open("{name: B1, type: table, columns: [status]}");
    fireEvent.click(screen.getByRole("button", { name: /^Group by: Group/ }));
    await act(async () => fireEvent.click(screen.getByRole("option", { name: "status" })));
    await expect.poll(async () => (await view(vault)).group_by).toBe("status");
    fireEvent.click(screen.getByTitle("status · Select"));
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: "Remove grouping" })));
    await expect.poll(async () => (await view(vault)).group_by).toBeUndefined();
  });

  it("wraps cells and sets the row height from the Display menu", async () => {
    const { vault, grid } = await open("{name: B2, type: table, columns: [status]}");
    const table = grid.closest<HTMLElement>(".kasten-table")!;
    expect(table.className).not.toMatch(/is-wrap|is-compact|is-loose/);
    fireEvent.click(screen.getByRole("button", { name: /Display options/ }));
    await act(async () => fireEvent.click(screen.getByText("Wrap cells")));
    await expect.poll(async () => (await view(vault)).wrap).toBe(true);
    await waitFor(() => expect(table.className).toContain("is-wrap"));
    fireEvent.click(screen.getByRole("button", { name: /Display options/ }));
    await act(async () => fireEvent.click(screen.getByText("Compact")));
    await expect.poll(async () => (await view(vault)).density).toBe("compact");
    expect(table.className).toContain("is-compact");
    expect(table.style.getPropertyValue("--row-h")).toBe("46px");
  });

  it("styles the view's settings: density, wrap and a loose title column", async () => {
    const compact = await open("{name: B3, type: table, columns: [status], density: compact}");
    const table = compact.grid.closest<HTMLElement>(".kasten-table")!;
    expect(table.style.getPropertyValue("--row-h")).toBe("28px");
    cleanup();
    const loose = await open("{name: B4, type: table, columns: [status], freeze_title: false, wrap: true}");
    const other = loose.grid.closest<HTMLElement>(".kasten-table")!;
    expect(other.className).toContain("is-loose");
    expect(other.className).toContain("is-wrap");
    expect(other.style.getPropertyValue("--row-h")).toBe("56px");
  });

  it("changes the order of several sorts with Alt and the arrow keys", async () => {
    const { vault } = await open("{name: B5, type: table, columns: [status, points], sort: [{key: status, dir: asc}, {key: points, dir: desc}]}");
    await act(async () => fireEvent.keyDown(screen.getByRole("button", { name: "Sort status descending" }), { key: "ArrowRight", altKey: true }));
    await expect.poll(async () => (await view(vault)).sort).toEqual([
      { key: "points", dir: "desc" },
      { key: "status", dir: "asc" },
    ]);
    // Past either end nothing moves.
    await act(async () => fireEvent.keyDown(screen.getByRole("button", { name: "Sort points ascending" }), { key: "ArrowUp", altKey: true }));
    expect((await view(vault)).sort?.[0]?.key).toBe("points");
  });

  it("changes the order of sorts by dragging", async () => {
    const { vault } = await open("{name: B6, type: table, columns: [status, points], sort: [{key: status, dir: asc}, {key: points, dir: desc}]}");
    const chips = () => screen.getAllByRole("button", { name: /^Sort / }).map((b) => b.closest("span")!);
    const transfer = { setData() {}, effectAllowed: "" };
    const [first, second] = chips();
    fireEvent.dragStart(first!, { dataTransfer: transfer });
    fireEvent.dragOver(second!, { dataTransfer: transfer });
    await act(async () => void fireEvent.drop(second!, { dataTransfer: transfer }));
    await expect.poll(async () => (await view(vault)).sort?.map((s) => s.key)).toEqual(["points", "status"]);
  });

  it("matches any of several filters when asked", async () => {
    const { vault, grid } = await open("{name: B7, type: table, columns: [status], filter: [{key: status, op: is, value: Todo}, {key: status, op: is, value: Done}]}");
    expect(rowTitles(grid)).toEqual([]);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Notes match all filters; change to any" })));
    await expect.poll(async () => (await view(vault)).filter_mode).toBe("any");
    expect(rowTitles(grid).sort()).toEqual(["Book flights", "Plan budget"]);
    expect(screen.getByRole("button", { name: "Notes match any filter; change to all" }).textContent).toBe("Match any");
  });
});

describe("the stylesheet", () => {
  const root = [join(process.cwd(), "src"), join(process.cwd(), "app", "src")].find((dir) => {
    try {
      readFileSync(join(dir, "main.tsx"));
      return true;
    } catch {
      return false;
    }
  })!;
  const css = (path: string) => readFileSync(join(root, path), "utf8");

  it("sticks the title column to the left and the header to the top, and lets a view loosen the column", () => {
    const table = css("features/tags/views/table/table.css");
    expect(table).toMatch(/\.kasten-table-cell\.is-title\s*\{[^}]*position:\s*sticky;[^}]*left:\s*0/);
    expect(table).toMatch(/\.kasten-table-head\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0/);
    expect(css("features/tags/views/table/group.css")).toMatch(/\.kasten-table\.is-loose[^{]*\{[^}]*position:\s*static/);
  });
});

// A grouped table with calculations at 10,000 notes: group headers are rows of
// the windowed list, so only a screenful is drawn however many groups there
// are, and folding a group redraws the window, not the notes.

import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ROW_HEIGHT } from "./context";
import { openTable, taskYaml } from "./testing";

afterEach(cleanup);

const STATUSES = ["Todo", "Doing", "Done"];

/** A `task` tag with `n` notes spread over the three statuses and a number. */
function bigTag(n: number): Record<string, string> {
  const files: Record<string, string> = { "tags/task.yaml": taskYaml("{name: Big, type: table, group_by: status, columns: [status, points], calcs: {points: sum, status: unique}}") };
  for (let i = 0; i < n; i++) {
    files[`library/t${String(i).padStart(5, "0")}.md`] = `---\ntitle: Task ${i}\ntags: [task]\nprops:\n  status: ${STATUSES[i % 3]}\n  points: ${i % 13}\n---\nBody ${i}\n`;
  }
  return files;
}

describe("a grouped table of 10,000 notes", () => {
  it("draws a window of rows and headers, keeping the full height", async () => {
    const started = performance.now();
    const { grid } = await openTable(bigTag(10_000));
    const opened = performance.now() - started;
    // 3 group headers and 10,000 rows, plus the column header and the calculations row.
    expect(grid.getAttribute("aria-rowcount")).toBe("10005");
    const drawn = within(grid).getAllByRole("row").length - 2;
    expect(drawn).toBeGreaterThan(10);
    expect(drawn).toBeLessThan(60);
    const body = grid.querySelector<HTMLElement>(".kasten-table-body")!;
    expect(parseFloat(body.style.paddingTop) + drawn * ROW_HEIGHT + parseFloat(body.style.paddingBottom)).toBe(10_003 * ROW_HEIGHT);
    expect([...grid.querySelectorAll(".kasten-table-group-count")].map((e) => e.textContent)).toEqual([(3334).toLocaleString()]);
    // jsdom is slow; a real window is many times quicker. The same 20 s the other tables are allowed.
    expect(opened).toBeLessThan(20_000);
  });

  it("folds a group of 3,333 notes in well under the budget and keeps drawing a window", async () => {
    const { grid } = await openTable(bigTag(10_000));
    const started = performance.now();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Collapse the group Todo" })));
    const took = performance.now() - started;
    expect(grid.getAttribute("aria-rowcount")).toBe("6671");
    expect(within(grid).getAllByRole("row").length - 2).toBeLessThan(60);
    expect(took).toBeLessThan(5_000);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Expand the group Todo" })));
    expect(grid.getAttribute("aria-rowcount")).toBe("10005");
  });
});

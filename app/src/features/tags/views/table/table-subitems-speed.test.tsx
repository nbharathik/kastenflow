// The table with sub-items at 10,000 notes in three levels (100 epics, each
// with 9 stories of 10 tasks): the window runs over the visible rows only,
// so shut or fully open it draws a screenful, and opening one row redraws
// only the rows in view.

import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePrefs } from "../../../workspace/prefs";
import type { CellProps } from "./Cell";
import { ROW_HEIGHT } from "./context";
import { expandAll } from "./open-rows";
import { openTable, taskYaml, titles } from "./testing";

const counter = vi.hoisted(() => ({ cells: 0 }));

vi.mock("./Cell", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./Cell")>();
  const { createElement } = await import("react");
  return {
    ...actual,
    Cell: (props: CellProps) => {
      counter.cells++;
      return createElement(actual.Cell, props);
    },
  };
});

beforeEach(() => usePrefs.setState({ subItemsOpen: {} }));
afterEach(cleanup);

const COLUMNS = 3;
const pad = (n: number) => String(n).padStart(2, "0");

/** 100 epics "E00".., each with 9 stories "E00-S0".., each with 10 tasks "E00-S0-T00"..: 10,000 notes. */
function bigTree(): { files: Record<string, string>; ids: string[] } {
  const files: Record<string, string> = { "tags/task.yaml": taskYaml("{name: Tree, type: table, sub_items: true, columns: [status, points]}") };
  const ids: string[] = [];
  const note = (id: string, title: string, parent: string | null, n: number) => {
    files[`library/${id}.md`] = `---\nid: ${id}\ntitle: ${title}\n${parent ? `parent: ${parent}\n` : ""}tags: [task]\nprops:\n  status: Todo\n  points: ${n % 13}\n---\nB\n`;
  };
  for (let e = 0; e < 100; e++) {
    const epic = `e${pad(e)}`;
    note(epic, `E${pad(e)}`, null, e);
    ids.push(epic);
    for (let s = 0; s < 9; s++) {
      const story = `${epic}s${s}`;
      note(story, `E${pad(e)}-S${s}`, epic, s);
      ids.push(story);
      for (let t = 0; t < 10; t++) note(`${story}t${pad(t)}`, `E${pad(e)}-S${s}-T${pad(t)}`, story, t);
    }
  }
  return { files, ids };
}

describe("a table of 10,000 notes with sub-items", () => {
  it("draws a window of the visible rows, shut or open, keeping the full height", async () => {
    const { files, ids } = bigTree();
    const started = performance.now();
    const { grid } = await openTable(files);
    const opened = performance.now() - started;
    const drawn = () => within(grid).getAllByRole("row").length - 1;
    // Shut: the 100 epics only.
    expect(grid.getAttribute("aria-rowcount")).toBe("101");
    expect(drawn()).toBeLessThan(60);
    expect(titles(grid)[0]).toBe("E00");
    // jsdom is slow; a real window is many times quicker. The same 20 s the 2,000-note table is allowed.
    expect(opened).toBeLessThan(20_000);

    // Open: every epic and story, 10,000 rows.
    const openStarted = performance.now();
    await act(async () => expandAll("task|Tree", ids));
    const reopened = performance.now() - openStarted;
    expect(grid.getAttribute("aria-rowcount")).toBe("10001");
    expect(drawn()).toBeLessThan(60);
    const body = grid.querySelector<HTMLElement>(".kasten-table-body")!;
    expect(parseFloat(body.style.paddingTop) + drawn() * ROW_HEIGHT + parseFloat(body.style.paddingBottom)).toBe(10_000 * ROW_HEIGHT);
    expect(titles(grid).slice(0, 3)).toEqual(["E00", "E00-S0", "E00-S0-T00"]);
    expect(reopened).toBeLessThan(10_000);
  });

  it("opens and shuts one row without redrawing more than the window", async () => {
    const { files } = bigTree();
    const { grid } = await openTable(files);
    counter.cells = 0;
    const started = performance.now();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Expand the sub-items of E00" })));
    const took = performance.now() - started;
    expect(titles(grid).slice(0, 3)).toEqual(["E00", "E00-S0", "E00-S1"]);
    // At most the rows in view (plus overscan) redraw, never the 10,000.
    expect(counter.cells).toBeLessThanOrEqual(60 * COLUMNS);
    expect(took).toBeLessThan(5_000);
  });
});

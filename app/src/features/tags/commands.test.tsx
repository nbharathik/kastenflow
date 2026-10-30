// The database commands of the palette: offered only where a part of the
// database is on screen, and acting on that part.

import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TagSchema, TagView } from "../../lib/vault/types";
import { databaseCommands } from "./commands";
import { useFrontActions, type FrontActions } from "./in-front";
import { ViewBar } from "./ViewBar";

afterEach(cleanup);

const schema: TagSchema = {
  name: "task",
  color: null,
  path: "tags/task.yaml",
  views: [],
  properties: [{ key: "status", type: "select", options: ["Todo", "Done"] }],
};
const ids = () => databaseCommands().map((c) => c.id);
const offered = (id: string) => {
  const command = databaseCommands().find((c) => c.id === id);
  return command !== undefined && (command.when?.() ?? true);
};
const get = (id: string) => databaseCommands().find((c) => c.id === id)!;

function bar(view: TagView, onChange = vi.fn()) {
  render(<ViewBar view={view} schema={schema} shown={1} total={1} onChange={onChange} />);
  return onChange;
}

describe("database commands", () => {
  it("offer nothing when no database is on screen", () => {
    expect(databaseCommands().filter((c) => c.when?.() ?? true)).toEqual([]);
  });

  it("table: calculations and sub-items change the saved view", async () => {
    const onChange = bar({ name: "All", type: "table" });
    expect(offered("table-calcs")).toBe(true);
    expect(offered("table-sub-items")).toBe(true);
    get("table-sub-items").run();
    expect(onChange).toHaveBeenLastCalledWith({ name: "All", type: "table", sub_items: true });
    get("table-calcs").run();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    expect(onChange.mock.calls[1]![0].calcs).toEqual({});
  });

  it("table: group by each property it can group by, and remove grouping only while grouped", async () => {
    const onChange = bar({ name: "All", type: "table" });
    expect(ids()).toContain("table-group-by-status");
    expect(ids()).toContain("table-group-by-created");
    expect(offered("table-group-none")).toBe(false);
    databaseCommands().find((c) => c.id === "table-group-by-status")!.run();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith({ name: "All", type: "table", group_by: "status" }));
    cleanup();
    const again = bar({ name: "All", type: "table", group_by: "status" });
    expect(offered("table-group-none")).toBe(true);
    get("table-group-none").run();
    await vi.waitFor(() => expect(again).toHaveBeenCalledWith({ name: "All", type: "table" }));
  });

  it("is not offered for other kinds of view", () => {
    bar({ name: "Board", type: "kanban", group_by: "status" });
    expect(offered("table-calcs")).toBe(false);
    expect(ids().filter((id) => id.startsWith("table-group-by-"))).toEqual([]);
  });

  it("table and timeline parts register while mounted and leave when unmounted", () => {
    const table: FrontActions["table"] = { selectAll: vi.fn(), moveRow: vi.fn() };
    const timeline: FrontActions["timeline"] = { today: vi.fn(), setScale: vi.fn() };
    function Parts() {
      const a = useRef<HTMLDivElement>(null);
      const b = useRef<HTMLDivElement>(null);
      useFrontActions("table", a, table);
      useFrontActions("timeline", b, timeline);
      return (
        <>
          <div ref={a} />
          <div ref={b} />
        </>
      );
    }
    const { unmount } = render(<Parts />);
    expect(offered("table-select-all")).toBe(true);
    get("table-select-all").run();
    expect(table.selectAll).toHaveBeenCalled();
    get("table-row-down").run();
    expect(table.moveRow).toHaveBeenCalledWith(1);
    get("timeline-today").run();
    expect(timeline.today).toHaveBeenCalled();
    get("timeline-scale-week").run();
    expect(timeline.setScale).toHaveBeenCalledWith("week");
    unmount();
    expect(offered("table-select-all")).toBe(false);
    expect(offered("timeline-today")).toBe(false);
  });
});

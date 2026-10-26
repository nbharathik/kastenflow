import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TagSchema, TagView } from "../../lib/vault/types";
import { ViewBar } from "./ViewBar";

afterEach(cleanup);

const schema: TagSchema = {
  name: "task",
  color: null,
  path: "tags/task.yaml",
  views: [],
  properties: [
    { key: "status", type: "select", options: ["todo", "done"] },
    { key: "stage", type: "select", options: ["a", "b"] },
    { key: "due", type: "date", options: [] },
    { key: "when", type: "date", options: [] },
  ],
};

function bar(view: TagView, onChange = vi.fn()) {
  render(<ViewBar view={view} schema={schema} shown={3} total={3} onChange={onChange} />);
  return onChange;
}

describe("ViewBar menus are the themed dropdown, not a native select", () => {
  it("has no native select in the bar", () => {
    const { container } = render(<ViewBar view={{ name: "v", type: "kanban" }} schema={schema} shown={1} total={1} onChange={() => {}} />);
    expect(container.querySelector(".kasten-tagdb-bar select")).toBeNull();
  });

  it("Group by picks a column property with the same change as before", () => {
    const onChange = bar({ name: "v", type: "kanban" });
    fireEvent.click(screen.getByRole("button", { name: "Group by: status" }));
    const list = screen.getByRole("listbox", { name: "Group by" });
    fireEvent.click(within(list).getByRole("option", { name: "stage" }));
    expect(onChange).toHaveBeenCalledWith({ name: "v", type: "kanban", group_by: "stage" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("By picks a calendar date", () => {
    const onChange = bar({ name: "v", type: "calendar" });
    fireEvent.click(screen.getByRole("button", { name: "By: due" }));
    fireEvent.click(within(screen.getByRole("listbox", { name: "By" })).getByRole("option", { name: "when" }));
    expect(onChange).toHaveBeenCalledWith({ name: "v", type: "calendar", date: "when" });
  });

  it("Sort adds a sort from the keyboard: arrows and Enter, Esc closes", () => {
    const onChange = bar({ name: "v", type: "table" });
    const button = screen.getByRole("button", { name: /^Sort:/ });
    fireEvent.keyDown(button, { key: "ArrowDown" });
    const list = screen.getByRole("listbox", { name: "Sort" });
    expect(list).toBeTruthy();
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0] as TagView;
    expect(next.sort).toHaveLength(1);
    expect(next.sort![0]!.dir).toBe("asc");
  });

  it("Esc closes the Sort list without adding", () => {
    const onChange = bar({ name: "v", type: "table" });
    fireEvent.click(screen.getByRole("button", { name: /^Sort:/ }));
    fireEvent.keyDown(screen.getByRole("listbox", { name: "Sort" }), { key: "Escape" });
    expect(onChange).not.toHaveBeenCalled();
  });
});

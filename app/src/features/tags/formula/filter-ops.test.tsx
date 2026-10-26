import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TagSchema, TagView } from "../../../lib/vault/types";
import { ViewBar } from "../ViewBar";

afterEach(cleanup);

const schema: TagSchema = {
  name: "job",
  color: null,
  path: "tags/job.yaml",
  views: [],
  properties: [
    { key: "status", type: "text", options: [] },
    { key: "left", type: "formula", options: [], formula: "days_until(due)" },
  ],
};
const view: TagView = { name: "All", type: "table" };

function openFilter(key: string) {
  const onChange = vi.fn();
  render(<ViewBar view={view} schema={schema} shown={3} total={3} onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "+ Filter" }));
  const popup = screen.getByRole("dialog", { name: "Add a filter" });
  fireEvent.click(within(popup).getByRole("button", { name: /^Property:/ }));
  fireEvent.click(within(screen.getByRole("listbox", { name: "Property" })).getByRole("option", { name: key }));
  fireEvent.click(within(popup).getByRole("button", { name: /^Condition:/ }));
  const options = within(screen.getByRole("listbox", { name: "Condition" })).getAllByRole("option");
  return { onChange, popup, options };
}

describe("filter conditions", () => {
  it("offers the number conditions in plain words for a calculated property, in a themed list", () => {
    const { options } = openFilter("left");
    const names = options.map((o) => o.textContent);
    for (const word of ["is more than", "is at least", "is less than", "is at most"]) expect(names).toContain(word);
  });

  it("does not offer them for text", () => {
    const { options } = openFilter("status");
    expect(options.map((o) => o.textContent)).not.toContain("is more than");
  });

  it("adds 'is at least' with a number and reads back as a sentence", () => {
    const { onChange, popup } = openFilter("left");
    fireEvent.click(screen.getByRole("option", { name: "is at least" }));
    const value = within(popup).getByLabelText("Value") as HTMLInputElement;
    expect(value.type).toBe("number");
    fireEvent.change(value, { target: { value: "7" } });
    fireEvent.click(within(popup).getByRole("button", { name: "Add filter" }));
    expect(onChange).toHaveBeenCalledWith({ ...view, filter: [{ key: "left", op: "gte", value: 7 }] });
  });

  it("describes a saved number condition in its chip", () => {
    render(<ViewBar view={{ ...view, filter: [{ key: "left", op: "lt", value: 3 }] }} schema={schema} shown={1} total={3} onChange={() => {}} />);
    expect(screen.getByText("left is less than 3")).toBeTruthy();
  });

  it("sorts by a calculated property from the + Sort list", () => {
    const onChange = vi.fn();
    render(<ViewBar view={view} schema={schema} shown={3} total={3} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /^Sort:/ }));
    fireEvent.click(within(screen.getByRole("listbox", { name: "Sort" })).getByRole("option", { name: "left" }));
    expect(onChange).toHaveBeenCalledWith({ ...view, sort: [{ key: "left", dir: "asc" }] });
  });
});

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FormulaIssue } from "../../../lib/vault/types";
import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { SchemaEditor } from "../SchemaEditor";
import { useTags } from "../store";
import { FORMULA_FUNCTIONS } from "./functions";

afterEach(cleanup);

const TASK = "name: task\nproperties:\n  - {key: due, type: date}\nviews:\n  - {name: All, type: table}\n";

async function open(check: (formula: string) => FormulaIssue | null = () => null) {
  const vault = new MemoryVault({ "tags/task.yaml": TASK });
  const checked = vi.fn(async (formula: string, _key: string, _props: unknown) => check(formula));
  vault.checkFormula = checked;
  useTags.setState({ schemas: null });
  await useWorkspace.getState().connect({ client: vault });
  await useTags.getState().load();
  const schema = useTags.getState().schemas!.find((s) => s.name === "task")!;
  render(<SchemaEditor tag="task" schema={schema} onClose={() => {}} />);
  const editor = screen.getByRole("dialog", { name: "Properties of #task" });
  fireEvent.click(within(editor).getByRole("button", { name: "+ Add a property" }));
  fireEvent.change(within(editor).getAllByRole("textbox", { name: "Property name" }).at(-1)!, { target: { value: "left" } });
  fireEvent.change(within(editor).getByRole("combobox", { name: "Type of left" }), { target: { value: "formula" } });
  return { vault, editor, checked };
}

const save = (editor: HTMLElement) => within(editor).getByRole("button", { name: "Save" }) as HTMLButtonElement;

describe("the formula field in the properties editor", () => {
  it("offers Formula as a type and shows a field for it", async () => {
    const { editor } = await open();
    expect(within(editor).getByRole("textbox", { name: "Formula of left" })).toBeTruthy();
  });

  it("shows the core's sentence with its position under the field and holds Save", async () => {
    const { editor, checked } = await open((f) => (f === "days_unti(due)" ? { position: 1, message: "unknown function “days_unti”; the functions are days_until, days_since" } : null));
    fireEvent.change(within(editor).getByRole("textbox", { name: "Formula of left" }), { target: { value: "days_unti(due)" } });
    const alert = await within(editor).findByRole("alert");
    expect(alert.textContent).toBe("unknown function “days_unti”; the functions are days_until, days_since (at position 1)");
    expect(save(editor).disabled).toBe(true);
    // The check sees the tag's properties as being edited, with this one's name.
    const [formula, key, props] = checked.mock.calls.at(-1)!;
    expect([formula, key]).toEqual(["days_unti(due)", "left"]);
    expect((props as { key: string }[]).map((p) => p.key)).toEqual(["due", "left"]);
    fireEvent.change(within(editor).getByRole("textbox", { name: "Formula of left" }), { target: { value: "days_until(due)" } });
    await waitFor(() => expect(within(editor).queryByRole("alert")).toBeNull());
    await waitFor(() => expect(save(editor).disabled).toBe(false));
  });

  it("checks after typing rests, not on every key", async () => {
    const { editor, checked } = await open();
    const field = within(editor).getByRole("textbox", { name: "Formula of left" });
    for (const text of ["d", "da", "day", "days_until(due)"]) fireEvent.change(field, { target: { value: text } });
    await waitFor(() => expect(checked).toHaveBeenCalled());
    expect(checked.mock.calls.filter(([f]) => f === "d" || f === "da" || f === "day")).toHaveLength(0);
  });

  it("lists the functions with a line and an example, and a pick fills the field", async () => {
    const { editor } = await open();
    fireEvent.click(within(editor).getByRole("button", { name: "Functions" }));
    const list = screen.getByRole("dialog", { name: "Formula functions" });
    for (const fn of FORMULA_FUNCTIONS) {
      const item = within(list).getAllByRole("button").find((b) => b.querySelector("b")?.textContent === fn.name)!;
      expect(item.textContent).toContain(fn.help);
      expect(item.textContent).toContain(fn.example);
    }
    fireEvent.click(within(list).getByRole("button", { name: /^days_until/ }));
    expect((within(editor).getByRole("textbox", { name: "Formula of left" }) as HTMLInputElement).value).toBe("days_until(deadline)");
    expect(screen.queryByRole("dialog", { name: "Formula functions" })).toBeNull();
  });

  it("saves the formula with the property", async () => {
    const { vault, editor } = await open();
    fireEvent.change(within(editor).getByRole("textbox", { name: "Formula of left" }), { target: { value: "days_until(due)" } });
    await waitFor(() => expect(save(editor).disabled).toBe(false));
    await act(async () => fireEvent.click(save(editor)));
    await waitFor(async () => expect((await vault.tagSchemas())[0]!.properties.at(-1)).toEqual({ key: "left", type: "formula", options: [], formula: "days_until(due)" }));
  });
});

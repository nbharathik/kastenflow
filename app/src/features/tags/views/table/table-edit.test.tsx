import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NoteFile } from "../../../../lib/vault/types";
import { useWorkspace } from "../../../workspace/store";
import { NOTES, cellOf, count, openTable, propsOf, rowOf, taskYaml, titles } from "./testing";

afterEach(cleanup);

const open = (view?: string) => openTable({ "tags/task.yaml": taskYaml(view), ...NOTES });
const toasts = () => useWorkspace.getState().toasts.map((t) => t.text).join("\n");
const FLIGHTS = "library/flights.md";
const INTRO = "library/intro.md";

describe("editing table cells", () => {
  it("picks a select option, writing it into the note", async () => {
    const { vault, grid } = await open();
    fireEvent.click(cellOf(grid, "Book flights", "status"));
    const options = screen.getByRole("listbox", { name: "Options" });
    expect(within(options).getByRole("option", { name: "Todo" }).getAttribute("aria-selected")).toBe("true");
    await act(async () => fireEvent.click(within(options).getByRole("option", { name: "Doing" })));
    await expect.poll(async () => (await propsOf(vault, FLIGHTS)).status).toBe("Doing");
    expect((await vault.read(FLIGHTS)).text).toContain("  status: Doing\n");
    expect(cellOf(grid, "Book flights", "status").textContent).toBe("Doing");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("closes a cell's menu on a click elsewhere, changing nothing", async () => {
    const { vault, grid } = await open();
    const save = vi.spyOn(vault, "updateProps");
    fireEvent.click(cellOf(grid, "Book flights", "status"));
    expect(screen.getByRole("listbox", { name: "Options" })).toBeTruthy();
    // A click inside the menu keeps it open.
    fireEvent.pointerDown(screen.getByRole("listbox", { name: "Options" }));
    expect(screen.getByRole("listbox", { name: "Options" })).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(cellOf(grid, "Book flights", "status").textContent).toBe("Todo");
    expect(save).not.toHaveBeenCalled();
  });

  it("finds an option by typing, and picks it with Enter", async () => {
    const { vault, grid } = await open();
    fireEvent.click(cellOf(grid, "Write intro", "status"));
    const find = screen.getByRole("textbox", { name: "Find an option for status of Write intro" });
    fireEvent.change(find, { target: { value: "do" } });
    expect(within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Todo", "Doing", "Done"]);
    fireEvent.change(find, { target: { value: "don" } });
    await act(async () => fireEvent.keyDown(find, { key: "Enter" }));
    await expect.poll(async () => (await propsOf(vault, INTRO)).status).toBe("Done");
  });

  it("edits text in place: Enter saves, Escape leaves the value as it was", async () => {
    const { vault, grid } = await open();
    fireEvent.doubleClick(cellOf(grid, "Book flights", "summary"));
    const input = screen.getByRole("textbox", { name: "summary of Book flights" }) as HTMLInputElement;
    expect(input.value).toBe("Window seats");
    fireEvent.change(input, { target: { value: "Aisle seats" } });
    await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
    await expect.poll(async () => (await propsOf(vault, FLIGHTS)).summary).toBe("Aisle seats");
    expect(screen.queryByRole("textbox", { name: "summary of Book flights" })).toBeNull();

    fireEvent.doubleClick(cellOf(grid, "Book flights", "summary"));
    const again = screen.getByRole("textbox", { name: "summary of Book flights" });
    fireEvent.change(again, { target: { value: "Never mind" } });
    fireEvent.keyDown(again, { key: "Escape" });
    expect(cellOf(grid, "Book flights", "summary").textContent).toBe("Aisle seats");
    await act(async () => {});
    expect((await propsOf(vault, FLIGHTS)).summary).toBe("Aisle seats");
  });

  it("ticks a checkbox with a click", async () => {
    const { vault, grid } = await open();
    const box = within(cellOf(grid, "Write intro", "urgent")).getByRole("checkbox", { name: "urgent of Write intro" }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    await act(async () => fireEvent.click(box));
    await expect.poll(async () => (await propsOf(vault, INTRO)).urgent).toBe(true);
    expect(box.checked).toBe(true);
  });

  it("puts a refused value back, and says why", async () => {
    const { vault, grid } = await open();
    fireEvent.doubleClick(cellOf(grid, "Write intro", "points"));
    const input = screen.getByRole("textbox", { name: "points of Write intro" });
    fireEvent.change(input, { target: { value: "lots" } });
    await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
    await expect.poll(toasts).toMatch(/points.*must be a number/);
    expect(cellOf(grid, "Write intro", "points").textContent).toBe("3");
    expect((await propsOf(vault, INTRO)).points).toBe(3);
  });

  it("shows a change while the core saves it, and the old value if the core refuses", async () => {
    const { vault, grid } = await open();
    const real = vault.updateProps.bind(vault);
    let answer!: (ok: boolean) => void;
    vi.spyOn(vault, "updateProps").mockImplementation(async (path, changes): Promise<NoteFile> => {
      const ok = await new Promise<boolean>((resolve) => (answer = resolve));
      if (!ok) throw new Error("Property “status” is locked for this test");
      return real(path, changes);
    });
    const pick = async (option: string) => {
      fireEvent.click(cellOf(grid, "Book flights", "status"));
      await act(async () => fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option })));
    };

    await pick("Done");
    expect(cellOf(grid, "Book flights", "status").textContent).toBe("Done");
    expect((await propsOf(vault, FLIGHTS)).status).toBe("Todo");
    await act(async () => answer(true));
    await expect.poll(async () => (await propsOf(vault, FLIGHTS)).status).toBe("Done");
    expect(cellOf(grid, "Book flights", "status").textContent).toBe("Done");

    await pick("Doing");
    expect(cellOf(grid, "Book flights", "status").textContent).toBe("Doing");
    await act(async () => answer(false));
    await expect.poll(() => cellOf(grid, "Book flights", "status").textContent).toBe("Done");
    expect(toasts()).toContain("locked for this test");
  });

  it("toggles multi-select options, staying open until Escape", async () => {
    const { vault, grid } = await open();
    fireEvent.click(cellOf(grid, "Book flights", "labels"));
    await act(async () => fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "ui" })));
    await act(async () => fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "core" })));
    await expect.poll(async () => (await propsOf(vault, FLIGHTS)).labels).toEqual(["ui", "core"]);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Remove ui" })));
    await expect.poll(async () => (await propsOf(vault, FLIGHTS)).labels).toEqual(["core"]);
    fireEvent.keyDown(screen.getByRole("textbox", { name: /Find an option/ }), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(cellOf(grid, "Book flights", "labels").textContent).toBe("core");
  });

  it("dates a note with the day picker, and reads the date back", async () => {
    const { vault, grid } = await open();
    expect(cellOf(grid, "Write intro", "due").textContent).toMatch(/2026/);
    fireEvent.click(cellOf(grid, "Book flights", "due"));
    const input = screen.getByLabelText("due of Book flights") as HTMLInputElement;
    expect(input.type).toBe("date");
    fireEvent.change(input, { target: { value: "2026-10-05" } });
    await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
    await expect.poll(async () => (await propsOf(vault, FLIGHTS)).due).toBe("2026-10-05");
    expect(cellOf(grid, "Book flights", "due").textContent).not.toContain("2026-10-05");
  });

  it("keeps the time a date has when its day changes", async () => {
    const { vault, grid } = await openTable({
      "tags/task.yaml": taskYaml(),
      ...NOTES,
      [FLIGHTS]: "---\nid: n-flights\ntitle: Book flights\ntags: [task]\nprops:\n  due: 2026-10-02T09:30:00+02:00\n---\nB\n",
    });
    fireEvent.click(cellOf(grid, "Book flights", "due"));
    const input = screen.getByLabelText("due of Book flights") as HTMLInputElement;
    expect(input.value).toBe("2026-10-02");
    fireEvent.change(input, { target: { value: "2026-10-05" } });
    await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
    await expect.poll(async () => (await propsOf(vault, FLIGHTS)).due).toBe("2026-10-05T09:30:00+02:00");
  });

  it("links a page from a relation cell, and shows its title", async () => {
    const { vault, grid } = await open();
    fireEvent.click(cellOf(grid, "Book flights", "blocks"));
    const find = screen.getByRole("textbox", { name: "Find a page" });
    // The note itself is not offered.
    fireEvent.change(find, { target: { value: "Book" } });
    expect(screen.queryByRole("option", { name: /Book flights/ })).toBeNull();
    fireEvent.change(find, { target: { value: "Plan" } });
    await act(async () => fireEvent.keyDown(find, { key: "Enter" }));
    await expect.poll(async () => (await propsOf(vault, FLIGHTS)).blocks).toEqual(["n-budget"]);
    expect(cellOf(grid, "Book flights", "blocks").textContent).toContain("Plan budget");
  });

  it("links the page picked among pages that share a title, giving it an id", async () => {
    const { vault, grid } = await openTable({
      "tags/task.yaml": taskYaml(),
      ...NOTES,
      "projects/trip/_project.md": "---\ntitle: Trip\ntype: project\n---\n",
      "projects/trip/pages/idea.md": "---\ntitle: Idea\n---\n",
    });
    fireEvent.click(cellOf(grid, "Book flights", "blocks"));
    fireEvent.change(screen.getByRole("textbox", { name: "Find a page" }), { target: { value: "Idea" } });
    expect(screen.getByRole("option", { name: /Idea\s*Pages/ })).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("option", { name: /Idea\s*Trip/ })));
    await expect.poll(async () => (await vault.read("projects/trip/pages/idea.md")).meta.id).toBeTruthy();
    const { id } = (await vault.read("projects/trip/pages/idea.md")).meta;
    await expect.poll(async () => (await propsOf(vault, FLIGHTS)).blocks).toEqual([id]);
    expect((await vault.read("library/idea.md")).meta.id).toBeNull();
    await expect.poll(() => cellOf(grid, "Book flights", "blocks").textContent).toContain("Idea");
    expect(cellOf(grid, "Book flights", "blocks").querySelector(".is-missing")).toBeNull();
  });

  it("opens the note from its title: Ctrl or the middle button in a tab, Shift in the side stack; a plain click only picks", async () => {
    const { grid } = await open();
    const openPath = vi.fn();
    const real = useWorkspace.getState().openPath;
    useWorkspace.setState({ openPath });
    try {
      const title = cellOf(grid, "Book flights", "Title");
      fireEvent.click(title, { ctrlKey: true });
      fireEvent.click(title, { shiftKey: true });
      fireEvent(title, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
      fireEvent.click(title);
      expect(openPath.mock.calls).toEqual([
        [FLIGHTS, "tab"],
        [FLIGHTS, "stack"],
        [FLIGHTS, "tab"],
      ]);
    } finally {
      useWorkspace.setState({ openPath: real });
    }
  });

  it("gives a new row's title back when the note cannot be made", async () => {
    const { vault } = await open();
    vi.spyOn(vault, "create").mockRejectedValue(new Error("The vault is read-only"));
    fireEvent.click(screen.getByRole("button", { name: "New row" }));
    const field = screen.getByRole("textbox", { name: "Title of a new row in #task" }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "Keep me" } });
    await act(async () => fireEvent.submit(field.closest("form")!));
    await expect.poll(() => field.value).toBe("Keep me");
    expect(toasts()).toContain("The vault is read-only");
  });

  it("makes a new row: a note carrying the tag, with the values the view's filters imply", async () => {
    const { grid } = await open("{name: Doing, type: table, filter: [{key: status, op: is, value: doing}, {key: points, op: is, value: 3}]}");
    expect(titles(grid)).toEqual(["Write intro"]);
    fireEvent.click(screen.getByRole("button", { name: "New row" }));
    const field = screen.getByRole("textbox", { name: "Title of a new row in #task" }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "Ship it" } });
    await act(async () => fireEvent.submit(field.closest("form")!));
    await expect.poll(() => titles(grid)).toEqual(["Ship it", "Write intro"]);
    // Marked for a moment, so the eye finds where it went.
    await expect.poll(() => rowOf(grid, "Ship it").classList.contains("is-fresh")).toBe(true);
    const made = useWorkspace.getState().notes.find((n) => n.title === "Ship it")!;
    expect(made.tags).toEqual(["task"]);
    expect(made.props).toEqual({ status: "Doing", points: 3 });
    expect(count()).toBe("2 notes");
    // The field stays for the next row; Escape closes it.
    expect(field.value).toBe("");
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Title of a new row in #task" })).toBeNull();
    expect(screen.getByRole("button", { name: "New row" })).toBeTruthy();
  });
});

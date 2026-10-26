// The table with sub-items: the toggle in the title cell, the keys, the view
// menu, making sub-items (row menu, Ctrl+Shift+Enter, the "+"), drag to nest
// and un-nest in one commit with Undo, and the other views' chip and switch.

import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MemoryVault } from "../../../workspace/preview/memory-vault";
import { usePrefs } from "../../../workspace/prefs";
import { useWorkspace } from "../../../workspace/store";
import { useTags } from "../../store";
import { TagDatabase } from "../../TagDatabase";
import { count, openTable, rowOf, savedView, taskYaml, titles } from "./testing";

const STORIES = {
  "library/epic.md": "---\nid: n-epic\ntitle: Epic\ntags: [task]\nprops:\n  status: Doing\n---\nE\n",
  "library/s1.md": "---\nid: n-s1\ntitle: Story one\nparent: n-epic\ntags: [task]\nprops:\n  status: Todo\n---\nS1\n",
  "library/s2.md": "---\nid: n-s2\ntitle: Story two\nparent: n-epic\ntags: [task]\nprops:\n  status: Done\n---\nS2\n",
  "library/t1.md": "---\nid: n-t1\ntitle: Task deep\nparent: n-s1\ntags: [task]\n---\nT1\n",
  "library/solo.md": "---\nid: n-solo\ntitle: Solo\ntags: [task]\n---\nSolo\n",
};

const tree = (view = "{name: Tree, type: table, sub_items: true, columns: [status]}") => openTable({ "tags/task.yaml": taskYaml(view), ...STORIES });

beforeEach(() => usePrefs.setState({ subItemsOpen: {} }));
afterEach(cleanup);

const press = (grid: HTMLElement, key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(grid, { key, ...init });
const toggle = (title: string, open: boolean) => screen.getByRole("button", { name: `${open ? "Collapse" : "Expand"} the sub-items of ${title}` });
const levels = (grid: HTMLElement) => within(grid).getAllByRole("row").slice(1).map((r) => Number(r.getAttribute("aria-level")));

describe("a table with sub-items", () => {
  it("is flat, with no toggles, until the view turns sub-items on", async () => {
    const { grid } = await tree("{name: Flat, type: table, columns: [status]}");
    expect(titles(grid)).toEqual(["Epic", "Solo", "Story one", "Story two", "Task deep"]);
    expect(screen.queryByRole("button", { name: /sub-items of/ })).toBeNull();
    expect(grid.querySelector("[aria-level]")).toBeNull();
  });

  it("shows top-level rows, opens one level at a time, to any depth, and shuts again", async () => {
    const { grid } = await tree();
    expect(titles(grid)).toEqual(["Epic", "Solo"]);
    // The count is of the rows that match, shut or not.
    expect(count()).toBe("5 notes");
    fireEvent.click(toggle("Epic", false));
    expect(titles(grid)).toEqual(["Epic", "Story one", "Story two", "Solo"]);
    expect(levels(grid)).toEqual([1, 2, 2, 1]);
    fireEvent.click(toggle("Story one", false));
    expect(titles(grid)).toEqual(["Epic", "Story one", "Task deep", "Story two", "Solo"]);
    expect(levels(grid)).toEqual([1, 2, 3, 2, 1]);
    // A row with nothing under it has no toggle.
    expect(screen.queryByRole("button", { name: /the sub-items of Task deep/ })).toBeNull();
    fireEvent.click(toggle("Epic", true));
    expect(titles(grid)).toEqual(["Epic", "Solo"]);
    expect(within(rowOf(grid, "Epic")).getByRole("button", { name: /Expand/ }).getAttribute("aria-expanded")).toBe("false");
  });

  it("remembers the open rows for the view", async () => {
    const first = await tree();
    fireEvent.click(toggle("Epic", false));
    expect(usePrefs.getState().subItemsOpen["task|Tree"]).toEqual(["n-epic"]);
    cleanup();
    const again = await tree();
    expect(titles(again.grid)).toEqual(["Epic", "Story one", "Story two", "Solo"]);
    expect(first.grid).not.toBe(again.grid);
  });

  it("opens with → and shuts with ← on the title cell, and → on an open row moves right", async () => {
    const { grid } = await tree();
    grid.focus();
    press(grid, "ArrowDown");
    press(grid, "ArrowRight");
    expect(titles(grid)).toEqual(["Epic", "Story one", "Story two", "Solo"]);
    expect(grid.querySelector('[aria-selected="true"]')?.getAttribute("role")).toBe("rowheader");
    press(grid, "ArrowRight");
    expect(grid.querySelector('[aria-selected="true"]')?.getAttribute("role")).toBe("gridcell");
    press(grid, "ArrowLeft");
    press(grid, "ArrowLeft");
    expect(titles(grid)).toEqual(["Epic", "Solo"]);
    // Left on a shut row stays where it is.
    press(grid, "ArrowLeft");
    expect(grid.querySelector('[aria-selected="true"]')?.getAttribute("role")).toBe("rowheader");
  });

  it("indents with Tab and outdents with Shift+Tab, each one commit with Undo", async () => {
    const { vault, grid } = await tree();
    const parentOf = async (title: string) => (await vault.list()).find((n) => n.title === title)?.parent;
    grid.focus();
    press(grid, "ArrowDown");
    press(grid, "ArrowDown");
    expect(grid.querySelector('[aria-selected="true"]')?.textContent).toContain("Solo");
    await act(async () => void press(grid, "Tab"));
    await waitFor(async () => expect(await parentOf("Solo")).toBe("n-epic"));
    const notice = useWorkspace.getState().toasts.find((t) => t.text === "Put “Solo” in “Epic”");
    expect(notice?.action?.label).toBe("Undo");
    // The row it went into opens, so Solo stays in view.
    await waitFor(() => expect(titles(grid)).toContain("Solo"));
    expect(levels(grid)[titles(grid).indexOf("Solo")]).toBe(2);
    await act(async () => void press(grid, "Tab", { shiftKey: true }));
    await waitFor(async () => expect(await parentOf("Solo")).toBeFalsy());
    expect(useWorkspace.getState().toasts.some((t) => t.text === "“Solo” is a page of its own")).toBe(true);
  });

  it("says why when there is nothing to indent under or to outdent from", async () => {
    const { grid } = await tree();
    grid.focus();
    press(grid, "ArrowDown");
    await act(async () => void press(grid, "Tab"));
    expect(useWorkspace.getState().toasts.some((t) => t.text === "There is no row above it at its level to go under.")).toBe(true);
    // Shift+Tab on a top-level row leaves the table the usual way.
    expect(press(grid, "Tab", { shiftKey: true })).toBe(true);
  });

  it("greys the ancestors of a matching child and counts matching rows only", async () => {
    const { grid } = await tree("{name: Tree, type: table, sub_items: true, columns: [status], filter: [{key: status, op: is, value: Done}]}");
    // Only "Story two" is Done: shown inside its (greyed) parent, which is open.
    expect(titles(grid)).toEqual(["Epic", "Story two"]);
    expect(rowOf(grid, "Epic").classList.contains("is-dim")).toBe(true);
    expect(rowOf(grid, "Story two").classList.contains("is-dim")).toBe(false);
    expect(count()).toBe("1 note");
    expect(document.body.textContent).toContain("1 of 5");
  });

  it("sorts within siblings", async () => {
    const { grid } = await tree("{name: Tree, type: table, sub_items: true, columns: [status], sort: [{key: status, dir: desc}]}");
    fireEvent.click(toggle("Epic", false));
    // Epic's children, by status descending: Done, then Todo.
    expect(titles(grid)).toEqual(["Epic", "Story two", "Story one", "Solo"]);
  });
});

describe("the Sub-items menu", () => {
  const menu = async (name: RegExp, role: "menuitem" | "menuitemcheckbox" = "menuitem") => {
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Sub-items options" })));
    return screen.getByRole(role, { name });
  };

  it("turns sub-items on and off in the saved view, off by default", async () => {
    const { vault, grid } = await tree("{name: Tree, type: table, columns: [status]}");
    fireEvent.click(await menu(/Show sub-items/, "menuitemcheckbox"));
    await waitFor(async () => expect((await savedView(vault)).sub_items).toBe(true));
    await waitFor(() => expect(titles(grid)).toEqual(["Epic", "Solo"]));
    fireEvent.click(await menu(/Show sub-items/, "menuitemcheckbox"));
    await waitFor(async () => expect((await savedView(vault)).sub_items).toBeUndefined());
  });

  it("expands and collapses every row", async () => {
    const { grid } = await tree();
    fireEvent.click(await menu(/Expand all/));
    await waitFor(() => expect(titles(grid)).toEqual(["Epic", "Story one", "Task deep", "Story two", "Solo"]));
    fireEvent.click(await menu(/Collapse all/));
    await waitFor(() => expect(titles(grid)).toEqual(["Epic", "Solo"]));
  });
});

describe("making sub-items", () => {
  it("adds one from the row menu: a note carrying the tag and the parent, in one commit", async () => {
    const { vault, grid } = await tree();
    fireEvent.contextMenu(within(rowOf(grid, "Solo")).getByRole("rowheader"));
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: /Add sub-item/ })));
    const field = screen.getByRole("textbox", { name: "Title of a new sub-item of Solo" });
    fireEvent.change(field, { target: { value: "Pack bags" } });
    await act(async () => fireEvent.submit(field.closest("form")!));
    await waitFor(async () => {
      const made = (await vault.list()).find((n) => n.title === "Pack bags");
      expect(made?.parent).toBe("n-solo");
      expect(made?.tags).toEqual(["task"]);
    });
    // Solo opened, so the new row shows under it.
    await waitFor(() => expect(titles(grid)).toEqual(["Epic", "Solo", "Pack bags"]));
  });

  it("adds one with Ctrl+Shift+Enter on the active row", async () => {
    const { grid } = await tree();
    grid.focus();
    press(grid, "ArrowDown");
    press(grid, "Enter", { ctrlKey: true, shiftKey: true });
    expect(screen.getByRole("textbox", { name: "Title of a new sub-item of Epic" })).toBeTruthy();
    // Escape closes the field and goes back to making ordinary rows.
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Title of a new sub-item of Epic" }), { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: /sub-item of/ })).toBeNull();
  });

  it("adds one with the + on a row", async () => {
    const { grid } = await tree();
    fireEvent.click(within(rowOf(grid, "Epic")).getByRole("button", { name: "Add a sub-item to Epic" }));
    expect(screen.getByRole("textbox", { name: "Title of a new sub-item of Epic" })).toBeTruthy();
    // The row opened to show where it will go.
    expect(titles(grid)).toContain("Story one");
  });
});

/** A drag-and-drop data carrier, as jsdom has none. */
function transfer() {
  const data = new Map<string, string>();
  return {
    get types() {
      return [...data.keys()];
    },
    effectAllowed: "",
    dropEffect: "",
    setData: (type: string, value: string) => void data.set(type, value),
    getData: (type: string) => data.get(type) ?? "",
  };
}

function dragAt(kind: "dragOver" | "drop", target: HTMLElement, dataTransfer: object, y: number): boolean {
  const event = createEvent[kind](target, { dataTransfer });
  Object.defineProperty(event, "clientY", { value: y });
  return fireEvent(target, event);
}

/** A row 36px tall from the top of the screen. */
function sized(row: HTMLElement) {
  row.getBoundingClientRect = () => ({ top: 0, height: 36, bottom: 36, left: 0, right: 400, width: 400, x: 0, y: 0, toJSON: () => ({}) });
}

describe("dragging rows", () => {
  const parentOf = async (vault: { list(): Promise<{ title: string; parent: string | null }[]> }, title: string) => (await vault.list()).find((n) => n.title === title)?.parent;

  it("nests a row dropped on the middle of another, in one commit with Undo", async () => {
    const { vault, grid } = await tree();
    const drag = transfer();
    fireEvent.dragStart(within(rowOf(grid, "Solo")).getByRole("rowheader"), { dataTransfer: drag });
    const epic = rowOf(grid, "Epic");
    sized(epic);
    expect(dragAt("dragOver", epic, drag, 18)).toBe(false);
    expect(epic.getAttribute("data-drop")).toBe("into");
    await act(async () => void dragAt("drop", epic, drag, 18));
    await waitFor(async () => expect(await parentOf(vault, "Solo")).toBe("n-epic"));
    const notice = useWorkspace.getState().toasts.find((t) => t.text === "Put “Solo” in “Epic”");
    expect(notice?.action?.label).toBe("Undo");
    await act(async () => notice!.action!.run());
    await waitFor(async () => expect(await parentOf(vault, "Solo")).toBeFalsy());
  });

  it("un-nests a row dropped on the gap (the edge) beside a top-level row", async () => {
    const { vault, grid } = await tree();
    fireEvent.click(toggle("Epic", false));
    const drag = transfer();
    fireEvent.dragStart(within(rowOf(grid, "Story one")).getByRole("rowheader"), { dataTransfer: drag });
    const solo = rowOf(grid, "Solo");
    sized(solo);
    expect(dragAt("dragOver", solo, drag, 34)).toBe(false);
    expect(solo.getAttribute("data-drop")).toBe("after");
    await act(async () => void dragAt("drop", solo, drag, 34));
    await waitFor(async () => expect(await parentOf(vault, "Story one")).toBeFalsy());
    // Its own sub-item went with it.
    expect(await parentOf(vault, "Task deep")).toBe("n-s1");
  });

  it("refuses a row dropped inside its own sub-item, with a sentence", async () => {
    const { vault, grid } = await tree();
    fireEvent.click(toggle("Epic", false));
    const drag = transfer();
    fireEvent.dragStart(within(rowOf(grid, "Epic")).getByRole("rowheader"), { dataTransfer: drag });
    const story = rowOf(grid, "Story one");
    sized(story);
    await act(async () => void dragAt("drop", story, drag, 18));
    expect(useWorkspace.getState().toasts.some((t) => t.text === "A page cannot go inside itself or its own sub-page.")).toBe(true);
    expect(await parentOf(vault, "Epic")).toBeFalsy();
  });
});

/** The Tag Database open on #task with a view that is not a table. */
async function openList(files: Record<string, string>) {
  localStorage.clear();
  const vault = new MemoryVault(files);
  useTags.setState({ schemas: null });
  useWorkspace.setState({ place: { view: "tags", path: "#task" }, toasts: [] });
  await useWorkspace.getState().connect({ client: vault });
  render(<TagDatabase tag="task" />);
  await waitFor(() => expect(useTags.getState().schemas).not.toBeNull());
  await act(async () => {});
  await screen.findByRole("list", { name: "Notes" });
  return { vault };
}

describe("the other views", () => {
  it("show a ↳ Parent chip on a sub-item, and a switch leaves sub-items out", async () => {
    const { vault } = await openList({ "tags/task.yaml": taskYaml("{name: Notes, type: list}"), ...STORIES });
    const list = screen.getByRole("list", { name: "Notes" });
    expect(within(list).getAllByText(/Epic/).length).toBeGreaterThan(1);
    expect(within(list).getAllByText("Sub-item of").length).toBe(3);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Sub-items options" })));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Hide sub-items/ }));
    await waitFor(async () => expect((await savedView(vault)).hide_sub_items).toBe(true));
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Notes" })).getAllByRole("listitem").length).toBe(2));
  });

  it("have no Sub-items menu in a list that has none", async () => {
    await openList({ "tags/task.yaml": taskYaml("{name: Notes, type: list}"), "library/solo.md": STORIES["library/solo.md"] });
    expect(screen.queryByRole("button", { name: "Sub-items options" })).toBeNull();
  });
});

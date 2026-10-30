import { act, cleanup, createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NOTE_DRAG } from "../workspace/drag";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { useWorkspace } from "../workspace/store";
import { useTags } from "./store";
import { TagDatabase } from "./TagDatabase";
import { TagsHome } from "./TagsHome";

const TASK = "name: task\ncolor: green\nproperties:\n  - {key: status, type: select, options: [Todo, Doing, Done]}\n  - {key: due, type: date}\nviews:\n  - {name: Board, type: kanban, group_by: status}\n  - {name: All, type: table}\n";
const SEED = {
  "tags/task.yaml": TASK,
  "library/a.md": "---\ntitle: Write intro\ntags: [task]\nprops:\n  status: Doing\n  due: 2026-10-02\n---\nA\n",
  "library/b.md": "---\ntitle: Book flights\ntags: [task, travel]\nprops:\n  status: Todo\n---\nB\n",
  "library/c.md": "---\ntitle: Plan budget\ntags: [task]\nprops:\n  status: Done\n---\nC\n",
  "library/idea.md": "---\ntitle: Idea\ntags: [idea]\n---\nI\n",
};

let vault: MemoryVault;
const schema = async () => (await vault.tagSchemas()).find((s) => s.name === "task")!;

async function connect() {
  vault = new MemoryVault(SEED);
  useWorkspace.setState({ place: { view: "tags" }, toasts: [] });
  await useWorkspace.getState().connect({ client: vault });
}

beforeEach(async () => {
  localStorage.clear();
  useTags.setState({ schemas: null });
  await connect();
});
afterEach(cleanup);

/** Opens a themed drop-down inside `popup` and picks an option. */
function pickIn(popup: HTMLElement, label: string, option: string) {
  fireEvent.click(within(popup).getByRole("button", { name: new RegExp(`^${label}:`) }));
  fireEvent.click(within(screen.getByRole("listbox", { name: label })).getByRole("option", { name: option }));
}

describe("Tag Database", () => {
  it("lists every tag with its notes and opens one's database", async () => {
    render(<TagsHome />);
    const list = await screen.findByRole("list", { name: "Tags" });
    const task = within(list).getByRole("button", { name: /#task/ });
    expect(task.textContent).toContain("3 notes");
    expect(task.textContent).toContain("status · due");
    expect(within(list).getByRole("button", { name: /#idea/ }).textContent).toContain("1 note");
    fireEvent.click(task);
    expect(useWorkspace.getState().place).toEqual({ view: "tags", path: "#task" });
  });

  it("shows a tag's views, and saves a new one into its YAML", async () => {
    render(<TagDatabase tag="task" />);
    const tabs = await screen.findByRole("tablist", { name: "Views" });
    await expect.poll(() => within(tabs).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Board", "All"]);
    fireEvent.click(screen.getByRole("button", { name: "Add a view" }));
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: /List/ })));
    await expect.poll(async () => (await schema()).views.map((v) => v.name)).toEqual(["Board", "All", "List"]);
    expect(within(tabs).getByRole("tab", { name: /List/ }).getAttribute("aria-selected")).toBe("true");
    const notes = screen.getByRole("list", { name: "Notes" });
    expect(within(notes).getAllByRole("button")).toHaveLength(3);
  });

  it("filters and sorts a view, and keeps both with it", async () => {
    render(<TagDatabase tag="task" />);
    fireEvent.click(await screen.findByRole("tab", { name: /All/ }));
    fireEvent.click(screen.getByRole("button", { name: "+ Filter" }));
    const popup = screen.getByRole("dialog", { name: "Add a filter" });
    pickIn(popup, "Property", "status");
    pickIn(popup, "Condition", "is not");
    pickIn(popup, "Value", "Done");
    await act(async () => fireEvent.click(within(popup).getByRole("button", { name: "Add filter" })));
    await expect.poll(() => screen.queryByText("Plan budget")).toBeNull();
    expect(screen.getByText("2 of 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Sort:/ }));
    fireEvent.click(within(screen.getByRole("listbox", { name: "Sort" })).getByRole("option", { name: "status" }));
    await expect.poll(async () => (await schema()).views[1]).toEqual({
      name: "All",
      type: "table",
      filter: [{ key: "status", op: "is_not", value: "Done" }],
      sort: [{ key: "status", dir: "asc" }],
    });
    fireEvent.click(screen.getByRole("button", { name: /Remove the filter/ }));
    await expect.poll(() => screen.queryByText("Plan budget")).not.toBeNull();
  });

  it("filters a checkbox by what its menu shows", async () => {
    vault = new MemoryVault({
      ...SEED,
      "tags/task.yaml": TASK.replace("  - {key: due, type: date}\n", "  - {key: due, type: date}\n  - {key: urgent, type: checkbox}\n"),
      "library/b.md": "---\ntitle: Book flights\ntags: [task]\nprops:\n  status: Todo\n  urgent: true\n---\nB\n",
    });
    await useWorkspace.getState().connect({ client: vault });
    render(<TagDatabase tag="task" />);
    fireEvent.click(await screen.findByRole("tab", { name: /All/ }));
    fireEvent.click(screen.getByRole("button", { name: "+ Filter" }));
    const popup = screen.getByRole("dialog", { name: "Add a filter" });
    pickIn(popup, "Property", "urgent");
    expect(within(popup).getByRole("button", { name: "Value: ticked" })).toBeTruthy();
    await act(async () => fireEvent.click(within(popup).getByRole("button", { name: "Add filter" })));
    await expect.poll(async () => (await schema()).views[1]!.filter).toEqual([{ key: "urgent", op: "is", value: true }]);
    expect(screen.getByText("urgent is ticked")).toBeTruthy();
    await expect.poll(() => screen.queryByText("Plan budget")).toBeNull();
    expect(screen.getByText("Book flights")).toBeTruthy();
  });

  it("edits the tag's properties", async () => {
    render(<TagDatabase tag="task" />);
    fireEvent.click(await screen.findByRole("button", { name: /Properties/ }));
    const editor = screen.getByRole("dialog", { name: "Properties of #task" });
    fireEvent.click(within(editor).getByRole("button", { name: "+ Add a property" }));
    const names = within(editor).getAllByRole("textbox", { name: "Property name" });
    fireEvent.change(names.at(-1)!, { target: { value: "points" } });
    fireEvent.change(within(editor).getByRole("combobox", { name: "Type of points" }), { target: { value: "number" } });
    fireEvent.change(within(editor).getByRole("textbox", { name: "Options of status" }), { target: { value: "Todo, Doing, Waiting, Done" } });
    await act(async () => fireEvent.click(within(editor).getByRole("button", { name: "Save" })));
    await expect.poll(async () => (await schema()).properties.map((p) => [p.key, p.type, p.options.length])).toEqual([
      ["status", "select", 4],
      ["due", "date", 0],
      ["points", "number", 0],
    ]);
    expect(screen.queryByRole("dialog", { name: "Properties of #task" })).toBeNull();
  });

  it("refuses two properties with one name", async () => {
    render(<TagDatabase tag="task" />);
    fireEvent.click(await screen.findByRole("button", { name: /Properties/ }));
    const editor = screen.getByRole("dialog", { name: "Properties of #task" });
    fireEvent.click(within(editor).getByRole("button", { name: "+ Add a property" }));
    fireEvent.change(within(editor).getAllByRole("textbox", { name: "Property name" }).at(-1)!, { target: { value: "due" } });
    expect(within(editor).getByText("Two properties are called “due”.")).toBeTruthy();
    expect(within(editor).getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
  });

  it("adds a note carrying the tag", async () => {
    render(<TagDatabase tag="task" />);
    // New is an icon: its word is its name and its tooltip.
    const add = await screen.findByRole("button", { name: "New note" });
    expect(add.textContent).toBe("");
    expect(add.title).toBe("New note");
    fireEvent.click(add);
    const field = screen.getByRole("textbox", { name: "New note in #task" });
    fireEvent.change(field, { target: { value: "Pack bags" } });
    await act(async () => fireEvent.submit(field.closest("form")!));
    await expect.poll(() => useWorkspace.getState().notes.find((n) => n.title === "Pack bags")?.tags).toEqual(["task"]);
  });

  it("finds a note inside the view by its title or a property, without saving it", async () => {
    render(<TagDatabase tag="task" />);
    await screen.findByText("Write intro");
    const find = screen.getByRole("searchbox", { name: "Find in this view" });
    fireEvent.change(find, { target: { value: "flights" } });
    expect(screen.queryByText("Write intro")).toBeNull();
    expect(screen.getByText("Book flights")).toBeTruthy();
    expect(screen.getByRole("toolbar", { name: "View settings" }).textContent).toContain("1 of 3");
    fireEvent.change(find, { target: { value: "done" } });
    expect(screen.getByText("Plan budget")).toBeTruthy();
    expect(screen.queryByText("Book flights")).toBeNull();
    fireEvent.keyDown(find, { key: "Escape" });
    expect(screen.getByText("Write intro")).toBeTruthy();
    expect((await schema()).views?.every((v) => !JSON.stringify(v).includes("done"))).toBe(true);
  });
});

/** A drag event over `target` carrying `data`, as a drag of pages from the sidebar does (jsdom has no DataTransfer). */
function dropOn(type: "dragEnter" | "drop", target: Element, data: Record<string, string>) {
  const event = createEvent[type](target);
  Object.defineProperty(event, "dataTransfer", { value: { types: Object.keys(data), getData: (key: string) => data[key] ?? "", dropEffect: "none" } });
  fireEvent(target, event);
}

describe("pages put into a tag's database", () => {
  const tagsOf = async (path: string) => (await vault.read(path)).meta.tags;
  const body = () => document.querySelector(".kasten-tagdb-body")!;

  it("gain the tag when dropped on the list, and stay where they are", async () => {
    render(<TagDatabase tag="task" />);
    await screen.findByText("Write intro");
    dropOn("dragEnter", body(), { [NOTE_DRAG]: "library/idea.md" });
    expect(screen.getByRole("status").textContent).toBe("Add tag #task");
    dropOn("drop", body(), { [NOTE_DRAG]: "library/idea.md" });
    await expect.poll(() => tagsOf("library/idea.md")).toEqual(["idea", "task"]);
    expect(screen.queryByText("Add tag #task")).toBeNull();
    expect(await screen.findByText("Idea")).toBeTruthy();
    expect(useWorkspace.getState().notes.find((n) => n.path === "library/idea.md")?.path).toBe("library/idea.md");
    expect(useWorkspace.getState().toasts.at(-1)?.text).toBe("Added “Idea” to #task");
  });

  it("are added from a keyboard picker, by search, without a drag", async () => {
    render(<TagDatabase tag="task" />);
    await screen.findByText("Write intro");
    fireEvent.click(screen.getByRole("button", { name: "Add existing pages" }));
    const box = await screen.findByRole("textbox", { name: "Find pages to add to #task" });
    // Pages with the tag already are not offered.
    expect(within(screen.getByRole("listbox", { name: "Pages" })).queryByText("Book flights")).toBeNull();
    fireEvent.change(box, { target: { value: "idea" } });
    await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
    await expect.poll(() => tagsOf("library/idea.md")).toEqual(["idea", "task"]);
    expect(screen.queryByRole("textbox", { name: "Find pages to add to #task" })).toBeNull();
  });

  it("are shown, and said to be, when the view’s filters would hide them", async () => {
    vault = new MemoryVault({ ...SEED, "tags/task.yaml": TASK.replace("{name: All, type: table}", "{name: All, type: table, filter: [{key: status, op: is, value: Doing}]}") });
    await useWorkspace.getState().connect({ client: vault });
    render(<TagDatabase tag="task" />);
    fireEvent.click(await screen.findByRole("tab", { name: /All/ }));
    await expect.poll(() => screen.queryByText("Book flights")).toBeNull();
    dropOn("drop", body(), { [NOTE_DRAG]: "library/idea.md" });
    // Idea has no status, so the filter hides it: a notice says so, with a way to see it.
    await expect.poll(() => useWorkspace.getState().toasts.map((t) => t.text)).toContain("1 added page is hidden by this view’s filters");
    expect(screen.queryByText("Idea")).toBeNull();
    const reveal = useWorkspace.getState().toasts.find((t) => t.text.endsWith("hidden by this view’s filters"))!.action!;
    expect(reveal.label).toBe("Reveal");
    act(() => reveal.run());
    const line = await screen.findByText("Showing 1 added page that this view’s filters hide.");
    expect(screen.getByText("Idea")).toBeTruthy();
    // Showing it changed nothing in the page or the view.
    expect((await vault.read("library/idea.md")).meta.props).toEqual({});
    fireEvent.click(within(line.closest("p")!).getByRole("button", { name: "Hide it again" }));
    expect(screen.queryByText("Idea")).toBeNull();
    expect(await tagsOf("library/idea.md")).toEqual(["idea", "task"]);
  });

  it("are not added by a drop of something that is not a page", async () => {
    render(<TagDatabase tag="task" />);
    await screen.findByText("Write intro");
    dropOn("drop", body(), { "text/plain": "library/idea.md" });
    expect(await tagsOf("library/idea.md")).toEqual(["idea"]);
  });
});

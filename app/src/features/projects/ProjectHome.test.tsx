import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useShell } from "../../lib/store";
import { useBoards } from "../boards/store";
import { useTaskRows } from "../dashboard/task-rows";
import { NotePage } from "../workspace/page/NotePage";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { useWorkspace } from "../workspace/store";

const PROJECT = "projects/trip/_project.md";
const SEED = {
  [PROJECT]: "---\ntitle: Seaside trip\ntype: project\nicon: ✈️\n---\nPlans for the trip.\n",
  "projects/trip/pages/packing.md": "---\ntitle: Packing\ntype: page\n---\n- [ ] Buy adapters\n- [x] Passport\n",
  "projects/trip/cards/idea.md": "---\ntitle: Tram 28 early\ntype: card\n---\nBefore the crowds.\n",
  "library/elsewhere.md": "---\ntitle: Elsewhere\n---\n- [ ] Not this one\n",
  "tags/task.yaml": "name: task\ncolor: green\nproperties:\n  - {key: status, type: select, options: [Todo, Doing, Done]}\nviews:\n  - {name: Board, type: kanban, group_by: status}\n",
  "projects/trip/pages/book.md": "---\ntitle: Book the hotel\ntags: [task]\nprops:\n  status: Doing\n---\n",
};

let vault: MemoryVault;

beforeEach(() => {
  localStorage.clear();
  vault = new MemoryVault(SEED);
  useTaskRows.setState({ rows: null });
  useBoards.setState({ list: [], loaded: false });
  useShell.setState({ panels: [] });
  useWorkspace.setState({ place: { view: "home" }, back: [], forward: [], toasts: [] });
});
afterEach(cleanup);

async function openProject() {
  await useWorkspace.getState().connect({ client: vault });
  useWorkspace.getState().openPath(PROJECT);
  render(<NotePage client={vault} path={PROJECT} />);
  return screen.findByRole("region", { name: "Project home" }, { timeout: 20_000 });
}

const text = async (path: string) => (await vault.read(path)).text;

describe("a project's home", () => {
  it("shows the project's summary, to-dos, recent notes and pages above the page", async () => {
    const home = await openProject();
    // What the project is and how far along, without a row of counts.
    const summary = within(home).getByRole("region", { name: "Summary" });
    expect(summary.querySelector("dl")).toBeNull();
    // Its structure first, then what is going on.
    const order = within(home).getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(order.indexOf("Pages")).toBeLessThan(order.indexOf("To-dos"));
    expect(order.indexOf("Whiteboards")).toBeLessThan(order.indexOf("Recently edited"));
    const todos = within(home).getByRole("region", { name: "To-dos" });
    expect(await within(todos).findByText("Buy adapters")).toBeTruthy();
    expect(within(todos).queryByText("Not this one")).toBeNull();
    expect(within(todos).queryByText("Passport")).toBeNull();
    const recent = within(home).getByRole("region", { name: "Recently edited" });
    expect(within(recent).getByText("Tram 28 early")).toBeTruthy();
    expect(within(home).getByRole("region", { name: "Pages" }).textContent).toContain("Packing");
    // The page's own text still follows the home.
    expect(await screen.findByTestId("page-editor", {}, { timeout: 20_000 })).toBeTruthy();
  });

  it("shows the project's status in its Summary and changes it from a menu, through the core", async () => {
    const home = await openProject();
    const summary = within(home).getByRole("region", { name: "Summary" });
    fireEvent.click(within(summary).getByRole("button", { name: "Project status: Active" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Status: Paused" }));
    await within(summary).findByRole("button", { name: "Project status: Paused" });
    expect(await text(PROJECT)).toContain("status: Paused");
  });

  it("adds a to-do under the project page's To-dos heading and ticks one", async () => {
    const home = await openProject();
    const todos = within(home).getByRole("region", { name: "To-dos" });
    const field = within(todos).getByRole("textbox", { name: "Add a to-do" });
    fireEvent.change(field, { target: { value: "Book the flights" } });
    await act(async () => fireEvent.submit(field.closest("form")!));
    await expect.poll(() => text(PROJECT)).toContain("Plans for the trip.\n\n## To-dos\n\n- [ ] Book the flights\n");
    const again = within(await screen.findByRole("region", { name: "To-dos" })).getByRole("textbox", { name: "Add a to-do" });
    fireEvent.change(again, { target: { value: "Pack light" } });
    await act(async () => fireEvent.submit(again.closest("form")!));
    await expect.poll(() => text(PROJECT)).toContain("- [ ] Book the flights\n- [ ] Pack light\n");

    const box = await within(await screen.findByRole("region", { name: "To-dos" })).findByRole("checkbox", { name: "Buy adapters" });
    await act(async () => fireEvent.click(box));
    await expect.poll(() => text("projects/trip/pages/packing.md")).toContain("- [x] Buy adapters");
  });

  it("saves a quick note as a card in the project", async () => {
    const home = await openProject();
    const field = within(home).getByRole("textbox", { name: "Quick note for this project" });
    fireEvent.change(field, { target: { value: "Try the pastéis at Manteigaria" } });
    await act(async () => fireEvent.submit(field.closest("form")!));
    const made = async () => (await vault.list()).find((n) => n.title === "Try the pastéis at Manteigaria");
    await expect.poll(async () => (await made())?.path.startsWith("projects/trip/cards/")).toBe(true);
    expect((await made())!.kind).toBe("card");
  });

  it("lists the latest cards once, under Recently edited, not again under the quick note", async () => {
    const home = await openProject();
    const quick = within(home).getByRole("textbox", { name: "Quick note for this project" }).closest("section")!;
    expect(quick.textContent).not.toContain("Tram 28 early");
    expect(within(home).getByRole("region", { name: "Recently edited" }).textContent).toContain("Tram 28 early");
  });

  it("turns sections on and off, keeps them in the page's properties, and hides the home", async () => {
    const home = await openProject();
    fireEvent.click(within(home).getByRole("button", { name: "Customize project home" }));
    const menu = screen.getByRole("dialog", { name: "Customize project home" });
    await act(async () => fireEvent.click(within(menu).getByRole("checkbox", { name: /Task board/ })));
    await expect.poll(() => text(PROJECT)).toMatch(/props:\n {2}home: \[summary, capture, pages, boards, todo, recent, kanban\]/);
    // The board loads on first use; its card is the project's #task note.
    await expect.poll(() => within(home).queryByRole("region", { name: "Task board" })?.textContent ?? "", { timeout: 10_000 }).toContain("Book the hotel");

    await act(async () => fireEvent.click(within(menu).getByRole("button", { name: "Reset to the usual" })));
    await expect.poll(() => text(PROJECT)).not.toContain("home:");

    await act(async () => fireEvent.click(within(menu).getByRole("button", { name: /Hide for this project/ })));
    await expect.poll(() => text(PROJECT)).toContain("home: false");
    await expect.poll(() => screen.queryByRole("region", { name: "Project home" })).toBeNull();
  });

  it("opens the overview from an icon, named and with a tooltip, not from a word", async () => {
    const home = await openProject();
    const expand = within(home).getByRole("button", { name: "Open overview" });
    expect(expand.textContent).toBe("");
    expect(expand.title).toBe("Open the project overview full size");
    expect(within(home).queryByText("Expand")).toBeNull();
  });

  it("folds away and stays folded", async () => {
    const home = await openProject();
    fireEvent.click(within(home).getByRole("button", { name: /Project home/ }));
    expect(within(home).queryByRole("region", { name: "Summary" })).toBeNull();
    expect(localStorage.getItem("kasten.project-home.folded")).toBe('["trip"]');
  });
});

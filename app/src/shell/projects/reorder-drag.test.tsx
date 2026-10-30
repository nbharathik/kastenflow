// Putting sub-pages in order from the sidebar: drag a page onto the top or
// bottom edge of a sibling, or press Alt+Up / Alt+Down on a focused row.

import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MemoryVault } from "../../features/workspace/preview/memory-vault";
import { useWorkspace } from "../../features/workspace/store";
import { dragAt, freshWindow, renderShell, SEED, transfer } from "./test-shell";

const VAULT = {
  ...SEED,
  "library/route.md": "---\nid: R\ntitle: Route\n---\nThe way there.\n",
  "library/apple.md": "---\nid: A\ntitle: Apple\nparent: R\n---\n",
  "library/banana.md": "---\nid: B\ntitle: Banana\nparent: R\n---\n",
  "library/cherry.md": "---\nid: C\ntitle: Cherry\nparent: R\n---\n",
};

let vault: MemoryVault;

beforeEach(() => {
  freshWindow();
  vault = new MemoryVault(VAULT);
});
afterEach(cleanup);

const pages = () => within(screen.getByRole("navigation", { name: "Sidebar" })).getByRole("region", { name: "Pages" });
const line = (title: string) => within(pages()).getByRole("button", { name: title }).closest("[draggable]") as HTMLElement;
const titles = () => [...pages().querySelectorAll("li li [data-row-title]")].map((el) => el.textContent);
const routeText = async () => (await vault.read("library/route.md")).text;

async function openRoute() {
  await renderShell(vault);
  // Which rows are open is kept across tests, like across restarts.
  await within(pages()).findByRole("button", { name: /^(Expand|Collapse) Route$/ });
  const expand = within(pages()).queryByRole("button", { name: "Expand Route" });
  if (expand) fireEvent.click(expand);
  await within(pages()).findByRole("button", { name: "Cherry" });
}

/** Makes a row 28 pixels tall from the top of the screen, as in the sidebar. */
function sized(row: HTMLElement) {
  row.getBoundingClientRect = () => ({ top: 0, height: 28, bottom: 28, left: 0, right: 200, width: 200, x: 0, y: 0, toJSON: () => ({}) });
}

describe("sub-page order in the sidebar", () => {
  it("lists sub-pages alphabetically until an order is stored", async () => {
    await openRoute();
    expect(titles()).toEqual(["Apple", "Banana", "Cherry"]);
  });

  it("puts a page before a sibling when dropped on its top edge, with Undo", async () => {
    await openRoute();
    const drag = transfer();
    fireEvent.dragStart(line("Cherry"), { dataTransfer: drag });
    sized(line("Apple"));
    // Lit as a line, not as a page to go inside.
    expect(dragAt("dragOver", line("Apple"), drag, 2)).toBe(false);
    expect(line("Apple").getAttribute("data-drop-edge")).toBe("before");
    expect(line("Apple").hasAttribute("data-drop-into")).toBe(false);
    await act(async () => void dragAt("drop", line("Apple"), drag, 2));
    await waitFor(() => expect(titles()).toEqual(["Cherry", "Apple", "Banana"]));
    expect(await routeText()).toContain("children_order: [C, A, B]");
    const notice = useWorkspace.getState().toasts.find((t) => t.text === "Moved “Cherry” before “Apple”");
    expect(notice?.action?.label).toBe("Undo");
    await act(async () => notice!.action!.run());
    await waitFor(() => expect(titles()).toEqual(["Apple", "Banana", "Cherry"]));
  });

  it("still nests a page dropped on the middle of a row", async () => {
    await openRoute();
    const drag = transfer();
    fireEvent.dragStart(line("Cherry"), { dataTransfer: drag });
    sized(line("Apple"));
    expect(dragAt("dragOver", line("Apple"), drag, 14)).toBe(false);
    expect(line("Apple").hasAttribute("data-drop-into")).toBe(true);
    await act(async () => void dragAt("drop", line("Apple"), drag, 14));
    await waitFor(async () => expect((await vault.list()).find((n) => n.title === "Cherry")?.parent).toBe("A"));
  });

  it("says in one sentence that a page cannot go inside its own sub-page", async () => {
    await openRoute();
    const drag = transfer();
    fireEvent.dragStart(line("Route"), { dataTransfer: drag });
    sized(line("Apple"));
    await act(async () => void dragAt("drop", line("Apple"), drag, 14));
    expect(useWorkspace.getState().toasts.map((t) => t.text)).toContain("A page cannot go inside itself or its own sub-page.");
    expect((await vault.list()).find((n) => n.title === "Route")?.parent ?? null).toBeNull();
  });

  it("moves the focused row with Alt+Up and Alt+Down", async () => {
    await openRoute();
    const banana = within(pages()).getByRole("button", { name: "Banana" });
    banana.focus();
    await act(async () => void fireEvent.keyDown(banana, { key: "ArrowUp", altKey: true }));
    await waitFor(() => expect(titles()).toEqual(["Banana", "Apple", "Cherry"]));
    const again = within(pages()).getByRole("button", { name: "Banana" });
    await act(async () => void fireEvent.keyDown(again, { key: "ArrowDown", altKey: true }));
    await waitFor(() => expect(titles()).toEqual(["Apple", "Banana", "Cherry"]));
    // At the end it says so rather than doing nothing.
    const cherry = within(pages()).getByRole("button", { name: "Cherry" });
    await act(async () => void fireEvent.keyDown(cherry, { key: "ArrowDown", altKey: true }));
    expect(useWorkspace.getState().toasts.map((t) => t.text)).toContain("“Cherry” is already last.");
  });

  it("offers Move up and Move down in the row menu", async () => {
    await openRoute();
    fireEvent.click(within(pages()).getByRole("button", { name: "More for Banana" }));
    expect(screen.getByRole("menuitem", { name: /Move up/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Move down/ })).toBeTruthy();
  });
});

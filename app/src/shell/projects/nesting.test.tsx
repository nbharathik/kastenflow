// Pages inside pages from the sidebar, as in Notion: drop a page on another
// to put it inside, take it out again from its menu or by dropping it on its
// project, and undo a move from its notice.

import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { usePrefs } from "../../features/workspace/prefs";
import { MemoryVault } from "../../features/workspace/preview/memory-vault";
import { useWorkspace } from "../../features/workspace/store";
import { dragAt, freshWindow, renderShell, rowOf, SEED, transfer } from "./test-shell";

const VAULT = {
  ...SEED,
  "library/route.md": "---\nid: R\ntitle: Route\n---\nThe way there.\n",
  "library/stops.md": "---\ntitle: Stops\n---\n",
};

let vault: MemoryVault;

beforeEach(() => {
  freshWindow();
  vault = new MemoryVault(VAULT);
});
afterEach(cleanup);

const pages = () => within(screen.getByRole("navigation", { name: "Sidebar" })).getByRole("region", { name: "Pages" });
const line = (region: HTMLElement, title: string) => within(region).getByRole("button", { name: title }).closest("[draggable]") as HTMLElement;
const pathOf = async (title: string) => (await vault.list()).find((n) => n.title === title);

describe("pages inside pages in the sidebar", () => {
  it("puts a page dropped on another inside it, and takes it out from its menu", async () => {
    await renderShell(vault);
    const drag = transfer();
    fireEvent.dragStart(line(pages(), "Stops"), { dataTransfer: drag });
    // A page does not take itself.
    expect(dragAt("dragOver", line(pages(), "Stops"), drag, 0)).toBe(true);
    expect(dragAt("dragOver", line(pages(), "Route"), drag, 0)).toBe(false);
    expect(line(pages(), "Route").hasAttribute("data-drop-into")).toBe(true);
    await act(async () => void dragAt("drop", line(pages(), "Route"), drag, 0));
    await waitFor(async () => expect((await pathOf("Stops"))?.parent).toBe("R"));
    expect(useWorkspace.getState().toasts.map((t) => t.text)).toContain("Put “Stops” in “Route”");
    // Under Route now; out again from its menu.
    const expand = await within(pages()).findByRole("button", { name: "Expand Route" });
    fireEvent.click(expand);
    fireEvent.click(await within(pages()).findByRole("button", { name: "More for Stops" }));
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: "Take out of “Route”" })));
    await waitFor(async () => expect((await pathOf("Stops"))?.parent ?? null).toBeNull());
  });

  it("takes a page out of its page when dropped on its own project, and moves undo", async () => {
    const projects = await renderShell(vault);
    // Route goes into Beta, with Undo.
    const drag = transfer();
    fireEvent.dragStart(line(pages(), "Route"), { dataTransfer: drag });
    await act(async () => void dragAt("drop", rowOf(projects, "beta"), drag, 0));
    await waitFor(async () => expect((await pathOf("Route"))?.path).toBe("projects/beta/pages/route.md"));
    const notice = useWorkspace.getState().toasts.find((t) => t.text === "Moved “Route” to Beta");
    expect(notice?.action?.label).toBe("Undo");
    await act(async () => notice!.action!.run());
    await waitFor(async () => expect((await pathOf("Route"))?.path).toBe("library/route.md"));

    // Stops goes inside Beta's Plan; dropped on Beta, it comes out to the top of Beta.
    const expand = within(projects).queryByRole("button", { name: "Expand Beta" });
    if (expand) fireEvent.click(expand);
    const nest = transfer();
    fireEvent.dragStart(line(pages(), "Stops"), { dataTransfer: nest });
    await act(async () => void dragAt("drop", line(projects, "Plan"), nest, 0));
    await waitFor(async () => expect((await pathOf("Stops"))?.path).toBe("projects/beta/pages/stops.md"));
    const plan = await pathOf("Plan");
    expect((await pathOf("Stops"))?.parent).toBe(plan?.id);
    fireEvent.click(await within(projects).findByRole("button", { name: "Expand Plan" }));
    // Dropped on a row under Beta that does not take it (its own), it stays in Plan.
    const stray = transfer();
    fireEvent.dragStart(await waitFor(() => line(projects, "Stops")), { dataTransfer: stray });
    expect(dragAt("dragOver", line(projects, "Stops"), stray, 0)).toBe(true);
    await act(async () => void dragAt("drop", line(projects, "Stops"), stray, 0));
    await act(async () => new Promise((done) => setTimeout(done, 50)));
    expect((await pathOf("Stops"))?.parent).toBe(plan?.id);
    const out = transfer();
    fireEvent.dragStart(await waitFor(() => line(projects, "Stops")), { dataTransfer: out });
    expect(dragAt("dragOver", rowOf(projects, "beta"), out, 0)).toBe(false);
    await act(async () => void dragAt("drop", rowOf(projects, "beta"), out, 0));
    await waitFor(async () => expect((await pathOf("Stops"))?.parent ?? null).toBeNull());
    expect((await pathOf("Stops"))?.path).toBe("projects/beta/pages/stops.md");
  });

  it("offers a sub-page only on rows that hold pages", async () => {
    // Quick notes are left out of the sidebar unless asked for: a card is here to show it holds none.
    usePrefs.setState({ sidebarShowCards: true });
    const projects = await renderShell(new MemoryVault({ ...VAULT, "projects/beta/cards/idea.md": "---\ntitle: Idea\ntype: card\n---\n" }));
    const expand = within(projects).queryByRole("button", { name: "Expand Beta" });
    if (expand) fireEvent.click(expand);
    await within(projects).findByRole("button", { name: "Idea" });
    expect(within(projects).getByRole("button", { name: "Add a page to Beta" })).toBeTruthy();
    expect(within(projects).getByRole("button", { name: "Add a sub-page to Plan" })).toBeTruthy();
    expect(within(projects).queryByRole("button", { name: "Add a sub-page to Idea" })).toBeNull();
  });
});

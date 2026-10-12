// A page's mind map open on a whiteboard, against the browser preview's
// vault: it follows its page when opened, a chip syncs it when the page
// changes, branches whose line left the page are dimmed and can be taken
// off, and extra copies of the map can be moved to the trash.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { NoteMeta } from "../../../lib/vault/types";
import { splitFrontmatter } from "../../pages/markdown/frontmatter";
import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { derive } from "../../workspace/store-layout";
import { initialLayout } from "../../workspace/tabs";
import { SEED, TRIP } from "../map-fixtures";
import { useMapStatus } from "../map-live";
import { applySync, planSync } from "../map-sync";
import { MapChip } from "../MapChip";
import { mapFromPage, mapsOf, sendTo } from "../page-map";
import { outlineTree, readOutline } from "../outline";
import { useBoards } from "../store";
import { BoardCanvas } from "./BoardCanvas";
import { mockReactFlow } from "./test/flow-mocks";
import { forgetTrails } from "./trail";

let vault: MemoryVault;
let note: NoteMeta;

beforeAll(mockReactFlow);

beforeEach(async () => {
  localStorage.clear();
  forgetTrails();
  useMapStatus.setState({ by: {} });
  vault = new MemoryVault(SEED);
  note = (await vault.list()).find((n) => n.title === "Seaside trip")!;
  useWorkspace.setState({ client: vault, ready: true, notes: await vault.list(), ...derive(initialLayout()), stack: [], stackOpen: false, recent: [], toasts: [] });
  await useBoards.getState().load();
});
afterEach(cleanup);

async function editPage(change: (body: string) => string): Promise<void> {
  const file = await vault.read(note.path);
  await vault.saveBody(note.path, change(splitFrontmatter(file.text).body), file.hash);
  // The notes list is how the window learns the page changed.
  const notes = await vault.list();
  note = notes.find((n) => n.path === note.path)!;
  act(() => useWorkspace.setState({ notes }));
}

async function openMap(path: string) {
  await useBoards.getState().load();
  const view = render(
    <>
      <MapChip path={path} />
      <BoardCanvas path={path} />
    </>,
  );
  const board = await view.findByLabelText(/^Whiteboard:/);
  return { view, board };
}

const texts = async (path: string) => (await vault.board(path)).nodes.filter((n) => n.kind === "text").map((n) => n.text);
const toasts = () => useWorkspace.getState().toasts.map((t) => t.text);

describe("a page map when it opens", () => {
  it("takes on what the page gained, as one step to undo", async () => {
    const path = await mapFromPage(vault, note);
    await editPage((body) => body.replace("  - close to the trams\n", "  - close to the trams\n- Alfama\n").replace("- Baixa\n", "- Baixa district\n"));
    const { board } = await openMap(path);
    await waitFor(async () => expect(await texts(path)).toContain("Alfama"));
    expect(await texts(path)).toContain("Baixa district");
    expect(await texts(path)).not.toContain("Baixa");
    await waitFor(() => expect(toasts()).toContain("Mind map updated from “Seaside trip”: 1 new, 1 changed"));

    // One undo takes the whole sync back: the new branch, the reworded one and what the map remembers.
    fireEvent.keyDown(board, { key: "z", ctrlKey: true });
    await waitFor(async () => expect(await texts(path)).not.toContain("Alfama"));
    expect(await texts(path)).toContain("Baixa");
    const branches = Object.values((await vault.board(path)).source!.branches!);
    expect(branches.some((b) => b.key === "alfama")).toBe(false);
    expect(branches.find((b) => b.key === "baixa")?.text).toBe("Baixa");
  });

  it("leaves a map alone when its page has not changed", async () => {
    const path = await mapFromPage(vault, note);
    const before = JSON.stringify(await vault.board(path));
    await openMap(path);
    await screen.findByRole("button", { name: "Sync with page" });
    expect(JSON.stringify(await vault.board(path))).toBe(before);
    expect(toasts()).toEqual([]);
  });
});

describe("the Sync with page chip", () => {
  it("offers a sync once the page has changed, and brings the map in step", async () => {
    const path = await mapFromPage(vault, note);
    await openMap(path);
    await screen.findByRole("button", { name: "Sync with page" });
    await editPage((body) => body.replace("  - close to the trams\n", "  - close to the trams\n- Alfama\n"));
    const chip = await screen.findByRole("button", { name: "Page changed: sync" });
    expect(await texts(path)).not.toContain("Alfama");
    fireEvent.click(chip);
    await waitFor(async () => expect(await texts(path)).toContain("Alfama"));
    await screen.findByRole("button", { name: "Sync with page" });
    await waitFor(() => expect(toasts()).toContain("Mind map updated from “Seaside trip”: 1 new"));
  });

  it("says so when the map already follows the page, and writes nothing", async () => {
    const path = await mapFromPage(vault, note);
    await openMap(path);
    const before = JSON.stringify(await vault.board(path));
    fireEvent.click(await screen.findByRole("button", { name: "Sync with page" }));
    await waitFor(() => expect(toasts()).toContain("The map already follows “Seaside trip”"));
    expect(JSON.stringify(await vault.board(path))).toBe(before);
  });

  it("is told when the page it came from is gone", async () => {
    const path = await mapFromPage(vault, note);
    await vault.trash(note.path);
    act(() => useWorkspace.setState({ notes: [] }));
    await openMap(path);
    expect(await screen.findByText("Page not found")).toBeTruthy();
  });
});

describe("a branch whose line left the page", () => {
  it("is dimmed and marked, can be taken off in one click, and comes back with undo", async () => {
    const path = await mapFromPage(vault, note);
    await editPage((body) => body.replace("- [x] Insurance\n", ""));
    const { board } = await openMap(path);
    const mark = await within(board).findByText("Not in the page any more");
    expect(mark).toBeTruthy();
    const sticky = mark.closest(".kasten-sticky")!;
    expect(sticky.classList.contains("is-stale")).toBe(true);
    expect(sticky.textContent).toContain("Insurance");
    // The board still has it.
    expect(await texts(path)).toContain("☑ Insurance");

    fireEvent.click(within(sticky as HTMLElement).getByRole("button", { name: "Remove this branch from the map" }));
    await waitFor(async () => expect(await texts(path)).not.toContain("☑ Insurance"));
    const gone = (await vault.board(path)).source!.branches!;
    expect(Object.values(gone).some((b) => b.key === "insurance")).toBe(false);
    // A page that has not got the line does not bring it back.
    expect(within(board).queryByText("Not in the page any more")).toBeNull();

    fireEvent.keyDown(board, { key: "z", ctrlKey: true });
    await waitFor(async () => expect(await texts(path)).toContain("☑ Insurance"));
    await within(board).findByText("Not in the page any more");
  });
});

/** A map as the first versions made them, with no record of its page. */
async function oldMap(): Promise<string> {
  const path = await vault.createBoard(`${note.title} map`, note.project);
  const lines: [string, number][] = [];
  const walk = (nodes: ReturnType<typeof outlineTree>, parent: number) => {
    for (const n of nodes) {
      lines.push([n.text, parent]);
      walk(n.children, lines.length);
    }
  };
  walk(outlineTree(TRIP), 0);
  const made = await vault.boardApply(path, [{ kind: "card", path: note.path, x: 0, y: 0 }, ...lines.map(([text], i) => ({ kind: "sticky" as const, text, x: 400 * (i + 1), y: 0 }))]);
  await vault.boardApply(path, lines.map(([, parent], i) => ({ kind: "connect" as const, from: made.made[parent]!, to: made.made[i + 1]!, fromSide: "right" as const, toSide: "left" as const })));
  return path;
}

describe("extra copies of a map", () => {
  it("are listed in a notice and moved to the trash after a confirmation", async () => {
    const paths = [await oldMap(), await oldMap(), await oldMap()];
    // Opening the page's map picks one and marks it; the other two are copies.
    const path = await mapFromPage(vault, note);
    expect(paths).toContain(path);
    const extras = paths.filter((p) => p !== path);
    await openMap(path);
    const notice = await screen.findByRole("button", { name: /2 more copies of this map/ });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(notice);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Move the extra copies to the trash?")).toBeTruthy();
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(2);
    // Cancelling changes nothing.
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect((await vault.boards()).map((b) => b.path).sort()).toEqual([...paths].sort());

    fireEvent.click(await screen.findByRole("button", { name: /2 more copies of this map/ }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Move 2 to the trash" }));
    await waitFor(async () => expect((await vault.boards()).map((b) => b.path)).toEqual([path]));
    // Trash only: both can be brought back.
    const trashed = await vault.listTrash();
    expect(trashed.map((t) => t.original).sort()).toEqual([...extras].sort());
    await waitFor(() => expect(toasts()).toContain("Moved 2 extra copies to the trash"));
    await waitFor(() => expect(screen.queryByRole("button", { name: /more cop/ })).toBeNull());
  });

  it("send a copy, opened by itself, to the page's map", async () => {
    const paths = [await oldMap(), await oldMap()];
    const path = await mapFromPage(vault, note);
    // The other one is marked as the page's too, as an older copy that was synced once would be.
    const other = paths.find((p) => p !== path)!;
    const doc = await vault.board(other);
    const body = splitFrontmatter((await vault.read(note.path)).text).body;
    await applySync(doc, planSync(doc, note, readOutline(body))!, sendTo(vault, other));
    const [primary] = await mapsOf(vault, note);
    const copy = [path, other].find((p) => p !== primary!.path)!;
    await openMap(copy);
    fireEvent.click(await screen.findByRole("button", { name: /Open the page's map/ }));
    expect(useWorkspace.getState().place).toEqual({ view: "boards", path: primary!.path });
    expect(screen.queryByRole("button", { name: /Sync with page/ })).toBeNull();
  });
});

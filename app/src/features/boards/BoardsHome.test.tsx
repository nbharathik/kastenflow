import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { usePrefs } from "../workspace/prefs";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { useWorkspace } from "../workspace/store";
import { BoardsHome } from "./BoardsHome";
import { useBoards } from "./store";

const board = (title: string, nodes: object[] = []) => JSON.stringify({ nodes, edges: [], "x-kasten": { title } });
const SEED = {
  "projects/trip/_project.md": "---\ntitle: Summer trip\ntype: project\n---\nPlans.\n",
  "projects/trip/boards/route.canvas": board("Route ideas", [{ id: "a", type: "text", text: "Hilltown", x: 0, y: 0, width: 260, height: 120 }]),
  "library/reading.canvas": board("Reading map"),
};

async function open(seed: Record<string, string> = SEED) {
  const vault = new MemoryVault(seed);
  useWorkspace.setState({ place: { view: "boards" }, toasts: [] });
  await useWorkspace.getState().connect({ client: vault });
  render(<BoardsHome />);
  return vault;
}

beforeEach(() => {
  localStorage.clear();
  usePrefs.setState({ favourites: [] });
  useBoards.setState({ list: [], loaded: false, creating: false, onlyProject: null });
});
afterEach(cleanup);

describe("Whiteboards", () => {
  it("shows every board by project, with how much is on it", async () => {
    await open();
    const trip = await screen.findByRole("region", { name: "Summer trip" });
    expect(within(trip).getByRole("button", { name: "Open Route ideas" }).textContent).toContain("1 thing");
    const loose = screen.getByRole("region", { name: "Not in a project" });
    expect(within(loose).getByRole("button", { name: "Open Reading map" })).toBeTruthy();
  });

  it("opens a board, and stars it for the sidebar", async () => {
    await open();
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Open Reading map" })));
    expect(useWorkspace.getState().place).toEqual({ view: "boards", path: "library/reading.canvas" });
    fireEvent.click(screen.getByRole("button", { name: "Add Reading map to Favourites" }));
    expect(usePrefs.getState().favourites).toEqual(["library/reading.canvas"]);
  });

  it("narrows the boards by title", async () => {
    await open();
    await screen.findByRole("button", { name: "Open Route ideas" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a whiteboard" }), { target: { value: "read" } });
    expect(screen.queryByRole("button", { name: "Open Route ideas" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open Reading map" })).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a whiteboard" }), { target: { value: "zzz" } });
    expect(screen.getByText("No whiteboard is called “zzz”.")).toBeTruthy();
  });

  it("shows only one project's boards when a project's home asks, until told to show them all", async () => {
    useBoards.setState({ onlyProject: "trip" });
    await open();
    await screen.findByRole("button", { name: "Open Route ideas" });
    expect(screen.queryByRole("button", { name: "Open Reading map" })).toBeNull();
    expect(screen.getByText("Only the boards of Summer trip.")).toBeTruthy();
    // The view took the request: it is not asked again on the next visit.
    expect(useBoards.getState().onlyProject).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show every project" }));
    expect(screen.getByRole("button", { name: "Open Reading map" })).toBeTruthy();
    expect(screen.queryByText(/Only the boards of/)).toBeNull();
  });

  it("makes a new board in a project and opens it", async () => {
    const vault = await open();
    fireEvent.click(await screen.findByRole("button", { name: "New whiteboard" }));
    const form = screen.getByRole("form", { name: "New whiteboard" });
    fireEvent.change(within(form).getByRole("textbox", { name: "Title" }), { target: { value: "Food map" } });
    fireEvent.change(within(form).getByRole("combobox", { name: "Project" }), { target: { value: "trip" } });
    await act(async () => fireEvent.click(within(form).getByRole("button", { name: "Create" })));
    expect(useWorkspace.getState().place).toEqual({ view: "boards", path: "projects/trip/boards/food-map.canvas" });
    expect((await vault.boards()).map((b) => b.title)).toContain("Food map");
    expect(useBoards.getState().list.map((b) => b.title)).toContain("Food map");
  });

  it("invites you to make the first one", async () => {
    await open({ "library/welcome.md": "---\ntitle: Welcome\n---\nHi\n" });
    expect(await screen.findByText("No whiteboards yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Make your first whiteboard" }));
    expect(screen.getByRole("form", { name: "New whiteboard" })).toBeTruthy();
  });

  it("moves a board to the trash, and Undo brings it back", async () => {
    const vault = await open();
    await screen.findByRole("button", { name: "Open Reading map" });
    await act(async () => useWorkspace.getState().trash("library/reading.canvas"));
    expect((await vault.boards()).map((b) => b.title)).toEqual(["Route ideas"]);
    await expect.poll(() => screen.queryByRole("button", { name: "Open Reading map" })).toBeNull();
    const toast = useWorkspace.getState().toasts.at(-1)!;
    expect(toast.text).toBe("Moved “Reading map” to the trash");
    await act(async () => toast.action!.run());
    await expect.poll(async () => (await vault.boards()).map((b) => b.title)).toContain("Reading map");
    expect(await screen.findByRole("button", { name: "Open Reading map" })).toBeTruthy();
    expect(useWorkspace.getState().toasts.at(-1)!.text).toBe("Restored “Reading map”");
  });
});

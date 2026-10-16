// Collections pinned to Home or a project's overview: nothing loads while
// nothing is pinned; a pinned one shows how many notes it finds now and the
// first few, opens on a click and unpins from its card.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryVault } from "../workspace/preview/memory-vault";
import { useWorkspace } from "../workspace/store";
import { usePins } from "./pins";
import { PinnedSlot } from "./PinnedSlot";

const SEED = {
  "library/a.md": "---\nid: 01A\ntitle: Alpha\ntags: [reading]\n---\nA.\n",
  "library/b.md": "---\nid: 01B\ntitle: Beta\ntags: [reading]\n---\nB.\n",
};
const READING = "views/reading-queue.yaml";
const HOME = { kind: "home" } as const;

let vault: MemoryVault;
const go = vi.fn();
const hit = (path: string) => ({ path, title: path, icon: null, snippet: "", score: 1 });

beforeEach(async () => {
  localStorage.clear();
  usePins.setState({ pins: { home: [], projects: {} } });
  go.mockClear();
  vault = new MemoryVault({ ...SEED });
  await vault.createCollection("Reading queue", { query: "tag:reading" });
  vi.spyOn(vault, "search").mockResolvedValue([hit("library/a.md"), hit("library/b.md")]);
  useWorkspace.setState({ client: vault, notes: await vault.list(), go });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("pinned collections", () => {
  it("show nothing, and read nothing, while nothing is pinned there", async () => {
    const read = vi.spyOn(vault, "collections");
    const { container } = render(<PinnedSlot scope={HOME} />);
    expect(container.textContent).toBe("");
    // A pin on another project's overview is no pin here.
    act(() => usePins.getState().pin({ kind: "project", folder: "trip" }, READING));
    expect(container.textContent).toBe("");
    expect(read).not.toHaveBeenCalled();
  });

  it("show a card with the count and the first notes, and open the collection on a click", async () => {
    act(() => usePins.getState().pin(HOME, READING));
    render(<PinnedSlot scope={HOME} />);
    const list = within(await screen.findByRole("list", { name: "Pinned collections" }));
    const card = await list.findByRole("button", { name: /^Reading queue/ });
    await waitFor(() => expect(card.textContent).toContain("2"));
    expect(card.textContent).toContain("Alpha · Beta");
    fireEvent.click(card);
    expect(go).toHaveBeenCalledWith({ view: "collections", path: READING });
  });

  it("are unpinned from the card, which leaves the collection itself alone", async () => {
    act(() => usePins.getState().pin(HOME, READING));
    const { container } = render(<PinnedSlot scope={HOME} />);
    fireEvent.click(await screen.findByRole("button", { name: "Unpin Reading queue" }));
    expect(usePins.getState().pins.home).toEqual([]);
    expect(container.textContent).toBe("");
    expect((await vault.collections()).map((c) => c.path)).toEqual([READING]);
    expect(JSON.parse(localStorage.getItem("kasten.collection-pins")!)).toEqual({ home: [], projects: {} });
  });

  it("leave out one that is gone or cannot be used", async () => {
    (vault as unknown as { data: { views: Record<string, string> } }).data.views["views/future.yaml"] = "format: 2\nname: From the future\nquery: tag:x\n";
    act(() => {
      usePins.getState().pin(HOME, "views/gone.yaml");
      usePins.getState().pin(HOME, "views/future.yaml");
    });
    const { container } = render(<PinnedSlot scope={HOME} />);
    await waitFor(() => expect(vault.search).not.toHaveBeenCalled());
    // Reading the collections takes a moment; nothing appears for either.
    await act(async () => {
      await vault.collections();
    });
    expect(container.textContent).toBe("");
    act(() => usePins.getState().pin(HOME, READING));
    expect(await screen.findByRole("button", { name: /^Reading queue/ })).toBeTruthy();
    expect(screen.queryByText("From the future")).toBeNull();
  });
});

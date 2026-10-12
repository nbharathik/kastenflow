import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SEED } from "../features/boards/map-fixtures";
import { useBoards } from "../features/boards/store";
import { useSources } from "../features/sources/store";
import { PRIMER, sampleVault } from "../features/sources/test-kit";
import { MemoryVault } from "../features/workspace/preview/memory-vault";
import { useWorkspace } from "../features/workspace/store";
import { TopBar } from "./TopBar";

const bar = () => render(<TopBar pane={useWorkspace.getState().layout.panes[0]!} first />);

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("the top bar", () => {
  it("shows a PDF in the reader under Highlights, the way back to them all", async () => {
    await sampleVault();
    await useSources.getState().loadList();
    useWorkspace.getState().go({ view: "highlights", path: PRIMER });
    bar();
    expect(screen.getByText("A Zettelkasten primer")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Highlights" }));
    expect(useWorkspace.getState().place).toEqual({ view: "highlights" });
  });

  it("names a view with nothing open in it", async () => {
    await sampleVault();
    useWorkspace.getState().go({ view: "highlights" });
    bar();
    expect(screen.getByText("Highlights")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Highlights" })).toBeNull();
  });
});

describe("a page's mind map in the page menu", () => {
  const PAGE = "projects/trip/pages/seaside.md";

  /** Opens the page, its menu, and picks `label`. */
  async function pick(label: string) {
    cleanup();
    useWorkspace.getState().openPath(PAGE);
    bar();
    fireEvent.click(screen.getByRole("button", { name: "Page options" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: new RegExp(`^${label}`) }));
  }

  it("makes it once, and then opens it however many times it is asked", async () => {
    const vault = new MemoryVault(SEED);
    await useWorkspace.getState().connect({ client: vault });
    useBoards.setState({ list: [], loaded: false });
    await pick("Mind map from this page");
    await waitFor(async () => expect(await vault.boards()).toHaveLength(1));
    const [made] = await vault.boards();
    await waitFor(() => expect(useWorkspace.getState().place).toEqual({ view: "boards", path: made!.path }));
    expect(useWorkspace.getState().toasts.map((t) => t.text)).toContain("Made “Seaside trip map”: Tab on a branch grows it");

    // The menu now opens it instead of making another one.
    for (let i = 0; i < 3; i++) {
      await pick("Open mind map");
      await waitFor(() => expect(useWorkspace.getState().place).toEqual({ view: "boards", path: made!.path }));
    }
    expect(await vault.boards()).toHaveLength(1);
    expect(screen.queryByRole("menuitem", { name: /^Mind map from this page/ })).toBeNull();
  });
});

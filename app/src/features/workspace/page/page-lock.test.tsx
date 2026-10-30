// Locking the open page for agents from its menu: `locked: true` goes in
// its frontmatter through the page's own session, so later changes to the
// page build on it, and the menu then offers to unlock it.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppShell } from "../../../shell/AppShell";
import { useShell } from "../../../lib/store";
import { MemoryVault } from "../preview/memory-vault";
import { useWorkspace } from "../store";
import { derive } from "../store-layout";
import { initialLayout } from "../tabs";

const PATH = "library/ledger.md";

describe("locking a page for agents", () => {
  beforeEach(() => {
    localStorage.clear();
    useWorkspace.setState({ client: null, ready: false, notes: [], ...derive(initialLayout()), recent: [], toasts: [] });
    useShell.setState({ sidebarOpen: true, focusMode: false, paletteOpen: false, panels: [] });
  });
  afterEach(cleanup);

  it("locks from the page menu, keeps later changes on top, and unlocks again", async () => {
    const vault = new MemoryVault({ [PATH]: "---\ntitle: Ledger\n---\nSums.\n" });
    render(<AppShell connect={async () => ({ client: vault })} />);
    await screen.findByRole("navigation", { name: "Sidebar" });
    act(() => useWorkspace.getState().openPath(PATH));
    await screen.findByRole("textbox", { name: "Page title" }, { timeout: 90_000 });
    const file = async () => (await vault.read(PATH)).text;
    const menu = async () => {
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Page options" })));
      return screen.getByRole("menu");
    };

    await act(async () => fireEvent.click(within(await menu()).getByRole("menuitem", { name: "Lock for agents" })));
    await waitFor(async () => expect(await file()).toContain("\nlocked: true\n"));
    expect(useWorkspace.getState().notes.find((n) => n.path === PATH)?.locked).toBe(true);

    // A style chosen next builds on the locked file.
    const style = within(await menu()).getByRole("group", { name: "Style of this page" });
    await act(async () => fireEvent.click(within(style).getByRole("button", { name: /Serif/ })));
    await waitFor(async () => expect(await file()).toMatch(/locked: true\n[^]*font: serif\n/));
    await act(async () => fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" }));

    await act(async () => fireEvent.click(within(await menu()).getByRole("menuitem", { name: "Unlock for agents" })));
    await waitFor(async () => expect(await file()).not.toContain("locked"));
    expect(await file()).toContain("font: serif\n");
  }, 120_000);
});

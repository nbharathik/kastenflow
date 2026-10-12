import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadNotePage } from "../../features/workspace/page/LazyNotePage";

import { usePrefs } from "../../features/workspace/prefs";
import { MemoryVault } from "../../features/workspace/preview/memory-vault";
import { useWorkspace } from "../../features/workspace/store";
import { ARCHIVED, choose, freshWindow, GAMMA, order, renderShell, SEED } from "./test-shell";

let vault: MemoryVault;

beforeAll(async () => { await loadNotePage(); }, 60_000);

beforeEach(() => {
  freshWindow();
  vault = new MemoryVault(ARCHIVED);
});
afterEach(cleanup);

describe("an archived project beyond the sidebar", () => {
  it("says so on its page, which unarchives it", async () => {
    const projects = await renderShell(vault);
    await act(async () => useWorkspace.getState().openPath(GAMMA));
    const banner = await screen.findByRole("note", { name: "Archived project" }, { timeout: 20_000 });
    expect(banner.textContent).toContain("This project is archived");
    // The sidebar unfolds the group to show where the page is.
    expect(within(projects).getByRole("button", { name: "Archived (1)" }).getAttribute("aria-expanded")).toBe("true");
    await act(async () => fireEvent.click(within(banner).getByRole("button", { name: "Unarchive" })));
    expect((await vault.read(GAMMA)).text).toBe(SEED[GAMMA]);
    expect(screen.queryByRole("note", { name: "Archived project" })).toBeNull();
    expect(order(projects)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("archived while on screen, its page says so at once and the group stays folded", async () => {
    vault = new MemoryVault(SEED);
    const projects = await renderShell(vault);
    await act(async () => useWorkspace.getState().openPath("projects/beta/_project.md"));
    await screen.findByRole("textbox", { name: "Page title" }, { timeout: 20_000 });
    await choose(projects, "Beta", /Archive project/);
    expect(await screen.findByRole("note", { name: "Archived project" })).toBeTruthy();
    expect((await vault.read("projects/beta/_project.md")).text).toContain("props:\n  archived: true\n");
    expect(within(projects).getByRole("button", { name: "Archived (1)" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("stays in search, and off Home, which follows the sidebar's order", async () => {
    // Home's projects row is optional: turn it on.
    usePrefs.setState({ pinnedProjects: ["beta"], homeSections: ["projects", "recent"] });
    await renderShell(vault);
    const home = await within(screen.getByRole("region", { name: "Pane" })).findByRole("group", { name: "Projects" });
    const chips = [...home.querySelectorAll(".kasten-home-chip-label")].map((chip) => chip.textContent);
    expect(chips).toEqual(["Beta", "Alpha"]);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), { target: { value: "gamma" } });
    const found = screen.getByRole("listbox", { name: "Results" }).querySelector('[aria-selected="true"]');
    expect(found?.textContent).toContain("Gamma");
    expect(found?.textContent).toContain("Archived project");
  });
});

import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useShell } from "../../lib/store";
import { actionFor } from "../workspace/shortcuts";
import { useWorkspace } from "../workspace/store";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { PANEL_WIDTH, usePanel } from "./panel-store";
import { openWithPanel } from "./test-page";

const PATH = "library/plan.md";
const SEED = {
  [PATH]: "---\ntitle: Plan\ncreated: 2026-09-20T08:00:00Z\n---\n## Goals\n\nShip the panel this week.\n\n### Later\n\nPolish it.\n",
};

let vault: MemoryVault;

beforeEach(() => {
  localStorage.clear();
  vault = new MemoryVault(SEED);
});
afterEach(cleanup);

const pane = () => useWorkspace.getState().layout.focus;

describe("Right panel", () => {
  it("shows the details in one tab, the history in the next and the comments in the third, and remembers which", async () => {
    const { panel } = await openWithPanel(vault, PATH, "history");
    const tabs = within(panel).getByRole("tablist", { name: "Panel" });
    expect(within(tabs).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Details", "History", "Comments"]);
    fireEvent.click(within(tabs).getByRole("tab", { name: "Details" }));
    expect(within(tabs).getByRole("tab", { name: "Details" }).getAttribute("aria-selected")).toBe("true");
    // Properties, outline and links, one under the other. (The page footer
    // lists backlinks too; this is the panel's list.)
    for (const name of ["Tags", "Outline", "About this page"]) expect(within(panel).getByRole("region", { name })).toBeTruthy();
    expect(await within(panel).findByRole("region", { name: "Backlinks" })).toBeTruthy();
    fireEvent.keyDown(within(tabs).getByRole("tab", { name: "Details" }), { key: "ArrowRight" });
    expect(usePanel.getState().tab).toBe("history");
    expect(localStorage.getItem("kasten.panel.tab")).toBe("history");
  });

  it("opens an old saved tab as the details", async () => {
    localStorage.setItem("kasten.panel.tab", "outline");
    vi.resetModules();
    const { usePanel: fresh } = await import("./panel-store");
    expect(fresh.getState().tab).toBe("details");
  });

  it("shows the outline from the live page and the page's facts", async () => {
    const { panel } = await openWithPanel(vault, PATH, "details");
    const outline = within(panel).getByRole("region", { name: "Outline" });
    await expect.poll(() => within(outline).queryAllByRole("button").map((b) => b.textContent)).toEqual(["Goals", "Later"]);
    const facts = within(panel).getByRole("region", { name: "About this page" });
    await expect.poll(() => facts.textContent).toMatch(/Words\d+/);
    expect(facts.textContent).toContain(PATH);
    expect(facts.textContent).toContain("2026");
  });

  it("opens on History with Ctrl+Shift+H, closes with its button", async () => {
    await openWithPanel(vault, PATH, "details");
    act(() => useShell.setState({ panels: [] }));
    expect(screen.queryByRole("complementary", { name: "Page details" })).toBeNull();
    const action = actionFor(new KeyboardEvent("keydown", { key: "H", ctrlKey: true, shiftKey: true }));
    act(() => action!());
    expect(useShell.getState().panels).toEqual([useWorkspace.getState().layout.focus]);
    const tab = screen.getByRole("tab", { name: "History" });
    expect(tab.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Close panel" }));
    expect(screen.queryByRole("complementary", { name: "Page details" })).toBeNull();
  });

  it("resizes within bounds and keeps the width", async () => {
    const { panel } = await openWithPanel(vault, PATH, "details");
    act(() => usePanel.getState().setWidth(pane(), PANEL_WIDTH.initial));
    const handle = within(panel).getByRole("separator", { name: "Resize the panel" });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(panel.style.width).toBe(`${PANEL_WIDTH.initial + 16}px`);
    expect(localStorage.getItem("kasten.panel.width")).toBe(String(PANEL_WIDTH.initial + 16));
    fireEvent.keyDown(handle, { key: "End" });
    expect(panel.style.width).toBe(`${PANEL_WIDTH.max}px`);
    act(() => usePanel.getState().setWidth(pane(), 10, true));
    expect(panel.style.width).toBe(`${PANEL_WIDTH.min}px`);
    fireEvent.doubleClick(handle);
    expect(panel.style.width).toBe(`${PANEL_WIDTH.initial}px`);

    // Dragging the edge left widens the panel; the width is kept on release.
    fireEvent.pointerDown(handle, { button: 0, clientX: 1000 });
    fireEvent.pointerMove(window, { clientX: 900 });
    expect(panel.style.width).toBe(`${PANEL_WIDTH.initial + 100}px`);
    expect(localStorage.getItem("kasten.panel.width")).toBe(String(PANEL_WIDTH.initial));
    fireEvent.pointerUp(window, { clientX: 900 });
    expect(localStorage.getItem("kasten.panel.width")).toBe(String(PANEL_WIDTH.initial + 100));
    fireEvent.pointerMove(window, { clientX: 500 });
    expect(panel.style.width).toBe(`${PANEL_WIDTH.initial + 100}px`);
  });
});

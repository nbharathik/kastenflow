// The Projects hub: the card's menu, the keyboard, and a long list.

import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectSummary } from "../../../lib/vault/project-types";
import { usePrefs } from "../../workspace/prefs";
import { useWorkspace } from "../../workspace/store";
import { useExportRequest } from "../export/request";
import { cardOf, mountHub, setup, titles } from "./hub-test-kit";
import { at, garden, HOUR, NOW, photos, summary, trip } from "./test-support";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the card's menu", () => {
  const open = (title: string) => fireEvent.click(screen.getByRole("button", { name: `More for ${title}` }));

  it("opens from the … button, a right-click and the menu key, with the project's name", async () => {
    setup([photos, trip]);
    await mountHub();
    open("Trip");
    expect(screen.getByRole("menu", { name: "Trip options" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("menu", { name: "Trip options" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    fireEvent.contextMenu(cardOf("Photo organiser"));
    expect(screen.getByRole("menu", { name: "Photo organiser options" })).toBeTruthy();
  });

  it("asks for the export dialog on that project, which shows what would go in before it writes", async () => {
    setup([photos, trip]);
    await mountHub();
    open("Trip");
    fireEvent.click(screen.getByRole("menuitem", { name: "Export project…" }));
    expect(useExportRequest.getState().request).toEqual({ project: trip.folder });
    useExportRequest.setState({ request: null });
  });

  it("closes again when the … button of the same card is pressed", async () => {
    setup([photos, trip]);
    await mountHub();
    open("Trip");
    expect(screen.getByRole("menu", { name: "Trip options" })).toBeTruthy();
    open("Trip");
    expect(screen.queryByRole("menu")).toBeNull();
    open("Photo organiser");
    expect(screen.getByRole("menu", { name: "Photo organiser options" })).toBeTruthy();
  });

  it("sets the status and the health through the core, ticks the current ones and offers Undo", async () => {
    const { client } = setup([photos]);
    await mountHub();
    open("Photo organiser");
    expect(screen.getByRole("menuitemcheckbox", { name: "Status: Active" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("menuitemcheckbox", { name: "Health: At risk" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Status: Paused" }));
    await waitFor(() => expect(client.setProjectState).toHaveBeenCalledWith("projects/photos/_project.md", { status: "Paused" }));
    await waitFor(() => expect(useWorkspace.getState().toasts.at(-1)?.text).toBe("“Photo organiser” is now Paused"));
    expect(useWorkspace.getState().toasts.at(-1)?.action?.label).toBe("Undo");
    open("Photo organiser");
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Health: Blocked" }));
    await waitFor(() => expect(client.setProjectState).toHaveBeenCalledWith("projects/photos/_project.md", { health: "Blocked" }));
    open("Photo organiser");
    fireEvent.click(screen.getByRole("menuitem", { name: "Clear health" }));
    await waitFor(() => expect(client.setProjectState).toHaveBeenCalledWith("projects/photos/_project.md", { health: null }));
  });

  it("pins and unpins with the sidebar's pin", async () => {
    setup([photos, trip]);
    await mountHub();
    open("Trip");
    fireEvent.click(screen.getByRole("menuitem", { name: /^Pin to the top/ }));
    expect(usePrefs.getState().pinnedProjects).toEqual(["trip"]);
    expect(titles()).toEqual(["Trip", "Photo organiser"]);
    expect(within(cardOf("Trip")).getByRole("img", { name: "Pinned" })).toBeTruthy();
    open("Trip");
    fireEvent.click(screen.getByRole("menuitem", { name: /^Unpin/ }));
    expect(usePrefs.getState().pinnedProjects).toEqual([]);
  });

  it("archives, and the notice offers Undo", async () => {
    const { client } = setup([photos]);
    await mountHub();
    open("Photo organiser");
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive project" }));
    await waitFor(() => expect(client.updateProps).toHaveBeenCalledWith("projects/photos/_project.md", { archived: true }));
    await waitFor(() => expect(useWorkspace.getState().toasts.at(-1)?.text).toBe("Archived “Photo organiser”"));
  });

  it("makes a dated update from the Project update template, in the project, and opens it", async () => {
    const { client } = setup([photos]);
    await mountHub();
    open("Photo organiser");
    fireEvent.click(screen.getByRole("menuitem", { name: "New update" }));
    await waitFor(() => expect(client.create).toHaveBeenCalledTimes(1));
    expect(client.create).toHaveBeenCalledWith(expect.objectContaining({ kind: "page", title: "Update 2026-10-11", project: "photos", template: "project-update", date: "2026-10-11" }));
  });

  it("opens the overview in a tab", async () => {
    setup([photos]);
    await mountHub();
    open("Photo organiser");
    fireEvent.click(screen.getByRole("menuitem", { name: /^Open in new tab/ }));
    expect(useWorkspace.getState().layout.panes[0]!.tabs.map((t) => t.place.view)).toEqual(["home", "overview"]);
  });

  it("offers to resume the tabs saved for the project, and for no other", async () => {
    setup([photos, trip]);
    usePrefs.setState({ tabSets: [{ name: "Photo work", project: "photos", tabs: [{ place: { view: "page", path: "projects/photos/pages/a.md" }, pinned: false }] }] });
    await mountHub();
    open("Trip");
    expect(screen.queryByRole("menuitem", { name: "Resume workspace" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    open("Photo organiser");
    fireEvent.click(screen.getByRole("menuitem", { name: "Resume workspace" }));
    expect(useWorkspace.getState().layout.panes[0]!.tabs.map((t) => t.place.path ?? t.place.view)).toContain("projects/photos/pages/a.md");
  });

  it("moves a project earlier or later in the order the sidebar keeps, only while the list is whole", async () => {
    setup([garden, photos, trip]);
    await mountHub();
    expect(titles()).toEqual(["Garden", "Photo organiser", "Trip"]);
    open("Photo organiser");
    fireEvent.click(screen.getByRole("menuitem", { name: /^Move earlier/ }));
    expect(titles()).toEqual(["Photo organiser", "Garden", "Trip"]);
    expect(usePrefs.getState().projectOrder.indexOf("photos")).toBeLessThan(usePrefs.getState().projectOrder.indexOf("garden"));
    fireEvent.click(screen.getByRole("button", { name: "Paused 1" }));
    open("Trip");
    expect(screen.queryByRole("menuitem", { name: /^Move earlier/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /^Move later/ })).toBeNull();
  });
});

describe("the keyboard", () => {
  const card = (title: string) => screen.getByRole("button", { name: `Open ${title}` });

  it("keeps one card in the tab order, and the arrows move between cards", async () => {
    setup([garden, photos, trip]);
    await mountHub();
    const tabbable = screen.getAllByRole("button", { name: /^Open / }).filter((b) => b.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toBe(card("Garden"));
    // Cards past the first have no inner button in the tab order.
    expect((screen.getByRole("button", { name: "More for Trip" }) as HTMLButtonElement).tabIndex).toBe(-1);
    card("Garden").focus();
    fireEvent.keyDown(card("Garden"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(card("Photo organiser"));
    expect(card("Photo organiser").tabIndex).toBe(0);
    expect(card("Garden").tabIndex).toBe(-1);
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(card("Trip"));
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(card("Garden"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(card("Garden"));
  });

  it("goes down by a row when the cards sit in rows", async () => {
    setup([garden, photos, trip]);
    await mountHub();
    const grid = screen.getByRole("list", { name: "Project gallery" });
    // Two cards to a row: 17rem cards and 16px between them in 600px.
    Object.defineProperty(grid, "clientWidth", { configurable: true, value: 600 });
    card("Garden").focus();
    fireEvent.keyDown(card("Garden"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(card("Trip"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(card("Garden"));
  });

  it("opens the overview on Enter, the project page on Shift+Enter, a tab on Ctrl+Enter", async () => {
    setup([photos]);
    await mountHub();
    card("Photo organiser").focus();
    fireEvent.keyDown(card("Photo organiser"), { key: "Enter", ctrlKey: true });
    expect(useWorkspace.getState().layout.panes[0]!.tabs.map((t) => t.place.view)).toEqual(["home", "overview"]);
    fireEvent.keyDown(card("Photo organiser"), { key: "Enter", shiftKey: true });
    expect(useWorkspace.getState().place).toEqual({ view: "page", path: "projects/photos/_project.md" });
    fireEvent.keyDown(card("Photo organiser"), { key: "Enter" });
    expect(useWorkspace.getState().place).toEqual({ view: "overview", path: "projects/photos/_project.md" });
  });

  it("pins on P, and keeps the focus on the card as it moves", async () => {
    setup([garden, photos, trip]);
    await mountHub();
    card("Trip").focus();
    fireEvent.keyDown(card("Trip"), { key: "p" });
    expect(usePrefs.getState().pinnedProjects).toEqual(["trip"]);
    expect(titles()[0]).toBe("Trip");
    await waitFor(() => expect(document.activeElement).toBe(card("Trip")));
    fireEvent.keyDown(card("Trip"), { key: "P" });
    expect(usePrefs.getState().pinnedProjects).toEqual([]);
  });

  it("opens the menu on the menu key, and Escape gives the focus back to the card", async () => {
    setup([photos]);
    await mountHub();
    card("Photo organiser").focus();
    fireEvent.keyDown(card("Photo organiser"), { key: "ContextMenu" });
    const menu = screen.getByRole("menu", { name: "Photo organiser options" });
    expect(menu).toBeTruthy();
    expect(menu.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(card("Photo organiser")));
  });

  it("moves a project with Alt and the arrows, in the sidebar's order", async () => {
    setup([garden, photos, trip]);
    await mountHub();
    card("Photo organiser").focus();
    fireEvent.keyDown(card("Photo organiser"), { key: "ArrowRight", altKey: true });
    expect(titles()).toEqual(["Garden", "Trip", "Photo organiser"]);
    await waitFor(() => expect(document.activeElement).toBe(card("Photo organiser")));
    fireEvent.keyDown(card("Photo organiser"), { key: "ArrowLeft", altKey: true });
    expect(titles()).toEqual(["Garden", "Photo organiser", "Trip"]);
  });

  it("goes from the search field to the first card on Arrow Down", async () => {
    setup([garden, photos]);
    await mountHub();
    const field = screen.getByRole("textbox", { name: "Search projects" });
    field.focus();
    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(document.activeElement).toBe(card("Garden"));
  });
});

describe("a long list", () => {
  const many = (n: number): ProjectSummary[] => Array.from({ length: n }, (_, i) => summary(`p${String(i + 1).padStart(3, "0")}`, { title: `Project ${String(i + 1).padStart(3, "0")}`, latest: at(i * HOUR) }));

  it("draws all 200 cards of the gallery, and finds one by search", async () => {
    setup(many(200));
    await mountHub();
    expect(titles()).toHaveLength(200);
    fireEvent.change(screen.getByRole("textbox", { name: "Search projects" }), { target: { value: "project 150" } });
    await waitFor(() => expect(titles()).toEqual(["Project 150"]));
  });

  it("draws only the rows in view in the list, and the keys reach the last row", async () => {
    setup(many(200));
    await mountHub();
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    await screen.findByRole("list", { name: "Project list" });
    expect(titles().length).toBeLessThan(40);
    expect(titles()[0]).toBe("Project 001");
    const first = screen.getByRole("button", { name: "Open Project 001" });
    first.focus();
    act(() => {
      fireEvent.keyDown(first, { key: "End" });
    });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open Project 200" })));
    expect(titles().length).toBeLessThan(60);
    expect(titles().at(-1)).toBe("Project 200");
    // The rows not drawn are blank space, so the list is as tall as 200 rows.
    expect(screen.getByRole("list", { name: "Project list" }).style.paddingTop).not.toBe("0px");
  });

  it("sorts 200 projects by recent activity without drawing them twice", async () => {
    setup(many(200));
    await mountHub();
    fireEvent.click(screen.getByRole("button", { name: /^Sort:/ }));
    fireEvent.click(await screen.findByRole("option", { name: "Recently active" }));
    expect(titles()[0]).toBe("Project 001");
    expect(titles()[199]).toBe("Project 200");
  });
});

// The Projects hub: what a card says, the filters, search, sort and counts, and
// the empty states. The card menu, the keyboard and a long list are in
// ProjectsHubActions.test.tsx.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePrefs } from "../../workspace/prefs";
import { useWorkspace } from "../../workspace/store";
import { useHubPrefs } from "./hub-prefs";
import { cardOf, mountHub, setup, titles } from "./hub-test-kit";
import { ProjectsHub } from "./ProjectsHub";
import { garden, NOW, old, photos, taxes, trip } from "./test-support";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("a project's card", () => {
  it("says what the project is and how it is going", async () => {
    setup([photos]);
    await mountHub();
    const card = within(cardOf("Photo organiser"));
    expect(card.getByRole("heading", { name: "Photo organiser" })).toBeTruthy();
    expect(card.getByText("Active")).toBeTruthy();
    expect(card.getByText("At risk")).toBeTruthy();
    expect(card.getByText("Sort and back up the library")).toBeTruthy();
    expect(card.getByText("Review due").getAttribute("title")).toMatch(/^Review was due /);
    // 2 to-do notes and 1 checklist line open, 1 and 1 of them past their day.
    expect(card.getByText("3 open")).toBeTruthy();
    expect(card.getByText("2 overdue")).toBeTruthy();
    // 5 done and 3 open: 63%.
    expect(card.getByRole("progressbar", { name: "To-dos done" }).getAttribute("aria-valuenow")).toBe("63");
    expect(card.getByText("5 of 8 done")).toBeTruthy();
    expect(card.getByRole("button", { name: /Write importer/ })).toBeTruthy();
    expect(card.getByText("edited 2 h ago · Pitch deck")).toBeTruthy();
    expect(card.getByText("12 pages · 2 boards · 1 deck")).toBeTruthy();
  });

  it("leaves out what a project does not have, and says when it has no to-dos", async () => {
    setup([trip]);
    await mountHub();
    const card = within(cardOf("Trip"));
    expect(card.getByText("Paused")).toBeTruthy();
    expect(card.queryByText("Review due")).toBeNull();
    expect(card.queryByText(/overdue/)).toBeNull();
    expect(card.queryByRole("button", { name: /Next/ })).toBeNull();
    expect(card.getByText("No to-dos")).toBeTruthy();
    expect(card.getByText("Nothing in it yet")).toBeTruthy();
  });

  it("opens the overview on a click, in a tab with Ctrl, and the project page from its own button", async () => {
    setup([photos]);
    await mountHub();
    fireEvent.click(screen.getByRole("button", { name: "Project page of Photo organiser" }));
    expect(useWorkspace.getState().place).toEqual({ view: "page", path: "projects/photos/_project.md" });
    fireEvent.click(cardOf("Photo organiser"), { ctrlKey: true });
    expect(useWorkspace.getState().layout.panes[0]!.tabs.map((t) => t.place.view)).toEqual(["page", "overview"]);
    fireEvent.click(screen.getByRole("button", { name: "Open Photo organiser" }));
    expect(useWorkspace.getState().place).toEqual({ view: "overview", path: "projects/photos/_project.md" });
  });

  it("opens the overview from anywhere on the card that is not a button, and the next action on its own", async () => {
    setup([photos]);
    await mountHub();
    fireEvent.click(within(cardOf("Photo organiser")).getByText("Sort and back up the library"));
    expect(useWorkspace.getState().place).toEqual({ view: "overview", path: "projects/photos/_project.md" });
    fireEvent.click(screen.getByRole("button", { name: /Write importer/ }));
    expect(useWorkspace.getState().place).toEqual({ view: "page", path: "projects/photos/cards/Write importer.md" });
  });
});

describe("finding projects", () => {
  it("lists active ones first by the sidebar's order and leaves the archived ones out", async () => {
    setup([trip, photos, old]);
    await mountHub();
    expect(titles()).toEqual(["Photo organiser", "Trip"]);
    expect(screen.getByText("2 projects")).toBeTruthy();
  });

  it("narrows to a status with the chips, which count what they would show", async () => {
    setup([photos, trip, taxes]);
    await mountHub();
    const chips = within(screen.getByRole("group", { name: "Status" }));
    expect(chips.getByRole("button", { name: "All 3" })).toBeTruthy();
    fireEvent.click(chips.getByRole("button", { name: "Paused 1" }));
    expect(titles()).toEqual(["Trip"]);
    expect(chips.getByRole("button", { name: "Paused 1" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(chips.getByRole("button", { name: "Done 1" }));
    expect(titles()).toEqual(["Taxes"]);
    fireEvent.click(chips.getByRole("button", { name: "All 3" }));
    expect(titles()).toHaveLength(3);
  });

  it("remembers the status chip, the sort and the layout for the vault", async () => {
    setup([photos, trip]);
    await mountHub();
    fireEvent.click(screen.getByRole("button", { name: "Paused 1" }));
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    const saved = JSON.parse(localStorage.getItem("kasten.projects-hub")!) as Record<string, unknown>;
    expect(saved["test-vault"]).toEqual({ layout: "list", sort: "manual", status: "paused" });
    cleanup();
    useHubPrefs.setState({ vault: "", prefs: { layout: "gallery", sort: "manual", status: "all" } });
    await mountHub("Project list");
    expect(titles()).toEqual(["Trip"]);
  });

  it("shows only the archived projects when asked, and brings one back from its menu", async () => {
    const { client } = setup([photos, old]);
    await mountHub();
    fireEvent.click(screen.getByRole("button", { name: /^Archived/ }));
    expect(titles()).toEqual(["Old plans"]);
    expect(within(cardOf("Old plans")).getByText("Archived")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "More for Old plans" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Unarchive project" }));
    await waitFor(() => expect(client.updateProps).toHaveBeenCalledWith("projects/old/_project.md", { archived: null }));
  });

  it("searches the titles and the summaries as you type, and Escape empties the field", async () => {
    setup([photos, trip, garden]);
    await mountHub();
    const field = screen.getByRole("textbox", { name: "Search projects" }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "back up" } });
    await waitFor(() => expect(titles()).toEqual(["Photo organiser"]));
    fireEvent.change(field, { target: { value: "gar" } });
    await waitFor(() => expect(titles()).toEqual(["Garden"]));
    fireEvent.keyDown(field, { key: "Escape" });
    expect(field.value).toBe("");
    await waitFor(() => expect(titles()).toHaveLength(3));
  });

  it("goes to the search field on / from anywhere that is not a field", async () => {
    setup([photos]);
    await mountHub();
    fireEvent.keyDown(document.body, { key: "/" });
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Search projects" }));
    // Typing a slash in the field is typing.
    fireEvent.keyDown(document.activeElement!, { key: "/" });
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Search projects" }));
  });

  it("says when nothing matches, and Clear filters shows everything again", async () => {
    setup([photos, trip]);
    await mountHub();
    fireEvent.change(screen.getByRole("textbox", { name: "Search projects" }), { target: { value: "zzz" } });
    fireEvent.click(screen.getByRole("button", { name: "Done 0" }));
    expect(await screen.findByText("No project matches.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(titles()).toHaveLength(2));
    expect((screen.getByRole("textbox", { name: "Search projects" }) as HTMLInputElement).value).toBe("");
  });

  it("sorts by recent activity, name or overdue to-dos, and the sidebar's order is the default", async () => {
    setup([garden, photos, trip]);
    usePrefs.setState({ pinnedProjects: ["trip"] });
    await mountHub();
    expect(titles()).toEqual(["Trip", "Garden", "Photo organiser"]);
    const sort = async (option: string) => {
      fireEvent.click(screen.getByRole("button", { name: /^Sort:/ }));
      fireEvent.click(await screen.findByRole("option", { name: option }));
    };
    await sort("Recently active");
    expect(titles()).toEqual(["Photo organiser", "Trip", "Garden"]);
    await sort("Name");
    expect(titles()).toEqual(["Garden", "Photo organiser", "Trip"]);
    await sort("Overdue first");
    expect(titles()[0]).toBe("Photo organiser");
    expect(useHubPrefs.getState().prefs.sort).toBe("overdue");
  });
});

describe("the counts above the list", () => {
  it("count active projects, overdue to-dos, reviews due and stale projects", async () => {
    setup([photos, trip, garden, taxes]);
    await mountHub();
    const strip = within(screen.getByRole("group", { name: "Project figures" }));
    expect(strip.getByRole("button", { name: /Active projects/ }).textContent).toContain("2");
    expect(strip.getByRole("button", { name: /Overdue to-dos/ }).textContent).toContain("2");
    expect(strip.getByRole("button", { name: /Reviews due/ }).textContent).toContain("1");
    expect(strip.getByRole("button", { name: /Stale/ }).textContent).toContain("1");
  });

  it("narrow the list when pressed, and let go when pressed again or from the chip that says so", async () => {
    setup([photos, trip, garden]);
    await mountHub();
    const stale = () => screen.getByRole("button", { name: /^\d+ Stale/ });
    const overdue = () => screen.getByRole("button", { name: /^\d+ Overdue to-dos/ });
    fireEvent.click(stale());
    expect(titles()).toEqual(["Garden"]);
    expect(stale().getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Stop showing only: Stale" }));
    expect(titles()).toHaveLength(3);
    fireEvent.click(overdue());
    expect(titles()).toEqual(["Photo organiser"]);
    fireEvent.click(overdue());
    expect(titles()).toHaveLength(3);
  });

  it("are not buttons when they count nothing", async () => {
    setup([trip]);
    await mountHub();
    expect((screen.getByRole("button", { name: /^0 Reviews due/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /^0 Stale/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("empty states", () => {
  it("invite the first project", async () => {
    setup([]);
    render(<ProjectsHub />);
    expect(await screen.findByRole("heading", { name: "No projects yet" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create your first project" }));
    expect(screen.getByRole("dialog", { name: "New project" })).toBeTruthy();
  });

  it("say when none is archived", async () => {
    setup([photos]);
    await mountHub();
    fireEvent.click(screen.getByRole("button", { name: /^Archived/ }));
    expect(screen.getByText("No project is archived.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show the projects" }));
    expect(titles()).toEqual(["Photo organiser"]);
  });

  it("say why the projects could not be read, and read again on request", async () => {
    const { client } = setup([photos]);
    client.projectSummaries!.mockRejectedValueOnce(new Error("The index is being rebuilt"));
    render(<ProjectsHub />);
    expect(await screen.findByText("The index is being rebuilt")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("list", { name: "Project gallery" });
    expect(titles()).toEqual(["Photo organiser"]);
  });
});

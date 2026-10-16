// The hub card's review items: the next action, marking a project reviewed,
// and the last review shown on the card.

import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NoteMeta } from "../../../lib/vault/types";
import { useWorkspace } from "../../workspace/store";
import { cardOf, mountHub, setup } from "./hub-test-kit";
import { NOW, photos, summary, projectNote } from "./test-support";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const open = (title: string) => fireEvent.click(screen.getByRole("button", { name: `More for ${title}` }));
const task = (title: string, over: Partial<NoteMeta> = {}): NoteMeta => ({ ...projectNote("photos", title, { path: `projects/photos/pages/${title}.md`, kind: "page", tags: ["task"], props: { status: "Todo" } }), ...over });

describe("the card's review items", () => {
  it("marks a project reviewed today through the core, clearing its review day, with Undo", async () => {
    const { client } = setup([photos]);
    await mountHub();
    open("Photo organiser");
    fireEvent.click(screen.getByRole("menuitem", { name: "Mark reviewed today" }));
    await waitFor(() => expect(client.setProjectState).toHaveBeenCalledWith("projects/photos/_project.md", { reviewed: "2026-10-11", reviewAfter: null }));
    await waitFor(() => expect(useWorkspace.getState().toasts.at(-1)?.text).toBe("Marked “Photo organiser” as reviewed"));
    expect(useWorkspace.getState().toasts.at(-1)?.action?.label).toBe("Undo");
  });

  it("sets the next review at the same time: a week or a month on", async () => {
    const { client } = setup([photos]);
    await mountHub();
    open("Photo organiser");
    fireEvent.click(screen.getByRole("menuitem", { name: "Reviewed; review again in a week" }));
    await waitFor(() => expect(client.setProjectState).toHaveBeenCalledWith("projects/photos/_project.md", { reviewed: "2026-10-11", reviewAfter: "2026-10-18" }));
  });

  it("offers to clear the review day only when there is one", async () => {
    setup([photos, summary("trip", { title: "Trip" })]);
    await mountHub();
    open("Photo organiser");
    expect(screen.getByRole("menuitem", { name: "Clear the review day" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("menu", { name: "Photo organiser options" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    open("Trip");
    expect(screen.queryByRole("menuitem", { name: "Clear the review day" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Clear the next action" })).toBeNull();
  });

  it("opens the project's open tasks and pins the one chosen as its next action", async () => {
    const { client } = setup([photos]);
    useWorkspace.setState({ notes: [...useWorkspace.getState().notes, task("Write importer"), task("Sort the library", { props: { status: "Doing", due: "2026-10-12" } }), task("Old job", { props: { status: "Done" } })] });
    await mountHub();
    open("Photo organiser");
    fireEvent.click(screen.getByRole("menuitem", { name: /^Next action…/ }));
    const dialog = await screen.findByRole("dialog", { name: "Next action for Photo organiser" });
    const options = within(dialog).getAllByRole("option");
    // The soonest due first; a finished task is not offered.
    expect(options.map((o) => o.textContent)).toEqual([expect.stringContaining("Sort the library"), expect.stringContaining("Write importer")]);
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Find a task" }), { target: { value: "import" } });
    expect(within(dialog).getAllByRole("option")).toHaveLength(1);
    await act(async () => fireEvent.keyDown(within(dialog).getByRole("textbox", { name: "Find a task" }), { key: "Enter" }));
    await waitFor(() => expect(client.setProjectState).toHaveBeenCalledWith("projects/photos/_project.md", { nextAction: "projects/photos/pages/Write importer.md" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says so when the project has no open task", async () => {
    setup([photos]);
    await mountHub();
    open("Photo organiser");
    fireEvent.click(screen.getByRole("menuitem", { name: /^Next action…/ }));
    const dialog = await screen.findByRole("dialog", { name: "Next action for Photo organiser" });
    expect(dialog.textContent).toContain("This project has no open task.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("the last review on the card", () => {
  it("shows the day a project was reviewed, unless its review is due again", async () => {
    setup([summary("trip", { title: "Trip", lastReview: "2026-10-03" }), summary("garden", { title: "Garden", lastReview: "2026-09-01", reviewDue: true, reviewAfter: "2026-10-05" })]);
    await mountHub();
    expect(within(cardOf("Trip")).getByText(/^Reviewed /)).toBeTruthy();
    expect(within(cardOf("Garden")).queryByText(/^Reviewed /)).toBeNull();
    expect(within(cardOf("Garden")).getByText("Review due")).toBeTruthy();
  });
});

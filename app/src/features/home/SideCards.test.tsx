// The slim column beside Home's list: the first open to-dos and the Inbox.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dayFrom } from "../../lib/dates";
import type { NoteMeta, TaskRow } from "../../lib/vault/types";
import { useTaskRows } from "../dashboard/task-rows";
import { useWorkspace } from "../workspace/store";
import { derive } from "../workspace/store-layout";
import { initialLayout } from "../workspace/tabs";
import { Inbox, Todos } from "./SideCards";

const today = dayFrom(0);

let line = 0;
const todo = (text: string, over: Partial<TaskRow> = {}): TaskRow => ({ path: "library/plans.md", title: "Plans", icon: null, line: line++, done: false, text, due: null, at: null, ...over });

const card = (title: string, minutes: number): NoteMeta => ({
  path: `inbox/${title.toLowerCase().replace(/\W+/g, "-")}.md`,
  id: null,
  title,
  kind: "card",
  icon: null,
  cover: null,
  parent: null,
  project: null,
  tags: [],
  modified: Date.now() - minutes * 60_000,
  created: null,
  updated: null,
  excerpt: "",
  words: 0,
  props: {},
  locked: false,
});

const go = vi.fn();
beforeEach(() => {
  go.mockClear();
  useWorkspace.setState({ client: null, notes: [], ...derive(initialLayout()), go });
  useTaskRows.setState({ rows: [] });
});
afterEach(cleanup);

describe("Home's To-dos", () => {
  it("shows the first five open ones, overdue first, and says how many more", () => {
    useTaskRows.setState({
      rows: [
        todo("Later", { due: dayFrom(5) }),
        todo("Someday"),
        todo("Overdue", { due: dayFrom(-3) }),
        todo("Soon", { due: dayFrom(1) }),
        todo("Done already", { done: true }),
        todo("Today", { due: today }),
        todo("Another"),
        todo("In a template", { path: "templates/journal.md" }),
      ],
    });
    render(<Todos />);
    const card = screen.getByRole("region", { name: "To-dos" });
    expect(within(card).getAllByRole("checkbox").map((c) => c.getAttribute("aria-label"))).toEqual(["Overdue", "Today", "Soon", "Later", "Someday"]);
    fireEvent.click(within(card).getByRole("button", { name: "1 more" }));
    expect(go).toHaveBeenCalledWith({ view: "tasks" });
    expect(within(card).queryByRole("button", { name: /Show \d+ done/ })).toBeNull();
    expect(within(card).queryByRole("button", { name: /Show all/ })).toBeNull();
  });

  it("leaves out what is due today when Today lists it", () => {
    useTaskRows.setState({ rows: [todo("Due today", { due: today }), todo("Due tomorrow", { due: dayFrom(1) }), todo("No day")] });
    render(<Todos withToday />);
    expect(within(screen.getByRole("region", { name: "To-dos" })).getAllByRole("checkbox").map((c) => c.getAttribute("aria-label"))).toEqual(["Due tomorrow", "No day"]);
  });

  it("has a field to add one, and goes to Tasks from its link", () => {
    render(<Todos />);
    const card = screen.getByRole("region", { name: "To-dos" });
    expect(within(card).getByRole("textbox", { name: "Add a to-do" })).toBeTruthy();
    expect(card.textContent).toContain("Nothing to do.");
    fireEvent.click(within(card).getByRole("button", { name: "Tasks" }));
    expect(go).toHaveBeenCalledWith({ view: "tasks" });
  });

  it("holds the places of three lines while the to-dos are read", () => {
    useTaskRows.setState({ rows: null });
    render(<Todos />);
    const card = screen.getByRole("region", { name: "To-dos" });
    expect(card.querySelectorAll(".kasten-todo-bone")).toHaveLength(3);
    expect(card.textContent).not.toContain("Nothing to do.");
  });

  it("keeps a long to-do to one line: the full words are on it for the pointer", () => {
    const long = "Draft the evaluation section of the duplicate score for photos report ".repeat(3).trim();
    useTaskRows.setState({ rows: [todo(long)] });
    render(<Todos />);
    expect(screen.getByText(long).title).toBe(`${long} · Plans`);
  });
});

describe("Home's Inbox", () => {
  it("shows a count and the first three, newest first, with a link to triage the rest", () => {
    useWorkspace.setState({ notes: [card("Oldest", 90), card("Newest", 0), card("Second", 5), card("Third", 10)] });
    render(<Inbox />);
    const region = screen.getByRole("region", { name: "Inbox" });
    expect(within(region).getByText("4")).toBeTruthy();
    const rows = within(region).getAllByRole("button").filter((b) => b.className.includes("kasten-dash-row"));
    expect(rows.map((r) => r.querySelector(".kasten-dash-row-title")?.textContent)).toEqual(["Newest", "Second", "Third"]);
    expect(rows[0]!.querySelector(".kasten-dash-row-detail")?.textContent).toBe("now");
    expect(rows[1]!.querySelector(".kasten-dash-row-detail")?.textContent).toBe("5m");
    fireEvent.click(within(region).getByRole("button", { name: "Triage" }));
    expect(go).toHaveBeenCalledWith({ view: "inbox" });
  });

  it("is not there while the Inbox is empty", () => {
    render(<Inbox />);
    expect(screen.queryByRole("region", { name: "Inbox" })).toBeNull();
  });
});

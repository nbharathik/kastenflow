// The cards Home keeps in reserve: the week ahead and the journal.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dayFrom } from "../../lib/dates";
import type { NoteMeta, TaskRow } from "../../lib/vault/types";
import { useTaskRows } from "../dashboard/task-rows";
import { useWorkspace } from "../workspace/store";
import { derive } from "../workspace/store-layout";
import { initialLayout } from "../workspace/tabs";
import { ExtraCard } from "./ExtraCards";

let line = 0;
const todo = (text: string, due: string | null, over: Partial<TaskRow> = {}): TaskRow => ({ path: "library/plans.md", title: "Plans", icon: null, line: line++, done: false, text, due, at: null, ...over });

const day = (iso: string, excerpt = ""): NoteMeta => ({
  path: `journal/${iso.slice(0, 4)}/${iso}.md`,
  id: null,
  title: iso,
  kind: "journal",
  icon: null,
  cover: null,
  parent: null,
  project: null,
  tags: [],
  modified: 1,
  created: null,
  updated: null,
  excerpt,
  words: 0,
  props: {},
  locked: false,
});

const openJournal = vi.fn(async () => {});
const go = vi.fn();
beforeEach(() => {
  openJournal.mockClear();
  go.mockClear();
  useWorkspace.setState({ client: null, notes: [], ...derive(initialLayout()), openJournal, go });
  useTaskRows.setState({ rows: [] });
});
afterEach(cleanup);

describe("Home's week", () => {
  it("is the next seven days, today marked, each with the to-dos due on it", () => {
    useTaskRows.setState({
      rows: [todo("A", dayFrom(1)), todo("B", dayFrom(1)), todo("C", dayFrom(3)), todo("Done", dayFrom(2), { done: true }), todo("Far", dayFrom(9)), todo("Late", dayFrom(-1)), todo("None", null)],
    });
    render(<ExtraCard id="week" />);
    const days = within(screen.getByRole("group", { name: "The next seven days" })).getAllByRole("button");
    expect(days).toHaveLength(7);
    expect(days[0]!.className).toContain("is-today");
    expect(days.map((d) => d.querySelector(".kasten-week-count")?.textContent)).toEqual(["", "2", "", "1", "", "", ""]);
    expect(days[1]!.getAttribute("aria-label")).toMatch(/: 2 to-dos$/);
    expect(days[3]!.getAttribute("aria-label")).toMatch(/: 1 to-do$/);
    expect(days[2]!.getAttribute("aria-label")).not.toMatch(/to-do/);
  });

  it("opens a day's journal, and the Calendar from its link", () => {
    render(<ExtraCard id="week" />);
    fireEvent.click(within(screen.getByRole("group", { name: "The next seven days" })).getAllByRole("button")[2]!);
    expect(openJournal).toHaveBeenCalledWith(dayFrom(2));
    fireEvent.click(screen.getByRole("button", { name: "Calendar" }));
    expect(go).toHaveBeenCalledWith({ view: "calendar" });
  });
});

describe("Home's journal", () => {
  it("lists the latest four days, newest first, with a line of what they hold", () => {
    useWorkspace.setState({ notes: [day("2026-10-01", "First"), day("2026-10-05"), day("2026-10-03", "Third"), day("2026-10-06", "Sixth"), day("2026-10-02", "Second")] });
    render(<ExtraCard id="journal" />);
    const rows = within(screen.getByRole("region", { name: "Journal" })).getAllByRole("button").filter((b) => b.className.includes("kasten-dash-row"));
    expect(rows.map((r) => r.querySelector(".kasten-dash-row-detail")?.textContent)).toEqual(["Sixth", "No entry", "Third", "Second"]);
    fireEvent.click(screen.getByRole("button", { name: "Write today" }));
    expect(openJournal).toHaveBeenCalled();
  });

  it("says so, in one line, while no day is written", () => {
    render(<ExtraCard id="journal" />);
    expect(screen.getByRole("region", { name: "Journal" }).textContent).toContain("No days written yet.");
  });
});

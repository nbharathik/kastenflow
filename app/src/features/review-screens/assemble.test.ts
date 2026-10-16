import { describe, expect, it } from "vitest";

import type { ProjectSummary } from "../../lib/vault/project-types";
import type { NoteMeta, TaskRow } from "../../lib/vault/types";
import { assembleReview, periodOf, periodWords, todoText } from "./assemble";

const TODAY = "2026-10-11";

const note = (path: string, over: Partial<NoteMeta> = {}): NoteMeta => ({
  path,
  id: null,
  title: path.replace(/^.*\//, "").replace(/\.md$/, ""),
  kind: "card",
  icon: null,
  cover: null,
  parent: null,
  project: null,
  tags: [],
  modified: Date.parse("2026-10-01T09:00:00"),
  created: "2026-10-01T09:00:00",
  updated: null,
  excerpt: "",
  words: 0,
  props: {},
  locked: false,
  ...over,
});

const task = (path: string, due: string | null, status = "Todo", over: Partial<NoteMeta> = {}) => note(path, { kind: "page", tags: ["task"], props: { ...(due ? { due } : {}), status }, ...over });

const row = (text: string, due: string | null, over: Partial<TaskRow> = {}): TaskRow => ({ path: "library/plans.md", title: "Plans", icon: null, line: 0, done: false, text, due, at: null, ...over });

const project = (folder: string, over: Partial<ProjectSummary> = {}): ProjectSummary => ({
  path: `projects/${folder}/_project.md`,
  folder,
  id: null,
  title: folder,
  icon: null,
  summary: null,
  archived: false,
  status: "Active",
  health: null,
  nextAction: null,
  lastReview: null,
  reviewAfter: null,
  reviewDue: false,
  tasks: { open: 0, done: 0, overdue: 0 },
  checklist: { open: 0, done: 0, overdue: 0 },
  latest: null,
  lastUpdate: null,
  notes: 0,
  boards: 0,
  decks: 0,
  ...over,
});

describe("the period of a review", () => {
  it("is today for the daily review and the last seven days for the weekly one", () => {
    expect(periodOf("daily", TODAY)).toEqual({ kind: "daily", from: TODAY, to: TODAY, today: TODAY });
    // As the collections count the last 7 days: the seven before today, and today.
    expect(periodOf("weekly", TODAY)).toEqual({ kind: "weekly", from: "2026-10-04", to: TODAY, today: TODAY });
  });

  it("is told in words", () => {
    expect(periodWords(periodOf("daily", TODAY))).toMatch(/11/);
    const week = periodWords(periodOf("weekly", TODAY));
    expect(week).toMatch(/4/);
    expect(week).toMatch(/11/);
  });
});

describe("a to-do's words", () => {
  it("leave out the day it names, which the review shows beside it", () => {
    expect(todoText("Call the mason @2026-10-02")).toBe("Call the mason");
    expect(todoText("Meet @2026-10-02 09:30 at the studio")).toBe("Meet at the studio");
    expect(todoText("Pay the rent 📅 2026-10-01")).toBe("Pay the rent");
    expect(todoText("No day here")).toBe("No day here");
  });
});

describe("assembling a review", () => {
  const notes = [
    note("inbox/a.md", { created: "2026-10-10T09:00:00" }),
    note("inbox/b.md", { created: "2026-10-09T09:00:00" }),
    note("inbox/later.md", { props: { review_after: "2026-10-20" } }),
    note("library/saved.md", { tags: ["capture"], props: { status: "Filed" } }),
    task("library/t-overdue.md", "2026-10-05"),
    task("library/t-today.md", TODAY),
    task("library/t-soon.md", "2026-10-15"),
    task("library/t-far.md", "2026-12-01"),
    task("library/t-done.md", "2026-10-01", "Done", { modified: Date.parse("2026-10-09T10:00:00") }),
    task("library/t-done-long-ago.md", "2026-09-01", "Done", { modified: Date.parse("2026-09-02T10:00:00") }),
    task("library/t-undated.md", null),
    note("library/decision-new.md", { tags: ["decision"], created: "2026-10-10T08:00:00", modified: Date.parse("2026-10-10T08:00:00") }),
    note("library/decision-old.md", { tags: ["decision"], created: "2026-08-01T08:00:00", modified: Date.parse("2026-08-01T08:00:00") }),
    note("library/decision-edited.md", { tags: ["decision"], created: "2026-08-01T08:00:00", updated: "2026-10-08T08:00:00", modified: Date.parse("2026-10-08T08:00:00") }),
    note("templates/task.md", { kind: "template", tags: ["task"], props: { due: "2026-10-01", status: "Todo" } }),
  ];
  const rows = [row("Call the mason", "2026-10-02"), row("Order glaze", TODAY), row("Plan spring", "2026-10-14"), row("Someday", null), row("Done thing", "2026-10-01", { done: true }), row("In a template", "2026-10-01", { path: "templates/journal.md" })];
  const projects = [project("kiln", { reviewDue: true, reviewAfter: "2026-10-09" }), project("garden"), project("old", { reviewDue: true, archived: true })];
  const input = (kind: "daily" | "weekly") => ({ period: periodOf(kind, TODAY), notes, tasks: rows, projects });

  it("counts what waits for triage, less what is filed or put off", () => {
    const review = assembleReview(input("daily"));
    expect(review.captures.count).toBe(2);
    expect(review.captures.items.map((n) => n.path)).toEqual(["inbox/a.md", "inbox/b.md"]);
  });

  it("lists overdue and due-today to-dos and tasks together, the most overdue first, in the daily review", () => {
    const review = assembleReview(input("daily"));
    expect(review.overdue.map((d) => d.text)).toEqual(["Call the mason", "t-overdue"]);
    expect(review.due.map((d) => d.text)).toEqual(["Order glaze", "t-today"]);
    expect(review.overdue.map((d) => d.kind)).toEqual(["todo", "task"]);
  });

  it("looks a week ahead in the weekly review", () => {
    const review = assembleReview(input("weekly"));
    expect(review.due.map((d) => d.text)).toEqual(["Order glaze", "t-today", "Plan spring", "t-soon"]);
  });

  it("leaves out done work, templates, undated items and days far off", () => {
    const texts = [...assembleReview(input("weekly")).overdue, ...assembleReview(input("weekly")).due].map((d) => d.text);
    for (const left of ["Done thing", "In a template", "Someday", "t-done", "t-undated", "t-far"]) expect(texts).not.toContain(left);
  });

  it("lists the projects whose review is due, not archived ones", () => {
    expect(assembleReview(input("daily")).projects.map((p) => p.folder)).toEqual(["kiln"]);
  });

  it("lists the decisions made or edited in the period, newest first", () => {
    expect(assembleReview(input("weekly")).decisions.map((n) => n.path)).toEqual(["library/decision-new.md", "library/decision-edited.md"]);
    expect(assembleReview(input("daily")).decisions).toEqual([]);
  });

  it("lists the task notes finished in the period", () => {
    expect(assembleReview(input("weekly")).completed.map((n) => n.path)).toEqual(["library/t-done.md"]);
    expect(assembleReview(input("daily")).completed).toEqual([]);
  });

  it("has an empty review for an empty vault, and says so", () => {
    const review = assembleReview({ period: periodOf("daily", TODAY), notes: [], tasks: [], projects: [] });
    expect(review.empty).toBe(true);
    expect(review.captures.count).toBe(0);
    expect(review.overdue).toEqual([]);
    expect(review.projects).toEqual([]);
    expect(assembleReview(input("daily")).empty).toBe(false);
  });

  it("treats what has not been read yet as nothing, apart from the notes", () => {
    const review = assembleReview({ period: periodOf("daily", TODAY), notes, tasks: null, projects: null });
    expect(review.captures.count).toBe(2);
    // Task notes come from the note list; the to-dos in pages and the projects wait for their reads.
    expect(review.overdue.map((d) => d.kind)).toEqual(["task"]);
    expect(review.projects).toEqual([]);
  });

  it("offers up to three highlights from before the period, the same three all day", () => {
    const old = (n: number) => note(`library/highlight-${n}.md`, { kind: "highlight", modified: Date.parse(`2026-0${(n % 8) + 1}-02T09:00:00`), created: `2026-0${(n % 8) + 1}-02T09:00:00` });
    const many = [...Array.from({ length: 12 }, (_, n) => old(n)), note("library/fresh.md", { kind: "highlight", modified: Date.parse("2026-10-10T09:00:00"), created: "2026-10-10T09:00:00" })];
    const first = assembleReview({ period: periodOf("daily", TODAY), notes: many, tasks: [], projects: [] }).highlights.map((n) => n.path);
    const again = assembleReview({ period: periodOf("daily", TODAY), notes: [...many].reverse(), tasks: [], projects: [] }).highlights.map((n) => n.path);
    expect(first).toHaveLength(3);
    expect(again).toEqual(first);
    expect(first).not.toContain("library/fresh.md");
    const tomorrow = assembleReview({ period: periodOf("daily", "2026-10-12"), notes: many, tasks: [], projects: [] }).highlights.map((n) => n.path);
    expect(tomorrow).toHaveLength(3);
  });
});

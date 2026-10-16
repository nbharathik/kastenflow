import { describe, expect, it } from "vitest";

import { arrangeProjects } from "../../workspace/project-order";
import { filterProjects, hubStats, isStale, openOf, overdueOf, progressOf, sortProjects, statusCounts, type HubQuery } from "./hub-model";
import { DAY, HOUR, NOW, projectNote, summary } from "./test-support";

const ALL: HubQuery = { status: "all", archived: false, focus: null, text: "" };
const folders = (list: readonly { folder: string }[]) => list.map((s) => s.folder);

describe("a project's figures", () => {
  it("adds the to-do notes to the checklist lines for open, overdue and progress", () => {
    const s = summary("trip", { tasks: { open: 2, done: 1, overdue: 1 }, checklist: { open: 3, done: 4, overdue: 2 } });
    expect(openOf(s)).toBe(5);
    expect(overdueOf(s)).toBe(3);
    expect(progressOf(s)).toEqual({ done: 5, total: 10, percent: 50 });
  });

  it("has no progress to show when there are no to-dos", () => {
    expect(progressOf(summary("empty"))).toEqual({ done: 0, total: 0, percent: 0 });
  });

  it("rounds the percentage and never passes 100", () => {
    expect(progressOf(summary("a", { checklist: { open: 1, done: 2, overdue: 0 } })).percent).toBe(67);
    expect(progressOf(summary("b", { checklist: { open: 0, done: 4, overdue: 0 } })).percent).toBe(100);
  });
});

describe("stale projects", () => {
  const at = (days: number) => ({ modified: NOW - days * DAY, path: "p", title: "t", kind: "page" });

  it("are active ones nobody touched for 30 days", () => {
    expect(isStale(summary("a", { latest: at(31) }), NOW)).toBe(true);
    expect(isStale(summary("b", { latest: at(30) }), NOW)).toBe(false);
    expect(isStale(summary("c", { latest: at(2) }), NOW)).toBe(false);
  });

  it("leave out paused, finished and archived projects, which are meant to be quiet, and ones with nothing yet", () => {
    expect(isStale(summary("a", { status: "Paused", latest: at(90) }), NOW)).toBe(false);
    expect(isStale(summary("b", { status: "Done", latest: at(90) }), NOW)).toBe(false);
    expect(isStale(summary("c", { archived: true, latest: at(90) }), NOW)).toBe(false);
    expect(isStale(summary("d", { latest: null }), NOW)).toBe(false);
  });
});

describe("filtering", () => {
  const list = [
    summary("alpha", { summary: "Sort the photo library" }),
    summary("beta", { status: "Paused", tasks: { open: 1, done: 0, overdue: 1 } }),
    summary("gamma", { status: "Done", reviewDue: true }),
    summary("delta", { archived: true }),
    summary("epsilon", { status: "Other" }),
    summary("zeta", { latest: { modified: NOW - 60 * DAY, path: "p", title: "t", kind: "page" } }),
  ];

  it("leaves archived projects out, and shows only them when asked", () => {
    expect(folders(filterProjects(list, ALL, NOW))).toEqual(["alpha", "beta", "gamma", "epsilon", "zeta"]);
    expect(folders(filterProjects(list, { ...ALL, archived: true }, NOW))).toEqual(["delta"]);
  });

  it("narrows to a status; an Other status shows only under All", () => {
    expect(folders(filterProjects(list, { ...ALL, status: "active" }, NOW))).toEqual(["alpha", "zeta"]);
    expect(folders(filterProjects(list, { ...ALL, status: "paused" }, NOW))).toEqual(["beta"]);
    expect(folders(filterProjects(list, { ...ALL, status: "done" }, NOW))).toEqual(["gamma"]);
    expect(folders(filterProjects(list, ALL, NOW))).toContain("epsilon");
  });

  it("finds words in the title and the summary, any case, every word needed", () => {
    expect(folders(filterProjects(list, { ...ALL, text: "PHOTO" }, NOW))).toEqual(["alpha"]);
    expect(folders(filterProjects(list, { ...ALL, text: "alp lib" }, NOW))).toEqual(["alpha"]);
    expect(folders(filterProjects(list, { ...ALL, text: "alpha zeta" }, NOW))).toEqual([]);
    expect(folders(filterProjects(list, { ...ALL, text: "  " }, NOW))).toHaveLength(5);
  });

  it("narrows to what needs a look: overdue, review due, stale", () => {
    expect(folders(filterProjects(list, { ...ALL, focus: "overdue" }, NOW))).toEqual(["beta"]);
    expect(folders(filterProjects(list, { ...ALL, focus: "review" }, NOW))).toEqual(["gamma"]);
    expect(folders(filterProjects(list, { ...ALL, focus: "stale" }, NOW))).toEqual(["zeta"]);
  });

  it("combines them", () => {
    expect(folders(filterProjects(list, { ...ALL, status: "active", text: "a", focus: "stale" }, NOW))).toEqual(["zeta"]);
  });
});

describe("sorting", () => {
  const list = [
    summary("cedar", { latest: { modified: NOW - 5 * HOUR, path: "p", title: "t", kind: "page" }, tasks: { open: 1, done: 0, overdue: 1 } }),
    summary("alder", { latest: { modified: NOW - DAY, path: "p", title: "t", kind: "page" } }),
    summary("birch", { latest: { modified: NOW - HOUR, path: "p", title: "t", kind: "page" }, checklist: { open: 4, done: 0, overdue: 3 } }),
    summary("elm", { latest: null }),
    summary("dogwood", { latest: { modified: NOW - 5 * HOUR, path: "p", title: "t", kind: "page" } }),
  ];
  const none = { projectOrder: [], pinnedProjects: [] };

  it("puts the most recently active first, ties by name, projects with nothing last", () => {
    expect(folders(sortProjects(list, "recent", none))).toEqual(["birch", "cedar", "dogwood", "alder", "elm"]);
  });

  it("sorts by name the way the sidebar does", () => {
    expect(folders(sortProjects(list, "name", none))).toEqual(["alder", "birch", "cedar", "dogwood", "elm"]);
    expect(folders(sortProjects([summary("p10"), summary("p9"), summary("P2")], "name", none))).toEqual(["P2", "p9", "p10"]);
  });

  it("puts the most overdue first, then by name", () => {
    expect(folders(sortProjects(list, "overdue", none))).toEqual(["birch", "cedar", "alder", "dogwood", "elm"]);
  });

  it("keeps the arrangement the sidebar has: pinned first, then the order dragged, then by name", () => {
    const prefs = { projectOrder: ["elm", "birch"], pinnedProjects: ["dogwood", "birch"] };
    const mine = folders(sortProjects(list, "manual", prefs));
    expect(mine).toEqual(["birch", "dogwood", "elm", "alder", "cedar"]);
    const notes = list.map((s) => projectNote(s.folder, s.title));
    expect(mine).toEqual(arrangeProjects(notes, prefs).map((n) => n.project));
  });

  it("does not change the list it is given", () => {
    const before = folders(list);
    sortProjects(list, "name", none);
    expect(folders(list)).toEqual(before);
  });
});

describe("the counts above the list", () => {
  const list = [
    summary("a", { tasks: { open: 2, done: 0, overdue: 2 }, checklist: { open: 1, done: 0, overdue: 1 } }),
    summary("b", { reviewDue: true, latest: { modified: NOW - 45 * DAY, path: "p", title: "t", kind: "page" } }),
    summary("c", { status: "Paused", tasks: { open: 1, done: 0, overdue: 1 }, reviewDue: true }),
    summary("d", { status: "Done", tasks: { open: 1, done: 0, overdue: 1 } }),
    summary("e", { archived: true, tasks: { open: 1, done: 0, overdue: 1 }, reviewDue: true }),
  ];

  it("counts active projects, overdue to-dos in unfinished ones, reviews due and stale projects, archived ones apart", () => {
    expect(hubStats(list, NOW)).toEqual({ active: 2, overdue: 4, projectsOverdue: 2, reviews: 2, stale: 1 });
  });

  it("counts the projects under each status chip, Other under All only", () => {
    expect(statusCounts([...list, summary("f", { status: "Other" })], false)).toEqual({ all: 5, active: 2, paused: 1, done: 1 });
    expect(statusCounts(list, true)).toEqual({ all: 1, active: 1, paused: 0, done: 0 });
  });
});

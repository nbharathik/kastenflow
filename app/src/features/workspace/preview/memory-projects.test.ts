// Projects in the browser preview answer as the core's project ops do: the
// summaries' counts and defaults, a state change checked as a whole, setups
// planned the way they are applied, the revision counters and the health report.

import { describe, expect, it } from "vitest";

import type { Revision } from "../../../lib/vault/revision-types";
import { MemoryVault } from "./memory-vault";

const TASK_TAG = "name: task\ncolor: green\nproperties:\n  - {key: status, type: select, options: [Todo, Doing, Done]}\n  - {key: due, type: date}\n";

const SEED: Record<string, string> = {
  "projects/trip/_project.md": "---\nid: 01PROJECTTRIP\ntitle: Trip\ntype: project\nprops:\n  summary: Plan the trip\n---\n- [ ] Book flights @2026-01-01\n- [ ] Pack\n- [x] Pick dates\n",
  "projects/trip/pages/plan.md": "---\ntitle: Plan\ntype: page\n---\nA plan.\n",
  "projects/trip/cards/ask-anna.md": "---\ntitle: Ask Anna\ntype: card\ntags: [task]\nprops:\n  status: Todo\n  due: 2026-01-02\n---\n",
  "projects/trip/cards/buy-tickets.md": "---\ntitle: Buy tickets\ntype: card\ntags: [task]\nprops:\n  status: Done\n---\n",
  "projects/trip/pages/update-1.md": "---\ntitle: Update 1\ntype: page\ntags: [project-update]\nprops:\n  date: 2026-01-05\n---\n",
  "projects/trip/pages/update-2.md": "---\ntitle: Update 2\ntype: page\ntags: [project-update]\nprops:\n  date: 2026-02-01\n---\n",
  "projects/old/_project.md": "---\ntitle: Old\ntype: project\nprops:\n  archived: true\n  status: Done\n---\n",
  "projects/odd/_project.md": "---\ntitle: Odd\ntype: project\nprops:\n  status: Someday\n  health: Fine\n---\n",
  "library/loose.md": "---\ntitle: Loose\ntype: page\n---\n- [ ] Not in a project\n",
  "templates/project.md": '---\ntitle: "{{title}}"\ntype: project\ntags: [project]\n---\nHello\n',
  "tags/task.yaml": TASK_TAG,
};

const vault = () => new MemoryVault({ ...SEED });

describe("project summaries in the preview", () => {
  it("counts a project's tasks, to-dos, notes and latest update, and treats no status as Active", async () => {
    const all = await vault().projectSummaries("2026-01-10");
    expect(all.map((p) => p.title)).toEqual(["Odd", "Old", "Trip"]);
    const trip = all.find((p) => p.folder === "trip")!;
    expect(trip).toMatchObject({ path: "projects/trip/_project.md", id: "01PROJECTTRIP", summary: "Plan the trip", archived: false, status: "Active", health: null, nextAction: null, reviewDue: false });
    expect(trip.tasks).toEqual({ open: 1, done: 1, overdue: 1 });
    expect(trip.checklist).toEqual({ open: 2, done: 1, overdue: 1 });
    expect(trip.notes).toBe(5);
    expect(trip.lastUpdate).toEqual({ path: "projects/trip/pages/update-2.md", title: "Update 2", date: "2026-02-01" });
    expect(trip.latest).not.toBeNull();
  });

  it("reads archived pages and calls an unknown status or health Other", async () => {
    const all = await vault().projectSummaries("2026-01-10");
    expect(all.find((p) => p.folder === "old")).toMatchObject({ archived: true, status: "Done" });
    expect(all.find((p) => p.folder === "odd")).toMatchObject({ status: "Other", health: "Other" });
  });
});

describe("setting a project's state in the preview", () => {
  it("writes the fixed vocabularies, days and a next action stored as an id, and takes keys away with null", async () => {
    const v = vault();
    const page = await v.setProjectState("projects/trip/_project.md", { status: "paused" as never, health: "At risk", reviewed: "2026-01-09", reviewAfter: "2026-01-09", nextAction: "Ask Anna" });
    expect(page.meta.props).toMatchObject({ summary: "Plan the trip", status: "Paused", health: "At risk", last_review: "2026-01-09", review_after: "2026-01-09" });
    const task = await v.read("projects/trip/cards/ask-anna.md");
    expect(task.meta.id).toMatch(/^[0-9A-Z]{26}$/);
    expect(page.meta.props.next_action).toBe(task.meta.id);
    const trip = (await v.projectSummaries("2026-01-10")).find((p) => p.folder === "trip")!;
    expect(trip).toMatchObject({ status: "Paused", health: "At risk", reviewDue: true, nextAction: { id: task.meta.id, path: task.meta.path, title: "Ask Anna", done: false } });
    const cleared = await v.setProjectState("projects/trip/_project.md", { status: null, health: null, nextAction: null });
    expect(Object.keys(cleared.meta.props).sort()).toEqual(["last_review", "review_after", "summary"]);
  });

  it("refuses a bad value, another kind of page and a next action that is no task, writing nothing", async () => {
    const v = vault();
    const before = (await v.read("projects/trip/_project.md")).text;
    await expect(v.setProjectState("projects/trip/_project.md", { status: "Someday" as never })).rejects.toThrow("Active, Paused, Done");
    await expect(v.setProjectState("projects/trip/_project.md", { status: "Paused", reviewAfter: "2026-02-30" })).rejects.toThrow("YYYY-MM-DD");
    await expect(v.setProjectState("projects/trip/_project.md", { status: "Paused", nextAction: "Plan" })).rejects.toThrow("not a task note");
    await expect(v.setProjectState("projects/trip/pages/plan.md", { status: "Paused" })).rejects.toThrow("project page");
    expect((await v.read("projects/trip/_project.md")).text).toBe(before);
  });

  it("writes nothing when nothing changes", async () => {
    const v = vault();
    await v.setProjectState("projects/trip/_project.md", { status: "Paused" });
    const once = await v.read("projects/trip/_project.md");
    expect((await v.setProjectState("projects/trip/_project.md", { status: "Paused" })).hash).toBe(once.hash);
  });
});

describe("project setups in the preview", () => {
  it("offers the three setups", async () => {
    const setups = await vault().listSetups();
    expect(setups.map((s) => s.id)).toEqual(["research", "writing", "presentation"]);
    expect(setups[0]!.tags).toEqual(["experiment", "reading"]);
    expect(setups[2]!.files).toContain("decks/talk.deck");
  });

  it("writes exactly what it previewed, for a new project and an existing one", async () => {
    const v = vault();
    const plan = await v.previewSetup("presentation", { kind: "new", title: "Keynote" });
    expect(plan.projectPath).toBe("projects/keynote/_project.md");
    expect(plan.create).toEqual(expect.arrayContaining(["projects/keynote/_project.md", "projects/keynote/pages/talk-notes.md", "projects/keynote/decks/talk.deck", "projects/keynote/boards/storyboard.canvas"]));
    expect(plan.props).toEqual(["status"]);
    const done = await v.applySetup("presentation", { kind: "new", title: "Keynote" });
    expect(done.written).toEqual(plan.create);
    expect((await v.decks()).map((d) => d.title)).toContain("Keynote talk");
    expect((await v.read("projects/keynote/pages/talk-notes.md")).text).toContain("What Keynote should say");
    expect((await v.read("projects/keynote/_project.md")).meta.props.status).toBe("Active");
    // A second project of the same name takes another folder; the first keeps its files.
    expect((await v.previewSetup("writing", { kind: "new", title: "Keynote" })).projectPath).toBe("projects/keynote-2/_project.md");

    const again = await v.previewSetup("presentation", { kind: "existing", folder: "keynote" });
    expect(again.create).toEqual([]);
    expect(again.keep).toEqual(plan.create.filter((p) => p !== "projects/keynote/_project.md"));
    await expect(v.previewSetup("research", { kind: "existing", folder: "nowhere" })).rejects.toThrow("No project called nowhere");
  });

  it("adds only the properties an existing page lacks and leaves the person's files alone", async () => {
    const v = vault();
    await v.setProjectState("projects/trip/_project.md", { status: "Paused" });
    await v.saveBody("projects/trip/pages/plan.md", "Mine.\n", (await v.read("projects/trip/pages/plan.md")).hash);
    const plan = await v.previewSetup("research", { kind: "existing", folder: "trip" });
    expect(plan.props).toEqual([]);
    expect(plan.create).toContain("projects/trip/pages/research-questions.md");
    expect(plan.create).not.toContain("projects/trip/_project.md");
    const done = await v.applySetup("research", { kind: "existing", folder: "trip" });
    expect(done.written).toEqual(plan.create);
    expect((await v.read("projects/trip/_project.md")).meta.props.status).toBe("Paused");
    expect((await v.read("projects/trip/pages/plan.md")).text).toContain("Mine.");
    expect((await v.tagSchemas()).map((t) => t.name)).toEqual(expect.arrayContaining(["reading", "experiment"]));
  });
});

describe("setups saved from a project in the preview", () => {
  it("lists a project's pages with those under pages/ ticked, and the tags whose schemas come along", async () => {
    const source = await vault().previewProjectSetup("trip");
    expect(source.title).toBe("Trip");
    expect(source.pages.map((p) => [p.path, p.included])).toEqual([
      ["projects/trip/pages/plan.md", true],
      ["projects/trip/pages/update-1.md", true],
      ["projects/trip/pages/update-2.md", true],
    ]);
    expect(source.tags).toEqual(["task"]);
    expect(source.props).toEqual(["summary"]);
    await expect(vault().previewProjectSetup("nowhere")).rejects.toThrow("no project called");
  });

  it("saves a setup, lists it after the built-in ones and starts a new project from it", async () => {
    const v = vault();
    const saved = await v.saveProjectSetup("trip", "Trip kit", ["projects/trip/pages/plan.md"]);
    expect(saved.id).toBe("saved:trip-kit");
    const second = await v.saveProjectSetup("trip", "Trip kit", []);
    expect(second.id).toBe("saved:trip-kit-2");
    const all = await v.listSetups();
    expect(all.map((s) => s.id)).toEqual(["research", "writing", "presentation", "saved:trip-kit", "saved:trip-kit-2"]);
    expect(all[3]).toMatchObject({ saved: true, name: "Trip kit", files: ["pages/plan.md"], tags: ["task"] });
    const done = await v.applySetup("saved:trip-kit", { kind: "new", title: "Rome" });
    expect(done.written).toContain("projects/rome/pages/plan.md");
    const plan = await v.read("projects/rome/pages/plan.md");
    expect(plan.meta.title).toBe("Plan");
    expect(plan.text).not.toContain("{{");
    expect(plan.text.endsWith("A plan.\n")).toBe(true);
    expect((await v.read("projects/trip/pages/plan.md")).text).toContain("A plan.");
  });

  it("refuses pages that are not the project's, renames a setup and moves it to the trash", async () => {
    const v = vault();
    await expect(v.saveProjectSetup("trip", "Kit", ["projects/old/_project.md"])).rejects.toThrow("not a page of this project");
    await expect(v.saveProjectSetup("trip", "  ", [])).rejects.toThrow("one line");
    await expect(v.saveProjectSetup("trip", "Kit", [], "../x")).rejects.toThrow("file name");
    const { id } = await v.saveProjectSetup("trip", "Kit", []);
    expect((await v.renameSetup(id, "My kit")).name).toBe("My kit");
    await v.trashSetup(id);
    expect((await v.listSetups()).map((s) => s.id)).toEqual(["research", "writing", "presentation"]);
    await expect(v.applySetup(id, { kind: "new", title: "X" })).rejects.toThrow("There is no setup");
  });
});

describe("the revision and health in the preview", () => {
  it("bumps the counters of the kind of file that changed and tells watchers", async () => {
    const v = vault();
    const seen: Revision[] = [];
    const stop = v.watch({ changed() {}, committed() {}, error() {}, revised: (r) => seen.push(r) });
    const first = await v.revision();
    await v.saveBody("projects/trip/pages/plan.md", "Changed.\n", (await v.read("projects/trip/pages/plan.md")).hash);
    const second = await v.revision();
    expect(second).toMatchObject({ epoch: first.epoch, all: first.all + 1, notes: first.notes + 1, boards: first.boards, decks: first.decks });
    await v.createBoard("Map", "trip");
    const third = await v.revision();
    expect(third).toMatchObject({ all: second.all + 1, boards: second.boards + 1, notes: second.notes });
    expect(seen.map((r) => r.all)).toEqual([second.all, third.all]);
    stop();
    await v.createBoard("Another", "trip");
    expect(seen).toHaveLength(2);
  });

  it("reports counts and nothing else it cannot know", async () => {
    const h = await vault().vaultHealth();
    expect(h.counts).toMatchObject({ notes: 9, boards: 0, decks: 0 });
    expect(h.history.on).toBe(false);
    expect(h.conflicts).toEqual([]);
    expect(h.revision.epoch).toBeGreaterThan(0);
  });
});

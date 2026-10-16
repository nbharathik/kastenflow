// A project's next action, its review days and its updates, through the
// core's project op (the preview vault stands in), each with an Undo that
// puts back exactly what it replaced.

import { beforeEach, describe, expect, it } from "vitest";

import { dayFrom } from "../../../lib/dates";
import { MemoryVault } from "../../workspace/preview/memory-vault";
import { derive } from "../../workspace/store-layout";
import { useWorkspace } from "../../workspace/store";
import { initialLayout } from "../../workspace/tabs";
import { clearReviewDay, markReviewed, newProjectUpdate, openTasksOf, setNextAction } from "./pieces";
import { refOfNote, refOfSummary, type ProjectRef } from "./refs";

const TASK_TAG = "name: task\ncolor: green\nproperties:\n  - {key: status, type: select, options: [Todo, Doing, Done]}\n  - {key: due, type: date}\n";
const task = (title: string, status: string, due = "") => `---\ntitle: ${title}\ntype: page\ntags: [task]\nprops:\n  status: ${status}\n${due ? `  due: ${due}\n` : ""}---\nBody.\n`;

const UPDATE_TEMPLATE = '---\ntitle: "{{title}}"\ntype: page\nicon: 📝\ntags: [project-update]\nprops:\n  date: "{{date}}"\n---\n## Progress\n\n-\n\n## Decisions\n\n-\n\n## Blockers\n\n-\n\n## Next action\n\n-\n';

const SEED = {
  "tags/task.yaml": TASK_TAG,
  "templates/project-update.md": UPDATE_TEMPLATE,
  "projects/kiln/_project.md": "---\ntitle: Kiln\ntype: project\nprops:\n  status: Active\n  last_review: 2026-09-01\n  review_after: 2026-10-01\n---\nThe kiln project.\n",
  "projects/kiln/pages/fire.md": task("Fire the test tile", "Todo", "2026-10-20"),
  "projects/kiln/pages/glaze.md": task("Mix the glaze", "Doing"),
  "projects/kiln/pages/old.md": task("Order clay", "Done"),
  "projects/other/_project.md": "---\ntitle: Other\ntype: project\n---\n",
  "projects/other/pages/elsewhere.md": task("Not in the kiln", "Todo"),
};

let vault: MemoryVault;
let kiln: ProjectRef;

const page = async () => (await vault.read("projects/kiln/_project.md")).meta;
const notices = () => useWorkspace.getState().toasts;
const undo = async () => {
  const last = [...notices()].reverse().find((t) => t.action?.label === "Undo")!;
  last.action!.run();
  await new Promise((r) => setTimeout(r, 30));
};

beforeEach(async () => {
  vault = new MemoryVault(SEED);
  useWorkspace.setState({ client: vault, ready: true, notes: await vault.list(), ...derive(initialLayout()), stack: [], recent: [], toasts: [] });
  kiln = refOfNote(await page());
});

describe("a project as the pieces know it", () => {
  it("reads its next action and review days from its page", () => {
    expect(kiln).toMatchObject({ path: "projects/kiln/_project.md", folder: "kiln", nextActionId: null, lastReview: "2026-09-01", reviewAfter: "2026-10-01" });
  });

  it("reads the same from a hub summary", async () => {
    const [summary] = (await vault.projectSummaries(dayFrom(0))).filter((s) => s.folder === "kiln");
    expect(refOfSummary(summary!)).toMatchObject({ folder: "kiln", lastReview: "2026-09-01", reviewAfter: "2026-10-01" });
  });
});

describe("the tasks a project can do next", () => {
  it("are its open task notes, the soonest due first, and not other projects' or finished ones", () => {
    expect(openTasksOf(useWorkspace.getState().notes, "kiln").map((n) => n.title)).toEqual(["Fire the test tile", "Mix the glaze"]);
  });
});

describe("pinning the next action", () => {
  it("sets the project's next action, and Undo puts back the one before", async () => {
    const notes = useWorkspace.getState().notes;
    const fire = notes.find((n) => n.title === "Fire the test tile")!;
    const glaze = notes.find((n) => n.title === "Mix the glaze")!;
    expect(await setNextAction(kiln, fire)).toBe(true);
    const first = (await page()).props.next_action;
    expect(typeof first).toBe("string");
    expect(notices().at(-1)!.text).toBe("“Fire the test tile” is the next action of “Kiln”");

    expect(await setNextAction({ ...kiln, nextActionId: String(first) }, glaze)).toBe(true);
    expect((await page()).props.next_action).not.toBe(first);
    await undo();
    expect((await page()).props.next_action).toBe(first);

    expect(await setNextAction({ ...kiln, nextActionId: String(first) }, null)).toBe(true);
    expect((await page()).props.next_action).toBeUndefined();
    expect(notices().at(-1)!.text).toBe("Cleared the next action of “Kiln”");
    await undo();
    expect((await page()).props.next_action).toBe(first);
  });

  it("refuses a note that is not a task, in words", async () => {
    const other = { path: "projects/kiln/_project.md", title: "Kiln" };
    expect(await setNextAction(kiln, other)).toBe(false);
    expect(notices().at(-1)!.text).toMatch(/not a task note/);
  });
});

describe("marking a project reviewed", () => {
  it("sets the last review to today and clears the day it was due, and Undo puts both back", async () => {
    expect(await markReviewed(kiln)).toBe(true);
    expect((await page()).props).toMatchObject({ last_review: dayFrom(0) });
    expect((await page()).props.review_after).toBeUndefined();
    expect(notices().at(-1)!.text).toBe("Marked “Kiln” as reviewed");
    await undo();
    expect((await page()).props).toMatchObject({ last_review: "2026-09-01", review_after: "2026-10-01" });
  });

  it("can name the next review at the same time", async () => {
    expect(await markReviewed(kiln, "week")).toBe(true);
    expect((await page()).props).toMatchObject({ last_review: dayFrom(0), review_after: dayFrom(7) });
    expect(notices().at(-1)!.text).toMatch(/^Reviewed “Kiln”; its next review is /);
  });

  it("can take the due day away alone", async () => {
    expect(await clearReviewDay(kiln)).toBe(true);
    expect((await page()).props.review_after).toBeUndefined();
    expect((await page()).props.last_review).toBe("2026-09-01");
    await undo();
    expect((await page()).props.review_after).toBe("2026-10-01");
  });
});

describe("a new project update", () => {
  it("makes a dated page in the project from the update template, opens it and sets the last review", async () => {
    expect(await newProjectUpdate(kiln)).toBe(true);
    const made = (await vault.list()).find((n) => n.title === `Update ${dayFrom(0)}`)!;
    expect(made.project).toBe("kiln");
    expect((await vault.read(made.path)).text).toContain("Progress");
    expect((await page()).props.last_review).toBe(dayFrom(0));
    expect(useWorkspace.getState().place).toMatchObject({ view: "page", path: made.path });
    expect(notices().at(-1)!.text).toBe("Made the update for “Kiln” and marked it reviewed");

    await undo();
    expect((await vault.list()).some((n) => n.title === `Update ${dayFrom(0)}`)).toBe(false);
    expect((await page()).props.last_review).toBe("2026-09-01");
  });
});

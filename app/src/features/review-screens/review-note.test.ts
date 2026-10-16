import { beforeEach, describe, expect, it } from "vitest";

import { dayFrom } from "../../lib/dates";
import type { ProjectSummary } from "../../lib/vault/project-types";
import type { NoteMeta, TaskRow } from "../../lib/vault/types";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { derive } from "../workspace/store-layout";
import { useWorkspace } from "../workspace/store";
import { initialLayout } from "../workspace/tabs";
import { assembleReview, periodOf } from "./assemble";
import { reviewMarkdown, reviewTitle, saveReviewAsNote } from "./review-note";
import { currentReview, useReviewPrefs } from "./review-prefs";

const TODAY = dayFrom(0);

const card = (title: string, over = "") => `---\ntitle: ${title}\ntype: card\ncreated: ${dayFrom(-1)}T09:00:00\n${over}---\nBody.\n`;
const TASK_TAG = "name: task\ncolor: green\nproperties:\n  - {key: status, type: select, options: [Todo, Doing, Done]}\n  - {key: due, type: date}\n";

const SEED = {
  "tags/task.yaml": TASK_TAG,
  "projects/kiln/_project.md": "---\ntitle: Kiln\ntype: project\n---\nThe kiln project.\n",
  "inbox/a.md": card("Kiln notes"),
  "inbox/b.md": card("Glaze recipe"),
  "library/plans.md": `---\ntitle: Plans\ntype: page\n---\n- [ ] Call the mason @${dayFrom(-3)}\n`,
  "library/fire.md": `---\ntitle: Fire the tile\ntype: page\ntags: [task]\nprops:\n  status: Todo\n  due: ${TODAY}\n---\nBody.\n`,
  "library/pick.md": `---\ntitle: Pick the clay\ntype: page\ntags: [decision]\ncreated: ${dayFrom(-1)}T09:00:00\n---\nWe use the grey one.\n`,
};

let vault: MemoryVault;
let notes: NoteMeta[];

const row = (over: Partial<TaskRow> = {}): TaskRow => ({ path: "library/plans.md", title: "Plans", icon: null, line: 0, done: false, text: `Call the mason @${dayFrom(-3)}`, due: dayFrom(-3), at: null, ...over });
const project = (): ProjectSummary => ({
  path: "projects/kiln/_project.md",
  folder: "kiln",
  id: null,
  title: "Kiln",
  icon: null,
  summary: null,
  archived: false,
  status: "Active",
  health: null,
  nextAction: null,
  lastReview: null,
  reviewAfter: dayFrom(-2),
  reviewDue: true,
  tasks: { open: 0, done: 0, overdue: 0 },
  checklist: { open: 0, done: 0, overdue: 0 },
  latest: null,
  lastUpdate: null,
  notes: 0,
  boards: 0,
  decks: 0,
});

beforeEach(async () => {
  localStorage.clear();
  useReviewPrefs.setState({ saved: {} });
  vault = new MemoryVault(SEED);
  notes = await vault.list();
  useWorkspace.setState({ client: vault, ready: true, notes, ...derive(initialLayout()), stack: [], recent: [], toasts: [] });
});

const weekly = () => assembleReview({ period: periodOf("weekly", TODAY), notes, tasks: [row()], projects: [project()] });

describe("a review as Markdown", () => {
  it("lists each section with its count, linking the notes", () => {
    const text = reviewMarkdown(weekly(), periodOf("weekly", TODAY), notes, { highlights: true });
    expect(text).toMatch(/^Weekly review for /);
    expect(text).toContain("## Captures to triage (2)");
    expect(text).toContain("- [[Kiln notes]]");
    expect(text).toContain("## Overdue (1)");
    expect(text).toContain("Call the mason");
    expect(text).toContain("in [[Plans]]");
    expect(text).toContain("## Due (1)");
    expect(text).toContain("- [[Fire the tile]]");
    expect(text).toContain("## Projects due for review (1)");
    expect(text).toContain("- [[Kiln]]");
    expect(text).toContain("## Decisions (1)");
    expect(text).toContain("- [[Pick the clay]]");
  });

  it("writes no to-do line and no day mark, so saving a review makes no new to-do", () => {
    const text = reviewMarkdown(weekly(), periodOf("weekly", TODAY), notes, { highlights: true });
    expect(text).not.toMatch(/- \[[ xX]\]/);
    expect(text).not.toMatch(/@\d{4}-\d{2}-\d{2}/);
  });

  it("says so for a quiet day", () => {
    const quiet = assembleReview({ period: periodOf("daily", TODAY), notes: [], tasks: [], projects: [] });
    expect(reviewMarkdown(quiet, periodOf("daily", TODAY), [], { highlights: true })).toContain("Nothing needed attention.");
  });

  it("names a review by its kind and last day, and keeps the name free", () => {
    expect(reviewTitle(periodOf("weekly", "2026-10-11"), [])).toBe("Weekly review 2026-10-11");
    expect(reviewTitle(periodOf("daily", "2026-10-11"), [{ title: "Daily review 2026-10-11" } as NoteMeta])).toBe("Daily review 2026-10-11 (2)");
  });
});

describe("saving a review as a note", () => {
  it("makes one ordinary page, tagged review, opens it, and marks the review done", async () => {
    const before = (await vault.list()).length;
    const note = await saveReviewAsNote(weekly(), periodOf("weekly", TODAY), true);
    expect(note).not.toBeNull();
    const made = (await vault.list()).filter((n) => n.title.startsWith("Weekly review"));
    expect(made).toHaveLength(1);
    expect((await vault.list()).length).toBe(before + 1);
    expect(made[0]).toMatchObject({ kind: "page", tags: ["review"], project: null });
    expect((await vault.read(made[0]!.path)).text).toContain("## Captures to triage (2)");
    expect(useWorkspace.getState().place).toMatchObject({ view: "page", path: made[0]!.path });
    expect(currentReview().last.weekly).toBe(TODAY);
    expect(currentReview().last.daily).toBeNull();
    expect(useWorkspace.getState().toasts.at(-1)!.text).toBe("Saved the weekly review as a note");
  });

  it("is undone from the notice: the note goes to the trash and the mark goes back", async () => {
    useReviewPrefs.getState().set("Browser preview", { last: { daily: null, weekly: "2026-09-27" } });
    await saveReviewAsNote(weekly(), periodOf("weekly", TODAY), true);
    expect(currentReview().last.weekly).toBe(TODAY);
    useWorkspace.getState().toasts.at(-1)!.action!.run();
    await new Promise((r) => setTimeout(r, 30));
    expect((await vault.list()).some((n) => n.title.startsWith("Weekly review"))).toBe(false);
    expect(currentReview().last.weekly).toBe("2026-09-27");
  });
});

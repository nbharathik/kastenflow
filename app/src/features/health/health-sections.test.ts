// The health report as sections of a page: each says how things stand in a
// word and a sentence, and lists what to look at, with where each issue opens
// and what its repair would do. Pure: nothing here reads or changes the vault.

import { describe, expect, it } from "vitest";

import type { Health } from "../../lib/vault/health-types";
import type { DiagramInfo, NoteMeta, VerifyReport } from "../../lib/vault/types";
import { previewHealth } from "../workspace/preview/memory-health";
import { sectionsOf, type HealthInput, type Section } from "./health-sections";

const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
const REVISION = { epoch: 1, all: 0, notes: 0, boards: 0, decks: 0, tags: 0, references: 0, collections: 0, annotations: 0 };

function report(patch: Partial<Health> = {}): Health {
  return {
    ...previewHealth({ revision: REVISION, counts: { notes: 3, boards: 0, decks: 1, diagrams: 2, sources: 0, assets: 1 }, trash: 0, conflicts: [], indexed: 3 }),
    history: { on: true, pending: 0, lastCommit: NOW - 3 * 60_000, busy: false },
    backup: { state: "ok", lastPush: NOW - 2 * 3_600_000, failures: 0, lastError: null },
    ...patch,
  };
}

const note = (path: string, project: string | null = null): NoteMeta => ({ path, title: path, project }) as unknown as NoteMeta;
const diagram = (path: string, preview: DiagramInfo["preview"], problem: string | null = null): DiagramInfo => ({ path, title: path, project: null, pages: 1, modified: 1, size: 1, preview, problem });

function input(patch: Partial<HealthInput> = {}): HealthInput {
  return {
    health: report(),
    saves: {},
    commitError: null,
    report: null,
    diagrams: [],
    notes: [],
    editorInstalled: true,
    browser: { available: true, on: false },
    now: NOW,
    ...patch,
  };
}

const section = (sections: Section[], id: Section["id"]) => sections.find((s) => s.id === id)!;

describe("the health page's sections", () => {
  it("has the same eight sections in the same order, and all well on a healthy vault", () => {
    const sections = sectionsOf(input());
    expect(sections.map((s) => s.id)).toEqual(["saving", "backup", "external", "proposals", "references", "linked", "meaning", "capability"]);
    for (const s of sections) expect(s.title.length, s.id).toBeGreaterThan(0);
    for (const id of ["saving", "backup", "external", "proposals", "linked"] as const) expect(section(sections, id).level, id).toBe("ok");
    expect(section(sections, "saving").summary).toBe("All changes are saved.");
    expect(section(sections, "backup").summary).toContain("Backed up 2 hours ago");
    expect(section(sections, "backup").summary).toContain("History is on");
  });

  it("tells saving and indexing as the activity indicator does", () => {
    const health = report({ index: { notes: 3, unindexed: 2, schema: 1 } });
    const failed = section(sectionsOf(input({ health, saves: { "a.md": "failed" } })), "saving");
    expect(failed.level).toBe("fail");
    expect(failed.summary).toContain("a.md could not be saved");
    expect(section(sectionsOf(input({ commitError: "disk full" })), "saving").summary).toContain("disk full");
    expect(section(sectionsOf(input({ saves: { "a.md": "edited" } })), "saving").level).toBe("info");
    const indexing = section(sectionsOf(input({ health })), "saving");
    expect(indexing.level).toBe("info");
    expect(indexing.summary).toContain("2 files");
    const waiting = section(sectionsOf(input({ health: report({ history: { on: true, pending: 3, lastCommit: NOW, busy: false } }) })), "saving");
    expect(waiting.summary).toContain("3 edits");
  });

  it("describes the backup: off is a choice, stale warns, failing fails", () => {
    const off = section(sectionsOf(input({ health: report({ backup: { state: "off", lastPush: null, failures: 0, lastError: null } }) })), "backup");
    expect(off.level).toBe("info");
    expect(off.summary).toContain("Backup is off");
    const stale = section(sectionsOf(input({ health: report({ backup: { state: "stale", lastPush: NOW - 3 * 86_400_000, failures: 0, lastError: null } }) })), "backup");
    expect(stale.level).toBe("warn");
    const failing = section(sectionsOf(input({ health: report({ backup: { state: "failing", lastPush: 1, failures: 4, lastError: "no route" } }) })), "backup");
    expect(failing.level).toBe("fail");
    expect(failing.summary).toContain("no route");
    const noHistory = section(sectionsOf(input({ health: report({ history: { on: false, pending: 0, lastCommit: null, busy: false } }) })), "backup");
    expect(noHistory.level).toBe("info");
    expect(noHistory.summary).toContain("History is off");
    // Each of them leads to the settings that fix it.
    expect(section(sectionsOf(input({ health: report({ backup: { state: "failing", lastPush: 1, failures: 4, lastError: "x" } }) })), "backup").issues[0]?.go).toEqual({ settings: "history" });
  });

  it("lists each copy kept after a change outside, with the page it came from and a repair that trashes only the copy", () => {
    const copy = "library/Plan (conflict 2026-10-11 09-30).md";
    const sections = sectionsOf(input({ health: report({ conflicts: [copy, "library/Gone (conflict 2026-10-11 09-31).md"] }), notes: [note("library/Plan.md"), note(copy)] }));
    const external = section(sections, "external");
    expect(external.level).toBe("warn");
    expect(external.issues).toHaveLength(2);
    expect(external.issues[0]).toMatchObject({ go: { path: copy }, repair: { kind: "trash-copy", copy, original: "library/Plan.md" } });
    // The original is gone or was renamed: the repair says so (original null).
    expect(external.issues[1]!.repair).toMatchObject({ kind: "trash-copy", original: null });
  });

  it("counts proposals and leads to Review", () => {
    const proposals = section(sectionsOf(input({ health: report({ proposals: 2 }) })), "proposals");
    expect(proposals.level).toBe("info");
    expect(proposals.summary).toContain("2 changes");
    expect(proposals.issues[0]!.go).toEqual({ view: "review" });
  });

  it("says nothing was checked yet, or what the last check found, or lists the problems of a check just run", () => {
    expect(section(sectionsOf(input()), "references").summary).toContain("not checked yet");
    const last = { time: NOW - 3_600_000, notes: 3, boards: 0, decks: 1, problems: 4 };
    const after = section(sectionsOf(input({ health: report({ lastCheck: last }) })), "references");
    expect(after.level).toBe("warn");
    expect(after.summary).toContain("4 problems");
    expect(after.summary).toContain("Check now");
    const clean = section(sectionsOf(input({ health: report({ lastCheck: { ...last, problems: 0 } }) })), "references");
    expect(clean.level).toBe("ok");

    const found: VerifyReport = {
      notes: 3,
      boards: 0,
      decks: 1,
      gitObjects: 9,
      problems: [
        { kind: "unresolved-link", path: "projects/trip/pages/plan.md", detail: "[[Hotels]] points to no note" },
        { kind: "unresolved-link", path: "library/a.md", detail: "[[tags/x.yaml]] points to no file" },
        { kind: "ambiguous-link", path: "library/b.md", detail: "[[Plan]] could be any of x, y; name one by path" },
        { kind: "board-node", path: "boards/map.canvas", detail: "Card points to a missing note: library/gone.md" },
        { kind: "deck-image", path: "decks/talk.deck", detail: "Image is missing: assets/pic.png" },
        { kind: "diagram-picture", path: "library/flow.drawio.svg", detail: "not a picture" },
        { kind: "frontmatter", path: "library/c.md", detail: "bad yaml" },
        { kind: "remote", path: null, detail: "cannot reach" },
      ],
    };
    const listed = section(sectionsOf(input({ report: found, notes: [note("projects/trip/pages/plan.md", "trip")] })), "references");
    expect(listed.level).toBe("warn");
    expect(listed.summary).toContain("8 problems");
    const byId = (kind: string) => listed.issues.filter((i) => i.id.startsWith(kind));
    // A link to a note that is not there can be answered by making the page, in the project of the page that has the link.
    expect(byId("unresolved-link")[0]).toMatchObject({ go: { path: "projects/trip/pages/plan.md" }, repair: { kind: "create-page", title: "Hotels", project: "trip" } });
    // A link to a file cannot: the page is not what is missing.
    expect(byId("unresolved-link")[1]!.repair).toBeUndefined();
    expect(byId("ambiguous-link")[0]!.go).toEqual({ path: "library/b.md" });
    expect(byId("board-node")[0]!.go).toEqual({ path: "boards/map.canvas" });
    expect(byId("deck-image")[0]).toMatchObject({ go: { path: "decks/talk.deck" }, text: expect.stringContaining("Image is missing") });
    expect(byId("diagram-picture")[0]!.repair).toMatchObject({ kind: "redraw-picture", diagram: "library/flow.drawio" });
    expect(byId("frontmatter")).toHaveLength(1);
    expect(byId("remote")[0]!.go).toEqual({ settings: "history" });
  });

  it("lists the diagram pictures that are out of date or missing, and those that cannot be read", () => {
    const diagrams = [diagram("library/a.drawio", "fresh"), diagram("library/b.drawio", "stale"), diagram("library/c.drawio", "missing"), diagram("library/d.drawio", "stale", "not XML")];
    const linked = section(sectionsOf(input({ diagrams })), "linked");
    expect(linked.level).toBe("warn");
    expect(linked.issues.map((i) => i.id)).toEqual(["picture:library/b.drawio", "picture:library/c.drawio", "picture:library/d.drawio"]);
    expect(linked.issues[0]).toMatchObject({ go: { path: "library/b.drawio" }, repair: { kind: "redraw-picture", diagram: "library/b.drawio" } });
    // One that cannot be read cannot be drawn again.
    expect(linked.issues[2]!.repair).toBeUndefined();
    expect(linked.issues[2]!.detail).toContain("not XML");
  });

  it("lists a draft picture (the program's drawing of an agent's edit) as one the editor will replace, not as out of date", () => {
    const linked = section(sectionsOf(input({ diagrams: [diagram("library/a.drawio", "draft"), diagram("library/b.drawio", "stale")] })), "linked");
    expect(linked.issues.map((i) => i.text)).toEqual(["library/a.drawio: the picture is a draft; the editor draws the exact one", "library/b.drawio: the picture is out of date"]);
    expect(linked.issues[0]!.repair).toMatchObject({ kind: "redraw-picture", diagram: "library/a.drawio" });
  });

  it("reports the search by meaning when it is set up, and says it is off when it is not", () => {
    expect(section(sectionsOf(input()), "meaning").summary).toContain("off");
    const meaning = { provider: "openai", model: "text-embedding-3-small", done: 90, total: 120, running: true };
    const partial = section(sectionsOf(input({ health: report({ meaning }) })), "meaning");
    expect(partial.level).toBe("info");
    expect(partial.summary).toContain("90 of 120");
    expect(partial.summary).toContain("running");
    expect(section(sectionsOf(input({ health: report({ meaning: { ...meaning, done: 120, running: false } }) })), "meaning").level).toBe("ok");
  });

  it("reports what the drawing and web parts can do here, each leading to its settings", () => {
    const missing = section(sectionsOf(input({ editorInstalled: false, browser: { available: true, on: false } })), "capability");
    expect(missing.level).toBe("info");
    expect(missing.issues.map((i) => i.go)).toEqual([{ settings: "diagrams", row: "diagrams.editor" }, { settings: "browser", row: "browser.enabled" }]);
    const ready = section(sectionsOf(input({ editorInstalled: true, browser: { available: true, on: true } })), "capability");
    expect(ready.level).toBe("ok");
    expect(ready.issues).toEqual([]);
    // No desktop, no browser to turn on: not an issue to fix.
    expect(section(sectionsOf(input({ editorInstalled: true, browser: { available: false, on: false } })), "capability").issues).toEqual([]);
  });
});

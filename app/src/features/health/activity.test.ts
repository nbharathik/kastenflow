// The one indicator in the status area: Saved, Saving, Indexing, External
// changes, Proposed, Stale or Failed, worked out from state the window already
// has (each page's save state, the vault's history and backup, and the health
// report). The most urgent state is shown and the others are listed behind it.

import { describe, expect, it } from "vitest";

import type { Health } from "../../lib/vault/health-types";
import { previewHealth } from "../workspace/preview/memory-health";
import { ACTIVITY_LABELS, ACTIVITY_ORDER, activityOf, type ActivityInput } from "./activity";

const REVISION = { epoch: 1, all: 0, notes: 0, boards: 0, decks: 0, tags: 0, references: 0, collections: 0, annotations: 0 };
const COUNTS = { notes: 4, boards: 0, decks: 0, diagrams: 0, sources: 0, assets: 0 };

/** A healthy report: history on, backup working, nothing waiting. */
function healthy(patch: Partial<Health> = {}): Health {
  return {
    ...previewHealth({ revision: REVISION, counts: COUNTS, trash: 0, conflicts: [], indexed: 4 }),
    history: { on: true, pending: 0, lastCommit: 1, busy: false },
    backup: { state: "ok", lastPush: 1, failures: 0, lastError: null },
    ...patch,
  };
}

/** Everything fine. */
const calm = (patch: Partial<ActivityInput> = {}): ActivityInput => ({ saves: { "library/a.md": "saved" }, commitError: null, health: healthy(), ...patch });

describe("the activity indicator", () => {
  it("says Saved when nothing is waiting, failing or old", () => {
    const now = activityOf(calm());
    expect(now.state).toBe("saved");
    expect(now.label).toBe("Saved");
    expect(now.also).toEqual([]);
    expect(now.target).toBeNull();
  });

  it("says Saving while a page has edits that are not written (typed, or being written)", () => {
    for (const save of ["edited", "saving"] as const) {
      const now = activityOf(calm({ saves: { "library/a.md": "saved", "library/b.md": save } }));
      expect(now.state, save).toBe("saving");
      expect(now.label).toBe("Saving…");
    }
  });

  it("says Failed when a page could not be saved, a commit or push failed, or the backup is failing", () => {
    const page = activityOf(calm({ saves: { "library/a.md": "failed" } }));
    expect(page.state).toBe("failed");
    expect(page.detail).toContain("library/a.md could not be saved");
    const commit = activityOf(calm({ commitError: "disk full" }));
    expect(commit.state).toBe("failed");
    expect(commit.detail).toContain("disk full");
    const backup = activityOf(calm({ health: healthy({ backup: { state: "failing", lastPush: 1, failures: 3, lastError: "no route to host" } }) }));
    expect(backup.state).toBe("failed");
    expect(backup.detail).toContain("no route to host");
    const file = activityOf(calm({ health: healthy({ backupFile: { state: "failing", lastWritten: 1, path: "/b", current: false, failures: 1, lastError: "locked" } }) }));
    expect(file.state).toBe("failed");
    expect(file.detail).toContain("locked");
    expect(page.target).toBe("history");
  });

  it("says External changes when the vault holds a copy made after a file changed outside, and counts them", () => {
    const now = activityOf(calm({ health: healthy({ conflicts: ["a (conflict 2026-10-11 09-30).md", "b (conflict 2026-10-11 09-31).md"] }) }));
    expect(now.state).toBe("external");
    expect(now.label).toBe("External changes");
    expect(now.detail).toContain("2 copies");
    expect(now.target).toBe("history");
  });

  it("says Proposed when agent changes wait for review, and goes to Review", () => {
    const now = activityOf(calm({ health: healthy({ proposals: 1 }) }));
    expect(now.state).toBe("proposed");
    expect(now.detail).toContain("1 change");
    expect(now.target).toBe("review");
    expect(activityOf(calm({ health: healthy({ proposals: 4 }) })).detail).toContain("4 changes");
  });

  it("says Indexing while files wait to be taken into the index", () => {
    const now = activityOf(calm({ health: healthy({ index: { notes: 4, unindexed: 3, schema: 1 } }) }));
    expect(now.state).toBe("indexing");
    expect(now.label).toBe("Indexing…");
    expect(now.detail).toContain("3 files");
  });

  it("says Stale for a backup that is old, waiting to be confirmed, or behind the other computer's", () => {
    for (const backup of [{ state: "stale" }, { state: "unconfirmed" }, { state: "ok", behind: true }] as const) {
      const now = activityOf(calm({ health: healthy({ backup: { lastPush: 1, failures: 0, lastError: null, ...backup } }) }));
      expect(now.state, JSON.stringify(backup)).toBe("stale");
      expect(now.target).toBe("history");
    }
    expect(activityOf(calm({ health: healthy({ backupFile: { state: "stale", lastWritten: 1, path: "/b", current: false, failures: 0, lastError: null } }) })).state).toBe("stale");
  });

  it("is quiet about a backup that is off: that is a choice, not a fault", () => {
    expect(activityOf(calm({ health: healthy({ backup: { state: "off", lastPush: null, failures: 0, lastError: null } }) })).state).toBe("saved");
    expect(activityOf(calm({ health: healthy({ history: { on: false, pending: 0, lastCommit: null, busy: false } }) })).state).toBe("saved");
  });

  it("shows the most urgent state and lists the others behind it, in order", () => {
    const busy = calm({
      saves: { "library/a.md": "failed", "library/b.md": "saving" },
      health: healthy({ proposals: 2, conflicts: ["x (conflict 1).md"], index: { notes: 1, unindexed: 1, schema: 1 }, backup: { state: "stale", lastPush: 1, failures: 0, lastError: null } }),
    });
    const now = activityOf(busy);
    expect(now.state).toBe("failed");
    expect(now.also.map((c) => c.state)).toEqual(["external", "proposed", "saving", "indexing", "stale"]);
    // Each state has one label, and the order is the one the others are listed in.
    expect(ACTIVITY_ORDER).toEqual(["failed", "external", "proposed", "saving", "indexing", "stale"]);
    for (const state of [...ACTIVITY_ORDER, "saved"] as const) expect(ACTIVITY_LABELS[state].length).toBeGreaterThan(0);
  });

  it("works with no health report yet (the first moments, or the preview)", () => {
    expect(activityOf({ saves: {}, commitError: null, health: null }).state).toBe("saved");
    expect(activityOf({ saves: { "library/a.md": "saving" }, commitError: null, health: null }).state).toBe("saving");
  });
});

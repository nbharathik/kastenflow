// The preview's digest: what agent sessions did since a moment, and never a person's versions.

import { describe, expect, it } from "vitest";

import { digestIn } from "./agent-sessions";
import type { Version } from "./stored";

const v = (id: string, time: number, extra: Partial<Version> = {}): Version => ({ id, time, summary: `edit: ${id}`, text: id, ...extra });

describe("the preview's activity digest", () => {
  const versions: Record<string, Version[]> = {
    "a.md": [v("a1", 1_000), v("a2", 2_000, { session: "S1", client: "routine: tracking" }), v("a3", 3_000, { session: "S1", client: "routine: tracking" })],
    "b.md": [v("b1", 2_500, { session: "S2", client: "claude-code" }), v("b2", 4_000, { summary: "undo: edit: b1", undoes: "b1" })],
  };

  it("groups agent versions by session and leaves a person's out", () => {
    const digest = digestIn(versions, 0);
    expect(digest.sessions.map((s) => [s.id, s.client, s.changes, s.notesTouched])).toEqual([
      ["S1", "routine: tracking", 2, 1],
      ["S2", "claude-code", 1, 1],
    ]);
    expect(digest.changes).toBe(3);
    expect(digest.sessions[1]).toMatchObject({ undone: true, canUndo: false });
    expect(digest.sessions[0]).toMatchObject({ undone: false, canUndo: true, notes: ["a.md"] });
  });

  it("counts only what happened since the moment, and says nothing when nothing did", () => {
    expect(digestIn(versions, 2_800).sessions.map((s) => [s.id, s.changes])).toEqual([["S1", 1]]);
    expect(digestIn(versions, 9_000)).toEqual({ since: 9_000, sessions: [], changes: 0, waiting: 0 });
  });
});

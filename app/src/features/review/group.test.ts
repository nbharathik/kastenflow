import { describe, expect, it } from "vitest";

import type { CommitInfo, Proposal, SessionInfo } from "../../lib/vault/types";
import { bySession, changesLeft, dayLabel, groupByDay, oldestFirst, sessionCommits, sessionSpan, shortDay, undoneIds } from "./group";
import { clientHue, clientOf, count, descriptionOf, opWords, proposalLine, splitSummary } from "./words";

const NOW = new Date(2026, 8, 24, 15, 0);
const at = (day: number, hour: number, minute = 0) => new Date(2026, 8, day, hour, minute).getTime();

function proposal(id: string, created: string, session: string, client = "claude-code"): Proposal {
  return {
    id,
    created,
    session,
    client,
    status: "pending",
    op: { kind: "trash", path: "a.md" },
    target: { path: "a.md", title: "A" },
    reason: "",
    note: null,
    diff: "",
    before: null,
    after: null,
    decided: null,
    decidedBy: null,
  };
}

function commit(id: string, time: number, extra: Partial<CommitInfo> = {}): CommitInfo {
  return { id, summary: `edit: ${id}`, message: "", author: "You", time, agent: false, session: null, op: null, approvedBy: null, undoes: null, ...extra };
}

describe("proposals", () => {
  it("come oldest first, by time and then id", () => {
    const list = [proposal("03", "2026-09-24T10:00:00Z", "s"), proposal("02", "2026-09-24T09:00:00+02:00", "s"), proposal("01", "2026-09-24T10:00:00Z", "s")];
    expect(oldestFirst(list).map((p) => p.id)).toEqual(["02", "01", "03"]);
  });

  it("group by session, in the order each session's first proposal came", () => {
    const groups = bySession([
      proposal("04", "2026-09-24T10:04:00Z", "B", "cursor"),
      proposal("01", "2026-09-24T10:01:00Z", "A"),
      proposal("03", "2026-09-24T10:03:00Z", "A"),
      proposal("02", "2026-09-24T10:02:00Z", "B", "cursor"),
    ]);
    expect(groups.map((g) => [g.session, g.client, g.proposals.map((p) => p.id)])).toEqual([
      ["A", "claude-code", ["01", "03"]],
      ["B", "cursor", ["02", "04"]],
    ]);
  });
});

describe("days", () => {
  it("names today and yesterday, and dates before that", () => {
    expect(dayLabel("2026-09-24", NOW)).toBe("Today");
    expect(dayLabel("2026-09-23", NOW)).toBe("Yesterday");
    expect(dayLabel("2026-09-21", NOW)).toMatch(/21/);
    expect(dayLabel("2026-09-21", NOW)).not.toMatch(/2026/);
    expect(dayLabel("2025-12-31", NOW)).toMatch(/2025/);
    expect(shortDay("2026-09-21", NOW)).toMatch(/21/);
  });

  it("groups newest-first commits by local day", () => {
    const commits = [commit("c", at(24, 14, 5)), commit("b", at(24, 9)), commit("a", at(23, 23, 59)), commit("z", at(21, 8))];
    const groups = groupByDay(commits, (c) => c.time, NOW);
    expect(groups.map((g) => [g.day, g.items.map((c) => c.id)])).toEqual([
      ["2026-09-24", ["c", "b"]],
      ["2026-09-23", ["a"]],
      ["2026-09-21", ["z"]],
    ]);
    expect(groups.slice(0, 2).map((g) => g.label)).toEqual(["Today", "Yesterday"]);
  });

  it("keeps one group per day even when the order wobbles", () => {
    const commits = [commit("b", at(24, 9)), commit("a", at(23, 9)), commit("c", at(24, 8))];
    expect(groupByDay(commits, (c) => c.time, NOW).map((g) => g.items.length)).toEqual([2, 1]);
  });

  it("describes when a session ran", () => {
    expect(sessionSpan(at(24, 9, 12), at(24, 9, 31), NOW)).toMatch(/^Today, .+–.+$/);
    expect(sessionSpan(at(24, 9, 12), at(24, 9, 12), NOW)).not.toContain("–");
    expect(sessionSpan(at(23, 23, 50), at(24, 0, 20), NOW)).toMatch(/^Yesterday .+ – Today .+$/);
  });
});

describe("sessions", () => {
  const session: SessionInfo = { id: "S", client: "claude-code", started: at(24, 9), last: at(24, 10), commits: 4, undone: false };
  const commits = [
    commit("u1", at(24, 12), { undoes: "c4" }),
    commit("c4", at(24, 10), { session: "S", agent: true }),
    commit("c3", at(24, 9, 40), { session: "S", agent: true }),
    commit("h1", at(24, 9, 30)),
    commit("c2", at(24, 9, 20), { session: "S", agent: true }),
  ];

  it("finds a session's commits and the ones undone", () => {
    expect(sessionCommits(commits, "S").map((c) => c.id)).toEqual(["c4", "c3", "c2"]);
    expect([...undoneIds(commits)]).toEqual(["c4"]);
  });

  it("counts the changes an undo would still revert", () => {
    // Four commits, one undone; the oldest is beyond the list.
    expect(changesLeft(session, commits)).toBe(3);
    expect(changesLeft({ ...session, undone: true }, commits)).toBe(0);
  });
});

describe("words", () => {
  it("says what an op does", () => {
    expect(opWords({ kind: "replace_section", path: "a.md", heading: "Method", markdown: "" })).toBe("Replace section “Method”");
    expect(opWords({ kind: "trash", path: "a.md" })).toBe("Move to trash");
    expect(opWords({ kind: "trash", path: "boards/b.canvas" })).toBe("Move board to trash");
    expect(opWords({ kind: "trash", path: "library/talk.deck" })).toBe("Move deck to trash");
    expect(opWords({ kind: "trash", path: "library/flow.drawio" })).toBe("Move diagram to trash");
    expect(opWords({ kind: "create_diagram", title: "Login flow", xml: "" })).toBe("Create the diagram “Login flow”");
    expect(opWords({ kind: "update_diagram", path: "library/flow.drawio", xml: "", base: "" })).toBe("Rewrite the diagram");
    expect(opWords({ kind: "edit_deck", path: "library/talk.deck", summary: "update elements (add diagram)" })).toBe("Update elements (add diagram)");
    expect(opWords({ kind: "edit_deck", path: "library/talk.deck", summary: "" })).toBe("Change the deck");
    expect(opWords({ kind: "create_deck", title: "Q3 review" })).toBe("Create the deck “Q3 review”");
    expect(opWords({ kind: "edit", path: "a.md", body: "", base: "" })).toBe("Rewrite the whole note");
    expect(opWords({ kind: "append", path: "a.md", markdown: "x", heading: "Notes" })).toBe("Add to section “Notes”");
    expect(opWords({ kind: "append", path: "a.md", markdown: "x" })).toBe("Add to the end");
    expect(opWords({ kind: "create_note", type: "card", title: "Idea" })).toBe("Create card “Idea”");
    expect(opWords({ kind: "create_note", type: "page", title: "Seaside", template: "Trip" })).toBe("Create page “Seaside” from the template “Trip”");
    expect(opWords({ kind: "template", name: "Trip", text: "", base: null })).toBe("Create the template “Trip”");
    expect(opWords({ kind: "template", name: "Trip", text: "", base: "old" })).toBe("Change the template “Trip”");
    expect(opWords({ kind: "tags", path: "a.md", add: ["paper"], remove: [] })).toBe("Add tag #paper");
    expect(opWords({ kind: "tags", path: "a.md", add: ["a"], remove: ["b", "c"] })).toBe("Add #a, remove #b, #c");
    expect(opWords({ kind: "update_props", path: "a.md", props: { status: "Done", venue: "X", due: null } })).toBe("Set status, venue and due");
    expect(opWords({ kind: "rename", path: "a.md", title: "B" })).toBe("Rename to “B”");
    expect(opWords({ kind: "move", path: "a.md", project: null })).toBe("Move to the library");
    expect(opWords({ kind: "tag_schema", tag: "paper", schema: {} })).toBe("Change the schema of #paper");
    expect(opWords({ kind: "add_to_board", board: "b.canvas", notes: ["a.md"] })).toBe("Put 1 note on the board");
    expect(opWords({ kind: "something_new" })).toBe("Something new");
  });

  it("keeps the core's words and drops the diff it added after them", () => {
    expect(descriptionOf("Move “A” to the trash")).toBe("Move “A” to the trash");
    expect(descriptionOf("Create “A”\n\n--- a/new note\n+++ b/new note\n@@ -0,0 +1 @@\n+hi\n")).toBe("Create “A”");
    expect(descriptionOf("--- a/x.md\n+++ b/x.md\n")).toBe("");
  });

  it("splits commit summaries into verb and text", () => {
    expect(splitSummary("edit: Report draft: How people find old notes")).toEqual({ verb: "edit", text: "Report draft: How people find old notes" });
    expect(splitSummary("external: a.md, b.md")).toEqual({ verb: "external", text: "a.md, b.md" });
    expect(splitSummary("Initial commit")).toEqual({ verb: null, text: "Initial commit" });
    expect(clientOf("agent:claude-code")).toBe("claude-code");
  });

  it("writes one line for toasts", () => {
    expect(proposalLine(proposal("01", "2026-09-24T10:00:00Z", "S"))).toBe("“A”: Move to trash");
    expect(count(1, "change")).toBe("1 change");
    expect(count(3, "change")).toBe("3 changes");
  });

  it("gives each client a steady hue", () => {
    expect(clientHue("claude-code")).toBe(clientHue("claude-code"));
    expect(new Set(["claude-code", "cursor", "chat", "claude-desktop"].map(clientHue)).size).toBeGreaterThan(1);
  });
});

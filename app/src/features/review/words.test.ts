import { describe, expect, it } from "vitest";

import type { AgentOp } from "../../lib/vault/types";
import { describeChange } from "./change-words";
import { opWords } from "./words";

const op = (kind: string, rest: Record<string, unknown> = {}): AgentOp => ({ kind, ...rest });

describe("opWords for the structure and parity ops", () => {
  it("says what each one does, not its name", () => {
    const cases: [AgentOp, string][] = [
      [op("set_parent", { path: "a.md", parent: "b.md" }), "Put inside another page"],
      [op("set_parent", { path: "a.md" }), "Take out of its page"],
      [op("reorder_children", { parent: "p.md", ids: ["A", "B"] }), "Put the sub-pages in order"],
      [op("reorder_children", { parent: "p.md", ids: [] }), "Put the sub-pages back in alphabetical order"],
      [op("create_project", { title: "Trip", setup: "research" }), "Create the project “Trip” from the “research” setup"],
      [op("save_project_setup", { project: "trip", title: "Trip kit" }), "Save the project as the setup “Trip kit”"],
      [op("set_project_state", { path: "p", state: { status: "Paused", nextAction: null } }), "Set the project's status and next action"],
      [op("set_tag_views", { tag: "#paper", views: [] }), "Change the views of #paper"],
      [op("set_view_order", { tag: "#paper", view: "Table", ids: ["a", "b"] }), "Put the rows of #paper in order"],
      [op("set_view_order", { tag: "paper", view: "Table", ids: [] }), "Take the hand-made row order off #paper"],
      [op("edit_page", { path: "a.md", steps: [{}, {}] }), "Edit the page in 2 steps"],
      [op("duplicate_note", { path: "a.md" }), "Make a copy"],
      [op("restore_note", { path: ".trash/x/a.md" }), "Bring back from the trash"],
      [op("set_note_meta", { path: "a.md", key: "font", value: "serif" }), "Set the font to serif"],
      [op("set_note_meta", { path: "a.md", key: "icon", value: null }), "Take off the icon"],
      [op("apply_template", { path: "a.md", template: "meeting" }), "Fill the page from the template “meeting”"],
      [op("journal_day", { date: "2026-10-22" }), "Open the journal for 2026-10-22"],
      [op("set_task", { path: "a.md", line: 2, done: true }), "Tick a to-do"],
      [op("set_task", { path: "a.md", line: 2, done: false }), "Untick a to-do"],
      [op("add_comment", { path: "a.md", text: "Source?" }), "Comment: “Source?”"],
      [op("resolve_comment", { path: "a.md", id: "c-1", resolved: true }), "Resolve a comment"],
      [op("create_collection", { name: "Reading", edits: {} }), "Save the search “Reading”"],
      [op("update_collection", { path: "views/r.yaml" }), "Change a saved search"],
      [op("add_reference", { key: "rivera2026saved" }), "Add the reference rivera2026saved to the bibliography"],
      [op("board_changes", { board: "b.canvas", summary: "2 added, 1 taken off" }), "2 added, 1 taken off"],
      [op("rename_diagram", { path: "a.drawio", title: "Flow" }), "Rename the diagram to “Flow”"],
      [op("move_diagram", { path: "a.drawio", project: "trip" }), "Move the diagram to project “trip”"],
      [op("duplicate_diagram", { path: "a.drawio" }), "Make a copy of the diagram"],
      [op("undo_session", { session: "s" }), "Take back all the changes of a session"],
      [op("request_smart_pages", { reason: "A tracker" }), "Turn on smart pages"],
      [op("request_smart_pages", { reason: "A tracker", project: "trip" }), "Turn on smart pages for the project “trip”"],
    ];
    for (const [each, words] of cases) expect(opWords(each)).toBe(words);
    for (const [each] of cases) expect(opWords(each)).not.toMatch(/_/);
  });
});

describe("describeChange for the new commit summaries", () => {
  it("reads the to-do, saved search, reference and order commits", () => {
    expect(describeChange("task: Chores").action).toBe("Ticked or unticked a to-do");
    expect(describeChange("order: sub-pages of Guide").action).toBe("Put sub-pages in order");
    expect(describeChange("collection: create Reading queue")).toMatchObject({ action: "Saved a search", subject: "Reading queue" });
    expect(describeChange("collection: edit Reading queue").action).toBe("Changed a saved search");
    expect(describeChange("reference: add rivera2026saved")).toMatchObject({ action: "Added a reference", subject: "rivera2026saved" });
  });
});

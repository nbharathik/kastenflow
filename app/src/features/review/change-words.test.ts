import { describe, expect, it } from "vitest";

import { longDay } from "../../lib/dates";
import { describeChange, detailsChanged, noteDiff } from "./change-words";

describe("a commit in words", () => {
  it("says what happened, to what", () => {
    expect(describeChange("edit: Trip plan")).toEqual({ action: "Edited", icon: "edit", subject: "Trip plan", detail: null });
    expect(describeChange("create: Trip plan")).toMatchObject({ action: "Created", icon: "plus", subject: "Trip plan" });
    expect(describeChange("trash: Trip plan")).toMatchObject({ action: "Moved to trash", icon: "trash", subject: "Trip plan" });
    expect(describeChange("props: Trip plan")).toMatchObject({ action: "Set properties", subject: "Trip plan" });
    expect(describeChange("comment: Trip plan (resolved)")).toMatchObject({ action: "Commented", icon: "chat", subject: "Trip plan (resolved)" });
    expect(describeChange("highlight: “jot something down” on An article")).toMatchObject({ action: "Highlighted", icon: "highlight" });
    // A journal day is named as the journal names it.
    expect(describeChange("journal: 2026-09-25")).toMatchObject({ action: "Wrote in the journal", subject: longDay("2026-09-25") });
    expect(describeChange("edit: 2026-09-25").subject).toBe(longDay("2026-09-25"));
  });

  it("keeps the detail a summary carries", () => {
    expect(describeChange("rename: Old name → New name")).toMatchObject({ action: "Renamed", subject: "New name", detail: "from Old name" });
    expect(describeChange("restore: Trip plan to 2026-09-24 10:14")).toMatchObject({ action: "Restored", subject: "Trip plan", detail: expect.stringMatching(/^to the version from .*2026/) });
    expect(describeChange("restore: vault to 1a2b3c4d")).toMatchObject({ action: "Restored", subject: "The whole vault", detail: "to version 1a2b3c4d" });
    expect(describeChange("restore: Road to Rome")).toMatchObject({ action: "Restored", subject: "Road to Rome", detail: null });
    expect(describeChange("restore: Trip plan")).toMatchObject({ action: "Restored", subject: "Trip plan", detail: null });
    expect(describeChange("convert: Trip plan to a card")).toMatchObject({ action: "Turned into a card", subject: "Trip plan", detail: null });
    expect(describeChange("board: add 3 cards on Weekly plan")).toMatchObject({ action: "Added 3 cards", icon: "board", subject: "Weekly plan", detail: null });
    expect(describeChange("board: section Day trips on Hilltown")).toMatchObject({ action: "Made the section Day trips", subject: "Hilltown" });
    expect(describeChange("board: tidy up on Hilltown")).toMatchObject({ action: "Changed the whiteboard: tidy up", subject: "Hilltown" });
    expect(describeChange("board: create Weekly plan")).toMatchObject({ action: "Created a whiteboard", subject: "Weekly plan", detail: null });
    expect(describeChange("section: Trip plan § Packing")).toMatchObject({ action: "Rewrote a section", subject: "Trip plan", detail: "§ Packing" });
    expect(describeChange("deck: create Q3 review")).toMatchObject({ action: "Made a deck", icon: "present", subject: "Q3 review", detail: null });
    expect(describeChange("deck: edit Q3 review")).toMatchObject({ action: "Edited a deck", subject: "Q3 review", detail: null });
    expect(describeChange("deck: edit Q3 review § add diagram")).toMatchObject({ action: "Edited a deck", subject: "Q3 review", detail: "add diagram" });
    expect(describeChange("template: Trip plan from Checklist")).toMatchObject({ action: "Made from a template", subject: "Trip plan", detail: "“Checklist”" });
  });

  it("says a diagram's commits as what happened to which diagram", () => {
    expect(describeChange("diagram: create Login flow")).toEqual({ action: "Made a diagram", icon: "diagram", subject: "Login flow", detail: null });
    expect(describeChange("diagram: edit Login flow")).toMatchObject({ action: "Changed a diagram", icon: "diagram", subject: "Login flow", detail: null });
    expect(describeChange("diagram: import Login flow")).toMatchObject({ action: "Imported a diagram", subject: "Login flow" });
    // The picture alone: the diagram itself is as it was.
    expect(describeChange("diagram: preview Login flow")).toMatchObject({ action: "Drew the picture of a diagram again", subject: "Login flow", detail: "the diagram itself is as it was" });
    // An agent says why, after §, as for a deck.
    expect(describeChange("diagram: edit Login flow § add a cache")).toMatchObject({ action: "Changed a diagram", subject: "Login flow", detail: "add a cache" });
  });

  it("says an undo in the words of what it undid", () => {
    expect(describeChange("undo: edit: Trip plan")).toMatchObject({ action: "Undid a change", icon: "undo", subject: "Trip plan", detail: "(edited)" });
  });

  it("keeps a summary it does not know as it is", () => {
    expect(describeChange("Merged from the laptop")).toEqual({ action: null, icon: "history", subject: "Merged from the laptop", detail: null });
    expect(describeChange("tidy: Trip plan")).toMatchObject({ action: "Tidy", subject: "Trip plan" });
  });
});

describe("a note's change", () => {
  const note = (front: string, body: string) => `---\n${front}---\n${body}`;

  it("diffs the text, not the frontmatter, and names the details that changed", () => {
    const before = note("title: Trip\nupdated: 2026-09-24T10:00:00Z\nicon: 🧭\n", "Pack a jumper.\nLeave at nine.\n");
    const after = note("title: Trip\nupdated: 2026-09-25T10:00:00Z\nicon: 🌊\ntags: [travel]\n", "Pack a jumper.\nLeave at ten.\n");
    const { lines, details } = noteDiff("library/trip.md", before, after);
    expect(lines.map((l) => `${l.kind} ${l.text}`)).toEqual(["same Pack a jumper.", "del Leave at nine.", "add Leave at ten."]);
    expect(details).toEqual(["icon", "tags"]);
  });

  it("shows a new note's text, and diffs other files whole", () => {
    expect(noteDiff("library/trip.md", null, note("title: Trip\n", "Hello\n")).lines).toEqual([{ kind: "add", text: "Hello", b: 1 }]);
    expect(noteDiff("boards/plan.canvas", "{}\n", "{ }\n").lines.map((l) => l.kind)).toEqual(["del", "add"]);
    expect(noteDiff("boards/plan.canvas", "{}\n", "{ }\n").details).toEqual([]);
  });

  it("names changed properties in words and ignores the clock", () => {
    expect(detailsChanged("title: A\nprops:\n  status: Doing\n", "title: B\nprops:\n  status: Done\n")).toEqual(["title", "properties"]);
    expect(detailsChanged("updated: 1\n", "updated: 2\n")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";

import { changeLine, noteName, notesLine, startOfToday, waitingLine } from "./agents-today";

describe("the words of Agents today", () => {
  it("counts changes and notes in plain words", () => {
    expect(changeLine({ changes: 3, notesTouched: 2 })).toBe("3 changes in 2 notes");
    expect(changeLine({ changes: 1, notesTouched: 1 })).toBe("1 change in 1 note");
    expect(changeLine({ changes: 2, notesTouched: 0 })).toBe("2 changes");
    expect(waitingLine({ proposalsWaiting: 0 })).toBe("");
    expect(waitingLine({ proposalsWaiting: 1 })).toBe("1 waiting for you");
  });

  it("names a note by its title, or by its file name when the vault does not list it", () => {
    const notes = [{ path: "library/plan.md", title: "The plan" }];
    expect(noteName("library/plan.md", notes)).toBe("The plan");
    expect(noteName("inbox/ask-the-team.md", notes)).toBe("ask the team");
    expect(noteName("odd", [])).toBe("odd");
  });

  it("names the first two notes and how many more", () => {
    const notes = [{ path: "a.md", title: "Alpha" }];
    expect(notesLine({ notes: ["a.md", "b.md", "c.md", "d.md"], notesTouched: 4 }, notes)).toBe("Alpha, b and 2 more");
    expect(notesLine({ notes: ["a.md"], notesTouched: 1 }, notes)).toBe("Alpha");
    expect(notesLine({ notes: [], notesTouched: 0 }, notes)).toBe("");
    // More notes touched than named (the digest names the first fifty).
    expect(notesLine({ notes: ["a.md", "b.md"], notesTouched: 90 }, notes)).toBe("Alpha, b and 88 more");
  });

  it("starts the day at local midnight", () => {
    const noon = new Date(2026, 9, 23, 12, 30, 5);
    expect(startOfToday(noon)).toBe(new Date(2026, 9, 23, 0, 0, 0).getTime());
  });
});

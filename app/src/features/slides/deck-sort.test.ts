import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DeckInfo, NoteMeta } from "../../lib/vault/types";
import { filterDecks, groupByProject, readSort, sortDecks, writeSort } from "./deck-sort";

const deck = (title: string, modified: number, project: string | null = null): DeckInfo => ({ path: `library/${title.toLowerCase().replace(/\s+/g, "-")}.deck`, title, project, slides: 3, modified, size: 100, problem: null });

const decks = [deck("Tool use", 300), deck("Q3 review", 500, "trip"), deck("alpha talk", 100), deck("Lecture 10", 400), deck("Lecture 2", 400, "trip")];
const names = (list: DeckInfo[]) => list.map((d) => d.title);

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("the order of decks", () => {
  it("is the newest first by default, with the name (numbers in order) settling decks edited at the same time", () => {
    expect(names(sortDecks(decks, "recent"))).toEqual(["Q3 review", "Lecture 2", "Lecture 10", "Tool use", "alpha talk"]);
  });

  it("is by name, whatever the case, with numbers in order", () => {
    expect(names(sortDecks(decks, "name"))).toEqual(["alpha talk", "Lecture 2", "Lecture 10", "Q3 review", "Tool use"]);
  });

  it("leaves the list it was given alone", () => {
    const before = names(decks);
    sortDecks(decks, "name");
    expect(names(decks)).toEqual(before);
  });
});

describe("finding decks", () => {
  const notes = [{ path: "projects/trip/trip.md", title: "Japan trip", kind: "project", project: "trip" } as unknown as NoteMeta];

  it("keeps decks whose title holds every word, in any case and order", () => {
    expect(names(filterDecks(decks, notes, "LECTURE"))).toEqual(["Lecture 10", "Lecture 2"]);
    expect(names(filterDecks(decks, notes, "use tool"))).toEqual(["Tool use"]);
    expect(filterDecks(decks, notes, "zebra")).toEqual([]);
  });

  it("finds a deck by the name of its project too", () => {
    expect(names(filterDecks(decks, notes, "japan"))).toEqual(["Q3 review", "Lecture 2"]);
    expect(names(filterDecks(decks, notes, "japan q3"))).toEqual(["Q3 review"]);
  });

  it("gives every deck for nothing typed", () => {
    expect(filterDecks(decks, notes, "   ")).toHaveLength(decks.length);
  });
});

describe("decks by project", () => {
  it("puts the projects by title, the decks not in one last, and the newest first inside each", () => {
    const notes = [{ path: "projects/trip/trip.md", title: "Japan trip", kind: "project", project: "trip" } as unknown as NoteMeta];
    const groups = groupByProject(decks, notes);
    expect(groups.map((g) => g.title)).toEqual(["Japan trip", "Not in a project"]);
    expect(names(groups[0]!.decks)).toEqual(["Q3 review", "Lecture 2"]);
    expect(names(groups[1]!.decks)).toEqual(["Lecture 10", "Tool use", "alpha talk"]);
  });
});

describe("the order that is kept", () => {
  it("starts with the newest first, and comes back as chosen", () => {
    expect(readSort()).toBe("recent");
    writeSort("name");
    expect(readSort()).toBe("name");
    writeSort("project");
    expect(readSort()).toBe("project");
  });

  it("ignores what it does not know, and works where the browser keeps nothing", () => {
    localStorage.setItem("kasten.slides.sort", "sideways");
    expect(readSort()).toBe("recent");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readSort()).toBe("recent");
    expect(() => writeSort("name")).not.toThrow();
  });
});

import { describe, expect, it } from "vitest";

import { around, firstLine, INBOX, JOURNAL, MAX_RECENT, nextTarget, orderedTargets, pickerChoices, placeName, readRecent, remember, sameTarget, targetsWith, wheelStep, type Places, type Target } from "./targets";

const places = targetsWith([
  { slug: "trip", title: "Trip" },
  { slug: "garden", title: "Garden" },
]);

const page = (path: string, title: string): Target => ({ kind: "page", path, title });
const trip: Target = { kind: "project", slug: "trip", title: "Trip" };

describe("where a quick capture goes", () => {
  it("starts in the inbox, then the journal, then projects by title", () => {
    expect(places.map(placeName)).toEqual(["Inbox", "Today's journal", "Garden", "Trip"]);
  });

  it("goes round with Tab, and back with Shift+Tab", () => {
    let at = INBOX;
    const seen = [];
    for (let i = 0; i < 5; i++) {
      at = nextTarget(places, at);
      seen.push(placeName(at));
    }
    expect(seen).toEqual(["Today's journal", "Garden", "Trip", "Inbox", "Today's journal"]);
    expect(placeName(nextTarget(places, INBOX, true))).toBe("Trip");
    expect(nextTarget(places, JOURNAL, true)).toEqual(INBOX);
  });

  it("falls back to the inbox when a project is gone", () => {
    expect(nextTarget(places, { kind: "project", slug: "gone", title: "Gone" })).toEqual(INBOX);
    expect(nextTarget([], JOURNAL)).toEqual(INBOX);
  });

  it("names a capture by its first line", () => {
    expect(firstLine("  - [ ] Call the plumber\nabout the sink")).toBe("Call the plumber");
    expect(firstLine("# Idea\nmore")).toBe("Idea");
  });

  it("names a page by its title, and tells places apart", () => {
    expect(placeName(page("a.md", "Reading list"))).toBe("Reading list");
    expect(placeName(page("a.md", ""))).toBe("Untitled");
    expect(sameTarget(page("a.md", "One"), page("a.md", "Renamed"))).toBe(true);
    expect(sameTarget(page("a.md", "One"), page("b.md", "One"))).toBe(false);
    expect(sameTarget(INBOX, JOURNAL)).toBe(false);
    expect(sameTarget(trip, { ...trip, title: "Trips" })).toBe(true);
  });
});

describe("recent places", () => {
  it("are read from storage, newest first, once each, and only what reads", () => {
    const raw = JSON.stringify([
      { kind: "page", path: "a.md", title: "A" },
      { kind: "project", slug: "trip", title: "Trip" },
      { kind: "page", path: "a.md", title: "A again" },
      { kind: "inbox" },
      { kind: "page", title: "No path" },
      { kind: "elsewhere" },
      null,
      7,
    ]);
    expect(readRecent(raw)).toEqual([page("a.md", "A"), trip, INBOX]);
    expect(readRecent(null)).toEqual([]);
    expect(readRecent("not json")).toEqual([]);
    expect(readRecent('{"kind":"inbox"}')).toEqual([]);
  });

  it("keep eight at most", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ kind: "page", path: `${i}.md`, title: `P${i}` }));
    expect(readRecent(JSON.stringify(many))).toHaveLength(MAX_RECENT);
    let recent: Target[] = [];
    for (let i = 0; i < 12; i++) recent = remember(recent, page(`${i}.md`, `P${i}`));
    expect(recent).toHaveLength(MAX_RECENT);
    expect(recent[0]).toEqual(page("11.md", "P11"));
  });

  it("move a place to the front when it is used again", () => {
    const first = remember([], page("a.md", "A"));
    const second = remember(first, trip);
    expect(remember(second, page("a.md", "A")).map(placeName)).toEqual(["A", "Trip"]);
  });
});

describe("the places in order", () => {
  const projects = [
    { slug: "trip", title: "Trip" },
    { slug: "garden", title: "Garden" },
  ];
  const pages = [
    { path: "a.md", title: "Reading list", modified: 5 },
    { path: "b.md", title: "Travel plans", modified: 9 },
    { path: "c.md", title: "Trip budget", modified: 7 },
    { path: "d.md", title: "Packing for a trip", modified: 8 },
  ];
  const at = (recent: Target[] = []): Places => ({ projects, recent, pages });

  it("list recent places first, then the inbox, the journal and the projects", () => {
    expect(orderedTargets(at([page("b.md", "Travel plans"), trip])).map(placeName)).toEqual(["Travel plans", "Trip", "Inbox", "Today's journal", "Garden"]);
    expect(orderedTargets(at()).map(placeName)).toEqual(["Inbox", "Today's journal", "Garden", "Trip"]);
  });

  it("put the inbox or the journal first when they were the last used, once each", () => {
    expect(orderedTargets(at([JOURNAL, INBOX])).map(placeName)).toEqual(["Today's journal", "Inbox", "Garden", "Trip"]);
  });

  it("leave out a project or page that is gone, and keep pages while the notes are not read", () => {
    const gone: Target = { kind: "project", slug: "gone", title: "Gone" };
    expect(orderedTargets(at([gone, page("zz.md", "Deleted")])).map(placeName)).toEqual(["Inbox", "Today's journal", "Garden", "Trip"]);
    expect(orderedTargets({ projects, recent: [page("zz.md", "Waiting")], pages: [] }).map(placeName)[0]).toBe("Waiting");
  });

  it("show a renamed project by its current title", () => {
    const renamed = orderedTargets({ projects: [{ slug: "trip", title: "Journey" }], recent: [{ kind: "project", slug: "trip", title: "Trip" }], pages: [] });
    expect(placeName(renamed[0]!)).toBe("Journey");
  });

  it("narrow to what holds the typed text, what starts with it first: places, then pages by newest", () => {
    // Starting with it: Trip, then the pages Travel plans (9) and Trip budget (7); only holding it: Packing for a trip.
    expect(pickerChoices("tr", at()).map(placeName)).toEqual(["Trip", "Travel plans", "Trip budget", "Packing for a trip"]);
    // "Reading list" does not hold it.
    expect(pickerChoices("TRIP", at()).map(placeName)).toEqual(["Trip", "Trip budget", "Packing for a trip"]);
    // A page that starts with the letter comes before the places that only hold it.
    expect(pickerChoices("r", at()).map(placeName)).toEqual(["Reading list", "Today's journal", "Garden", "Trip", "Travel plans", "Packing for a trip", "Trip budget"]);
    expect(pickerChoices("x", { ...at(), pages: [...pages, { path: "x.md", title: "Xylophone lessons", modified: 1 }] }).map(placeName)).toEqual(["Xylophone lessons", "Inbox"]);
    expect(pickerChoices("  inb ", at()).map(placeName)).toEqual(["Inbox"]);
    expect(pickerChoices("zzz", at())).toEqual([]);
  });

  it("list a recent page once, among the places", () => {
    const found = pickerChoices("trip", at([page("c.md", "Trip budget")])).map(placeName);
    expect(found).toEqual(["Trip budget", "Trip", "Packing for a trip"]);
  });

  it("offer only the places for nothing typed, and no more than ten pages for a letter", () => {
    expect(pickerChoices("", at()).map(placeName)).toEqual(["Inbox", "Today's journal", "Garden", "Trip"]);
    const many = Array.from({ length: 30 }, (_, i) => ({ path: `${i}.md`, title: `Note ${i}`, modified: i }));
    const found = pickerChoices("note", { projects: [], recent: [], pages: many });
    expect(found).toHaveLength(10);
    expect(placeName(found[0]!)).toBe("Note 29");
  });
});

describe("cycling", () => {
  it("steps by the turn of the wheel, with a nudge meaning none", () => {
    expect(wheelStep(100)).toBe(1);
    expect(wheelStep(-3)).toBe(-1);
    expect(wheelStep(0.4)).toBe(0);
    expect(wheelStep(0)).toBe(0);
  });

  it("goes round at both ends", () => {
    expect(around(0, -1, 4)).toBe(3);
    expect(around(3, 1, 4)).toBe(0);
    expect(around(2, 1, 4)).toBe(3);
    expect(around(0, 1, 0)).toBe(0);
  });
});

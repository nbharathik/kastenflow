import { describe, expect, it } from "vitest";

import { HOME_DEFAULT, HOME_SECTIONS, homeSections, inZone } from "./sections";

describe("Home's sections", () => {
  it("are each named once, with a place in the main column or the slim one", () => {
    expect(new Set(HOME_SECTIONS.map((d) => d.id)).size).toBe(HOME_SECTIONS.length);
    for (const def of HOME_SECTIONS) {
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.hint.length).toBeGreaterThan(0);
      expect(["main", "side"]).toContain(def.zone);
    }
  });

  it("show the simple layout until the person changes it: the list, today, the to-dos and the Inbox", () => {
    expect(homeSections(null)).toEqual(["favourites", "recent", "schedule", "todo", "inbox"]);
    expect(homeSections(null)).toEqual([...HOME_DEFAULT]);
    // Everything else is there to turn on, and off by default.
    for (const id of ["projects", "pages", "week", "journal", "boards", "decks"] as const) {
      expect(HOME_SECTIONS.some((d) => d.id === id)).toBe(true);
      expect(HOME_DEFAULT).not.toContain(id);
    }
  });

  it("drop the old quick-action row and capture box, which the top of Home replaces, from a saved choice", () => {
    expect(homeSections(["actions", "capture", "recent", "todo", "journal"])).toEqual(["recent", "todo", "journal"]);
    expect(homeSections(["nope"])).toEqual([]);
  });

  it("split into the two columns, each in the person's order", () => {
    const list = homeSections(["inbox", "recent", "journal", "projects", "todo", "favourites"]);
    expect(inZone(list, "main")).toEqual(["recent", "projects", "favourites"]);
    expect(inZone(list, "side")).toEqual(["inbox", "journal", "todo"]);
  });
});

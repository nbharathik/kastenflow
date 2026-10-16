// What exporting a project would put in its bundle, in words: counts by kind
// of file, the size, what is left out, and the destination folder's name.

import { describe, expect, it } from "vitest";

import type { BundleFile, BundlePlan } from "../../../lib/vault/bundle-types";
import { NOT_INCLUDED, bundleName, groupsOf, joinPath, megabytes, planWords } from "./plan-words";

const file = (path: string, kind: BundleFile["kind"], bytes = 100): BundleFile => ({ path, kind, bytes });

const PLAN: BundlePlan = {
  project: { folder: "trip", title: "Seaside trip", id: "01J8" },
  files: [
    file("projects/trip/_project.md", "project"),
    file("projects/trip/pages/plan.md", "project"),
    file("projects/trip/pages/packing.md", "project"),
    file("projects/trip/cards/idea.md", "project"),
    file("projects/trip/boards/map.canvas", "project"),
    file("projects/trip/talks/pitch.deck", "project"),
    file("projects/trip/diagrams/flow.drawio", "project"),
    file("projects/trip/diagrams/flow.drawio.svg", "project"),
    file("projects/trip/notes.txt", "project"),
    file("assets/map.png", "asset", 4_000_000),
    file("assets/ticket.png", "asset", 200_000),
    file("sources/paper.pdf", "source", 1_500_000),
    file("tags/place.yaml", "tag"),
    file("references.bib", "references"),
  ],
  bytes: 5_700_900,
  references: ["vaswani2017attention", "lecun2015deep"],
  missingReferences: ["nobody2020"],
  outside: ["3 links lead to notes outside the project", "1 board card points to a note outside the project"],
};

describe("what a bundle holds, counted", () => {
  it("counts the project's files by what they are, and the rest by where they come from", () => {
    expect(groupsOf(PLAN).map((g) => [g.label, g.count])).toEqual([
      ["pages", 3],
      ["cards", 1],
      ["whiteboards", 1],
      ["decks", 1],
      ["diagrams", 1],
      ["other files", 1],
      ["pictures and files", 2],
      ["PDFs", 1],
      ["tag databases", 1],
      ["bibliography entries", 2],
    ]);
  });

  it("leaves out a kind with nothing in it, and says 'one' for one", () => {
    const words = planWords({ ...PLAN, files: [file("projects/trip/_project.md", "project")], references: [], bytes: 100 });
    expect(words.summary).toBe("1 page · 100 bytes");
    expect(planWords(PLAN).summary).toBe("3 pages, 1 card, 1 whiteboard, 1 deck, 1 diagram, 1 other file, 2 pictures and files, 1 PDF, 1 tag database and 2 bibliography entries · 5.4 MB");
  });

  it("carries the notes about what is left out and what is missing, and says what is never in a bundle", () => {
    const words = planWords(PLAN);
    expect(words.outside).toEqual(PLAN.outside);
    expect(words.missing).toBe("Cited in the project but in no bibliography file, so they go without an entry: nobody2020.");
    expect(planWords({ ...PLAN, missingReferences: [], outside: [] })).toMatchObject({ missing: null, outside: [] });
    expect(NOT_INCLUDED).toContain("credentials");
    expect(NOT_INCLUDED).toContain("history");
    expect(NOT_INCLUDED).toContain("chats");
    expect(NOT_INCLUDED).toContain("trash");
  });
});

describe("the sizes and the folder", () => {
  it("writes sizes the way a person reads them", () => {
    expect(megabytes(0)).toBe("0 bytes");
    expect(megabytes(1)).toBe("1 byte");
    expect(megabytes(1_500)).toBe("1.5 KB");
    expect(megabytes(5_700_900)).toBe("5.4 MB");
    expect(megabytes(3_221_225_472)).toBe("3.0 GB");
  });

  it("names the bundle folder after the project, with nothing a folder name cannot hold", () => {
    expect(bundleName("trip")).toBe("trip-bundle");
    expect(bundleName("Seaside trip: 2026/27")).toBe("seaside-trip-2026-27-bundle");
    expect(bundleName("")).toBe("project-bundle");
  });

  it("puts that name after the chosen folder, with the separator the folder uses", () => {
    expect(joinPath("/home/ada/Documents", "trip-bundle")).toBe("/home/ada/Documents/trip-bundle");
    expect(joinPath("/home/ada/Documents/", "trip-bundle")).toBe("/home/ada/Documents/trip-bundle");
    expect(joinPath("C:\\Users\\ada\\Documents", "trip-bundle")).toBe("C:\\Users\\ada\\Documents\\trip-bundle");
    expect(joinPath("C:\\", "trip-bundle")).toBe("C:\\trip-bundle");
  });
});

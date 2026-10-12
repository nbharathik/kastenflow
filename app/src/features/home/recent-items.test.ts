import { describe, expect, it } from "vitest";

import type { BoardInfo, DeckInfo, DiagramInfo, NoteMeta } from "../../lib/vault/types";
import { countTypes, NO_PROJECT, pick, type Query, type Sources } from "./recent-items";

let made = 0;
const note = (path: string, over: Partial<NoteMeta> = {}): NoteMeta => ({
  path,
  id: `n${made++}`,
  title: path.split("/").pop()!.replace(/\.md$/, ""),
  kind: "page",
  icon: null,
  cover: null,
  parent: null,
  project: null,
  tags: [],
  modified: 1,
  created: null,
  updated: null,
  excerpt: "",
  words: 0,
  props: {},
  locked: false,
  ...over,
});
const board = (path: string, title: string, modified: number, project: string | null = null): BoardInfo => ({ path, title, project, nodes: 3, modified });
const deck = (path: string, title: string, modified: number, project: string | null = null): DeckInfo => ({ path, title, project, slides: 4, modified, size: 10, problem: null });
const diagram = (path: string, title: string, modified: number): DiagramInfo => ({ path, title, project: null, pages: 1, modified, size: 10, preview: "fresh", problem: null });

const sources = (over: Partial<Sources> = {}): Sources => ({ notes: [], boards: [], decks: [], diagrams: [], opened: [], ...over });
const all: Query = { type: "all", project: null, text: "" };
const paths = (src: Sources, query: Query = all, limit = 10) => pick(src, query, limit).items.map((i) => i.path);

describe("what the recent list picks", () => {
  it("puts what changed last first, and keeps ties in path order", () => {
    const notes = [note("library/a.md", { modified: 10 }), note("library/c.md", { modified: 30 }), note("library/b.md", { modified: 30 }), note("library/d.md", { modified: 20 })];
    expect(paths(sources({ notes }))).toEqual(["library/b.md", "library/c.md", "library/d.md", "library/a.md"]);
  });

  it("mixes pages, whiteboards, decks and diagrams by when they changed", () => {
    const src = sources({
      notes: [note("library/page.md", { modified: 10 })],
      boards: [board("library/b.canvas", "Plan", 40)],
      decks: [deck("library/d.deck", "Pitch", 30)],
      diagrams: [diagram("library/flow.drawio", "Flow", 20)],
    });
    const items = pick(src, all, 10).items;
    expect(items.map((i) => [i.type, i.title])).toEqual([
      ["board", "Plan"],
      ["deck", "Pitch"],
      ["diagram", "Flow"],
      ["page", "page"],
    ]);
    expect(items.every((i) => i.icon.length > 0)).toBe(true);
  });

  it("leads with the last few things opened, as long as they exist", () => {
    const notes = [note("library/new.md", { modified: 90 }), note("library/old.md", { modified: 1 }), note("library/mid.md", { modified: 50 })];
    const src = sources({ notes, decks: [deck("library/talk.deck", "Talk", 5)], opened: ["library/old.md", "library/gone.md", "library/talk.deck", "library/old.md"] });
    expect(paths(src)).toEqual(["library/old.md", "library/talk.deck", "library/new.md", "library/mid.md"]);
  });

  it("lets only the latest five opened lead, so new things still show", () => {
    const notes = Array.from({ length: 8 }, (_, i) => note(`library/o${i}.md`, { modified: i + 1 }));
    const fresh = note("library/fresh.md", { modified: 1000 });
    const src = sources({ notes: [...notes, fresh], opened: notes.map((n) => n.path) });
    const found = paths(src, all, 8);
    expect(found.slice(0, 5)).toEqual(["library/o0.md", "library/o1.md", "library/o2.md", "library/o3.md", "library/o4.md"]);
    expect(found[5]).toBe("library/fresh.md");
  });

  it("leaves out journal days, chats and templates, and counts a project page as a page", () => {
    const notes = [note("journal/2026/2026-10-07.md", { kind: "journal" }), note("chats/x.md", { kind: "chat" }), note("templates/page.md", { kind: "template" }), note("projects/trip/_project.md", { kind: "project", project: "trip" })];
    const items = pick(sources({ notes }), all, 10).items;
    expect(items.map((i) => [i.path, i.type])).toEqual([["projects/trip/_project.md", "page"]]);
  });

  it("tells pages, cards and captures apart, and each chip shows only its own", () => {
    const notes = [
      note("library/page.md", { modified: 1 }),
      note("inbox/quick.md", { kind: "card", modified: 2 }),
      note("inbox/clip.md", { kind: "card", tags: ["Capture"], modified: 3 }),
      note("library/hl.md", { kind: "highlight", modified: 4 }),
    ];
    const src = sources({ notes });
    expect(paths(src, { ...all, type: "page" })).toEqual(["library/page.md"]);
    expect(paths(src, { ...all, type: "card" })).toEqual(["library/hl.md", "inbox/quick.md"]);
    expect(paths(src, { ...all, type: "capture" })).toEqual(["inbox/clip.md"]);
    expect(countTypes(src)).toEqual({ page: 1, card: 2, capture: 1, board: 0, deck: 0, diagram: 0 });
  });

  it("narrows to boards, decks or diagrams", () => {
    const src = sources({ notes: [note("library/a.md")], boards: [board("library/b.canvas", "B", 1)], decks: [deck("library/d.deck", "D", 1)], diagrams: [diagram("library/f.drawio", "F", 1)] });
    expect(paths(src, { ...all, type: "board" })).toEqual(["library/b.canvas"]);
    expect(paths(src, { ...all, type: "deck" })).toEqual(["library/d.deck"]);
    expect(paths(src, { ...all, type: "diagram" })).toEqual(["library/f.drawio"]);
  });

  it("narrows to a project, or to what is in none", () => {
    const src = sources({
      notes: [note("projects/trip/pages/a.md", { project: "trip", modified: 3 }), note("projects/home/pages/b.md", { project: "home", modified: 2 }), note("library/c.md", { modified: 1 })],
      boards: [board("projects/trip/x.canvas", "X", 9, "trip")],
    });
    expect(paths(src, { ...all, project: "trip" })).toEqual(["projects/trip/x.canvas", "projects/trip/pages/a.md"]);
    expect(paths(src, { ...all, project: NO_PROJECT })).toEqual(["library/c.md"]);
  });

  it("narrows as you type: titles that start with the words, then ones with a word that does, then the rest", () => {
    const notes = [
      note("library/1.md", { title: "Budget for the trip", modified: 5 }),
      note("library/2.md", { title: "Trip to Rome", modified: 1 }),
      note("library/3.md", { title: "Roadtrip", modified: 9 }),
      note("library/4.md", { title: "Unrelated", modified: 99 }),
    ];
    const found = pick(sources({ notes }), { ...all, text: "  TRIP " }, 10);
    expect(found.items.map((i) => i.title)).toEqual(["Trip to Rome", "Budget for the trip", "Roadtrip"]);
    expect(found.total).toBe(3);
  });

  it("lets a better match come before a thing opened lately", () => {
    const notes = [note("library/a.md", { title: "Meeting notes", modified: 1 }), note("library/b.md", { title: "Notes", modified: 2 })];
    expect(paths(sources({ notes, opened: ["library/a.md"] }), { ...all, text: "notes" })).toEqual(["library/b.md", "library/a.md"]);
  });

  it("says how many match in all, however few are shown", () => {
    const notes = Array.from({ length: 25 }, (_, i) => note(`library/n${i}.md`, { modified: i }));
    const found = pick(sources({ notes, opened: ["library/n3.md"] }), all, 10);
    expect(found.items).toHaveLength(10);
    expect(found.total).toBe(25);
    expect(pick(sources({ notes }), { ...all, text: "nothing like it" }, 10)).toEqual({ items: [], total: 0 });
  });

  it("is quick on ten thousand notes", () => {
    const notes = Array.from({ length: 10_000 }, (_, i) => note(`library/note-${i}.md`, { title: `Note ${i} about things`, modified: i, tags: i % 50 === 0 ? ["capture"] : [] }));
    const src = sources({ notes, boards: Array.from({ length: 300 }, (_, i) => board(`library/b${i}.canvas`, `Board ${i}`, i)), opened: ["library/note-77.md"] });
    pick(src, all, 10); // builds the notes' index once, as the sidebar already has
    // The best of three, so a busy machine does not fail it; a pass over the notes that
    // compares each with each other would take seconds, not a fraction of one.
    const time = (query: Query) => {
      let ms = Infinity;
      let found = pick(src, query, 10);
      for (let i = 0; i < 3; i++) {
        const start = performance.now();
        found = pick(src, query, 10);
        ms = Math.min(ms, performance.now() - start);
      }
      return { ms, found };
    };
    const plain = time(all);
    const typed = time({ ...all, text: "about" });
    const captures = time({ ...all, type: "capture" });
    expect(plain.found.items).toHaveLength(10);
    expect(typed.found.total).toBe(10_000);
    expect(captures.found.total).toBe(200);
    expect(Math.max(plain.ms, typed.ms, captures.ms)).toBeLessThan(250);
  });
});

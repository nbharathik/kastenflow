import { describe, expect, it } from "vitest";

import type { NoteMeta } from "../../lib/vault/types";
import { FIRST_ROWS, matchTree, shownRows, sidebarLoose, sidebarRows } from "./sidebar-rows";
import { projects } from "./tree";

function note(path: string, extra: Partial<NoteMeta> = {}): NoteMeta {
  const parts = path.split("/");
  const project = parts[0] === "projects" ? parts[1]! : null;
  const kind = path.endsWith("_project.md") ? "project" : path.includes("/cards/") ? "card" : "page";
  return {
    path,
    id: null,
    title: parts[parts.length - 1]!.replace(/\.md$/, ""),
    kind,
    icon: null,
    cover: null,
    parent: null,
    project,
    tags: [],
    modified: 0,
    created: null,
    updated: null,
    excerpt: "",
    words: 0,
    props: {},
    locked: false,
    ...extra,
  };
}

const vault = (): NoteMeta[] => [
  note("projects/study/_project.md", { title: "Study", id: "p" }),
  note("projects/study/pages/Draft.md", { id: "d" }),
  note("projects/study/pages/Outline.md", { id: "o" }),
  note("projects/study/pages/Sources.md"),
  note("projects/study/pages/Sub of draft.md", { parent: "d" }),
  note("projects/study/cards/quick thought.md"),
  note("projects/study/cards/clipped link.md"),
  note("library/Loose one.md"),
  note("library/Loose two.md"),
];

const study = (notes: NoteMeta[]) => projects(notes)[0]!;
const titles = (rows: NoteMeta[]) => rows.map((n) => n.title);

describe("what the sidebar lists under a project", () => {
  it("leaves out quick notes and captures unless asked for", () => {
    const notes = vault();
    // Sub-pages stay under their page.
    expect(titles(sidebarRows(notes, study(notes), false, []))).toEqual(["Draft", "Outline", "Sources"]);
    expect(titles(sidebarRows(notes, study(notes), true, []))).toEqual(["Draft", "Outline", "Sources", "clipped link", "quick thought"]);
  });

  it("leaves a page's sub-pages as they are", () => {
    const notes = vault();
    expect(titles(sidebarRows(notes, notes[1]!, false, []))).toEqual(["Sub of draft"]);
  });

  it("puts pinned pages first, keeping the order within each group", () => {
    const notes = vault();
    const pins = ["projects/study/pages/Sources.md"];
    expect(titles(sidebarRows(notes, study(notes), false, pins))).toEqual(["Sources", "Draft", "Outline"]);
    const two = ["projects/study/pages/Outline.md", "projects/study/pages/Sources.md"];
    expect(titles(sidebarRows(notes, study(notes), false, two))).toEqual(["Outline", "Sources", "Draft"]);
  });

  it("pins a loose page too", () => {
    const notes = vault();
    expect(titles(sidebarLoose(notes, ["library/Loose two.md"]))).toEqual(["Loose two", "Loose one"]);
  });

  it("gives the same array while nothing changed, so rows do not redraw", () => {
    const notes = vault();
    const pins = ["projects/study/pages/Sources.md"];
    const a = sidebarRows(notes, study(notes), false, pins);
    expect(sidebarRows(notes, study(notes), false, pins)).toBe(a);
    // Another setting is another list.
    expect(sidebarRows(notes, study(notes), true, pins)).not.toBe(a);
  });

  it("keeps the rows themselves when nothing needs to go or move", () => {
    const notes = vault();
    const all = notes.filter((n) => n.project === "study" && n.kind === "page");
    expect(shownRows(all, false, [])).toBe(all);
    expect(shownRows(all, true, ["projects/study/pages/Draft.md"])).toBe(all);
    expect(shownRows(all, true, ["gone.md"])).toBe(all);
  });

  it("lists a short first stretch of a long project", () => {
    expect(FIRST_ROWS).toBe(15);
  });
});

describe("the sidebar's filter", () => {
  it("shows what matches with what holds it, opened out", () => {
    const notes = vault();
    const found = matchTree(notes, "sub of")!;
    expect([...found.show].sort()).toEqual(["projects/study/_project.md", "projects/study/pages/Draft.md", "projects/study/pages/Sub of draft.md"]);
    expect([...found.open].sort()).toEqual(["projects/study/_project.md", "projects/study/pages/Draft.md"]);
  });

  it("matches any case, trims, and shows a loose page without opening anything", () => {
    const notes = vault();
    const found = matchTree(notes, "  LOOSE  ")!;
    expect([...found.show].sort()).toEqual(["library/Loose one.md", "library/Loose two.md"]);
    expect(found.open.size).toBe(0);
    expect(found.query).toBe("loose");
  });

  it("finds a project by its title without opening it", () => {
    const found = matchTree(vault(), "study")!;
    expect(found.show.has("projects/study/_project.md")).toBe(true);
    expect(found.open.size).toBe(0);
  });

  it("is off for an empty filter and finds nothing for text no title has", () => {
    expect(matchTree(vault(), "")).toBeNull();
    expect(matchTree(vault(), "   ")).toBeNull();
    expect(matchTree(vault(), "zzz")!.show.size).toBe(0);
  });

  it("matches whiteboards and decks by title, opening their project", () => {
    const notes = vault();
    const found = matchTree(notes, "roadmap", [{ path: "projects/study/roadmap.canvas", title: "Roadmap", project: "study" }])!;
    expect([...found.show].sort()).toEqual(["projects/study/_project.md", "projects/study/roadmap.canvas"]);
    expect([...found.open]).toEqual(["projects/study/_project.md"]);
  });

  it("stays fast over ten thousand titles", () => {
    const notes: NoteMeta[] = Array.from({ length: 10_000 }, (_, i) => note(`library/Page number ${i}.md`));
    // The first keystroke lower-cases the titles once.
    matchTree(notes, "p");
    const start = performance.now();
    const found = matchTree(notes, "number 99")!;
    const took = performance.now() - start;
    expect(found.show.size).toBe(111);
    // About 2 ms on a desk machine; the bound leaves room for a slow runner.
    expect(took).toBeLessThan(25);
  });
});

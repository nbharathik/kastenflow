import { describe, expect, it } from "vitest";

import type { NoteMeta } from "../../lib/vault/types";
import { ancestors, build, childrenOf, findByTitle, holders, inboxCards, inOtherFolder, isWithin, journalDays, loosePages, noteFolders, openable, projectNotes, projects, templates, treeOf } from "./tree";

function note(path: string, extra: Partial<NoteMeta> = {}): NoteMeta {
  const parts = path.split("/");
  const project = parts[0] === "projects" ? parts[1]! : null;
  const kind = path.startsWith("templates/") ? "template" : path.startsWith("journal/") ? "journal" : path.endsWith("_project.md") ? "project" : path.includes("/cards/") || path.startsWith("inbox/") ? "card" : "page";
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
  note("inbox/a.md", { modified: 1 }),
  note("inbox/b.md", { modified: 2 }),
  note("journal/2026/2026-09-01.md", { title: "2026-09-01" }),
  note("journal/2026/2026-09-02.md", { title: "2026-09-02" }),
  note("library/zeta.md", { id: "z" }),
  note("library/alpha.md", { id: "a" }),
  note("library/child.md", { id: "c", parent: "a" }),
  note("library/grandchild.md", { id: "g", parent: "c" }),
  note("library/orphan.md", { parent: "gone" }),
  note("projects/study/_project.md", { title: "Note-taking study", id: "p" }),
  note("projects/study/pages/Draft 10.md", { id: "d10" }),
  note("projects/study/pages/Draft 2.md", { id: "d2" }),
  note("projects/study/pages/sub.md", { parent: "d2" }),
  note("projects/study/cards/card.md"),
  note("templates/paper.md"),
];

describe("tree", () => {
  it("shows a page made under a journal day or a card as a page of its own", () => {
    const day = note("journal/2026/2026-09-03.md", { id: "day", title: "2026-09-03" });
    const card = note("inbox/idea.md", { id: "card" });
    const notes = [
      ...vault(),
      day,
      card,
      note("journal/2026/linked-from-a-day.md", { kind: "page", parent: "day", title: "Linked from a day" }),
      note("library/from-a-card.md", { parent: "card", title: "From a card" }),
      note("library/its-own-parent.md", { id: "self", parent: "self", title: "Its own parent" }),
    ];
    expect(loosePages(notes).map((n) => n.title)).toEqual(["alpha", "From a card", "Its own parent", "Linked from a day", "orphan", "zeta"]);
    expect(childrenOf(notes, day)).toEqual([]);
    expect(childrenOf(notes, card)).toEqual([]);
  });

  it("groups notes the way the sidebar shows them", () => {
    const notes = vault();
    expect(loosePages(notes).map((n) => n.title)).toEqual(["alpha", "orphan", "zeta"]);
    expect(childrenOf(notes, notes[5]!).map((n) => n.title)).toEqual(["child"]);
    expect(childrenOf(notes, notes[4]!)).toEqual([]);
    const study = projects(notes)[0]!;
    // Numbers sort by value; pages come before cards; sub-pages stay under their parent.
    expect(projectNotes(notes, study).map((n) => n.title)).toEqual(["Draft 2", "Draft 10", "card"]);
    expect(inboxCards(notes).map((n) => n.title)).toEqual(["b", "a"]);
    expect(journalDays(notes).map((n) => n.title)).toEqual(["2026-09-02", "2026-09-01"]);
    expect(templates(notes).map((n) => n.path)).toEqual(["templates/paper.md"]);
    expect(openable(notes)).toHaveLength(notes.length - 1);
  });

  it("finds titles, parents and what holds the open page", () => {
    const notes = vault();
    expect(findByTitle(notes, "  NOTE-TAKING STUDY ")?.path).toBe("projects/study/_project.md");
    expect(findByTitle(notes, "paper")).toBeUndefined();
    const grandchild = notes[7]!;
    expect(ancestors(notes, grandchild).map((n) => n.title)).toEqual(["alpha", "child"]);
    expect(isWithin(notes, grandchild.path, notes[5]!)).toBe(true);
    expect(isWithin(notes, grandchild.path, notes[4]!)).toBe(false);
    expect([...holders(notes, "projects/study/pages/sub.md")].sort()).toEqual(["projects/study/_project.md", "projects/study/pages/Draft 2.md"]);
    expect(holders(notes, undefined).size).toBe(0);
  });

  it("builds once per notes array and keeps unchanged lists", () => {
    const notes = vault();
    const first = treeOf(notes);
    expect(treeOf(notes)).toBe(first);
    // Saving one inbox card changes that list, not the others.
    const next = notes.map((n) => (n.path === "inbox/a.md" ? { ...n, modified: 3 } : n));
    const second = treeOf(next);
    expect(second).not.toBe(first);
    expect(second.loose).toBe(first.loose);
    expect(second.projectPages.get("study")).toBe(first.projectPages.get("study"));
    expect(second.children.get("a")).toBe(first.children.get("a"));
    expect(second.inbox).not.toBe(first.inbox);
    expect(second.inbox.map((n) => n.title)).toEqual(["a", "b"]);
  });

  it("patches the index when saves change only text, matching a rebuild", () => {
    const notes = vault();
    const first = treeOf(notes);
    const next = notes.map((n) =>
      n.path === "library/child.md" || n.path === "inbox/a.md" || n.path === "projects/study/pages/Draft 2.md" ? { ...n, excerpt: "new", modified: 9 } : n,
    );
    const patched = treeOf(next);
    expect(patched).toEqual(build(next));
    expect(patched.loose).toBe(first.loose);
    expect(patched.children.get("a")).not.toBe(first.children.get("a"));
    expect(patched.inbox.map((n) => n.title)).toEqual(["a", "b"]);
    expect(childrenOf(next, next[5]!)[0]!.excerpt).toBe("new");
    expect(projectNotes(next, projects(next)[0]!)[0]!.excerpt).toBe("new");
    // A new title moves rows, so the index is rebuilt.
    const renamed = next.map((n) => (n.path === "library/zeta.md" ? { ...n, title: "aardvark" } : n));
    expect(loosePages(renamed).map((n) => n.title)).toEqual(["aardvark", "alpha", "orphan"]);
    expect(treeOf(renamed)).toEqual(build(renamed));
  });

  it("keeps notes in other folders in their folders, as an Obsidian vault has them", () => {
    const notes = [
      note("Welcome.md"),
      note("library/zeta.md"),
      note("Areas/Work.md"),
      note("Areas/Health/Sleep.md"),
      note("Areas/Health/Food.md"),
      note("Daily/2026-09-25.md"),
      note("Daily/sub.md", { parent: "x" }),
      note("Daily/x.md", { id: "x", title: "Parent" }),
    ];
    expect(["Areas/Work.md", "Welcome.md", "library/zeta.md", "projects/p/a.md", ".obsidian/x.md"].map(inOtherFolder)).toEqual([true, false, false, false, false]);
    // A note at the top of the vault is a page; notes in folders stay there.
    expect(loosePages(notes).map((n) => n.path)).toEqual(["Welcome.md", "library/zeta.md"]);
    const root = noteFolders(notes);
    expect(root.count).toBe(5);
    const shape = (node: typeof root): unknown => ({ name: node.name, notes: node.notes.map((n) => n.title), folders: node.folders.map(shape) });
    expect(root.folders.map(shape)).toEqual([
      { name: "Areas", notes: ["Work"], folders: [{ name: "Health", notes: ["Food", "Sleep"], folders: [] }] },
      // A sub-page stays under its parent, not beside it.
      { name: "Daily", notes: ["2026-09-25", "Parent"], folders: [] },
    ]);
    expect(root.folders[0]!.count).toBe(3);

    // A save while typing swaps the note in its folder, as a rebuild would.
    const saved = notes.map((n) => (n.path === "Areas/Health/Sleep.md" ? { ...n, excerpt: "Eight hours." } : n));
    treeOf(notes);
    const patched = noteFolders(saved);
    expect(patched.folders[0]!.folders[0]!.notes.find((n) => n.title === "Sleep")?.excerpt).toBe("Eight hours.");
    expect(patched).toEqual(build(saved).folders);
    // A vault in Kasten's own format has no such folders.
    expect(noteFolders(vault()).count).toBe(0);
  });

  it("stays quick on 10,000 notes", () => {
    const notes: NoteMeta[] = [];
    for (let i = 0; i < 10_000; i++) {
      const slot = i % 10;
      const dir = slot === 0 ? "inbox" : slot === 1 ? "library" : `projects/p${i % 20}/${slot <= 6 ? "pages" : "cards"}`;
      notes.push(note(`${dir}/n${i}.md`, { id: `n${i}`, title: `note ${i}`, parent: i % 7 === 0 && i > 20 ? `n${i - 20}` : null, modified: i }));
    }
    const t = performance.now();
    treeOf(notes);
    const built = performance.now() - t;
    // Generous for slow CI machines; about 10 ms on a laptop.
    expect(built).toBeLessThan(250);
    const again = performance.now();
    for (const n of notes.slice(0, 1000)) childrenOf(notes, n);
    // About 10 ms on a laptop; a shared CI machine took 22 ms. Something that grows with the square of the notes would take seconds.
    expect(performance.now() - again).toBeLessThan(100);
  });
});

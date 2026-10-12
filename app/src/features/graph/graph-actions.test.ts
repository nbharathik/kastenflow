import { beforeEach, describe, expect, it } from "vitest";

import type { GraphNode } from "../../lib/vault/types";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { usePrefs } from "../workspace/prefs";
import { useWorkspace } from "../workspace/store";
import { derive } from "../workspace/store-layout";
import { initialLayout } from "../workspace/tabs";
import { ghostTitle, howToOpen, makeLinkedPage, makePage, openNode, plainOpens, projectForGhost } from "./graph-actions";

const SEED = {
  "library/a.md": "---\ntitle: Alpha\n---\nSee [[Not written yet]].\n",
  "projects/trip/pages/plan.md": "---\ntitle: Plan\n---\nAlso [[Not written yet]].\n",
  "projects/trip/boards/map.canvas": JSON.stringify({ nodes: [], edges: [] }),
};

const state = () => useWorkspace.getState();
const keys = (over: Partial<Record<"ctrlKey" | "metaKey" | "shiftKey" | "altKey", boolean>> = {}) => ({ ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, button: 0, ...over });
const node = (over: Partial<GraphNode>): GraphNode => ({ id: "x", path: "x", title: "x", kind: "page", project: null, links: 0, ...over });

beforeEach(async () => {
  localStorage.clear();
  usePrefs.setState({ newTabs: false, peekMode: "center", rightReplaces: true });
  useWorkspace.setState({ ...derive(initialLayout()), stack: [], stackOpen: false, recent: [], toasts: [] });
  await state().connect({ client: new MemoryVault(SEED) });
});

describe("where a click on the graph opens", () => {
  it("opens to the right by default, or the way Settings opens links when that is not the same tab", () => {
    expect(plainOpens("auto", "here")).toBe("right");
    expect(plainOpens("auto", "tab")).toBe("tab");
    expect(plainOpens("auto", "peek-side")).toBe("peek-side");
    expect(plainOpens("here", "tab")).toBe("here");
    expect(plainOpens("stack", "here")).toBe("stack");
  });

  it("lets a key say where: Ctrl a tab, Alt a split, Shift the stack, Ctrl and Alt the pane to the right", () => {
    expect(howToOpen(keys(), "auto", "here")).toBe("right");
    expect(howToOpen(keys(), "here", "here")).toBe("here");
    expect(howToOpen(keys({ ctrlKey: true }), "auto", "here")).toBe("tab");
    expect(howToOpen(keys({ metaKey: true }), "auto", "here")).toBe("tab");
    expect(howToOpen(keys({ altKey: true }), "auto", "here")).toBe("split");
    expect(howToOpen(keys({ shiftKey: true }), "auto", "here")).toBe("stack");
    expect(howToOpen(keys({ ctrlKey: true, altKey: true }), "auto", "here")).toBe("right");
    expect(howToOpen({ ...keys(), button: 1 }, "auto", "here")).toBe("tab");
  });
});

describe("opening what a node stands for", () => {
  it("opens a page to the right", async () => {
    await openNode(node({ path: "library/a.md", id: "library/a.md" }), "right");
    expect(state().layout.panes).toHaveLength(2);
    expect(state().place.path).toBe("library/a.md");
  });

  it("opens a whiteboard in the boards view", async () => {
    await openNode(node({ path: "projects/trip/boards/map.canvas", kind: "board" }), "here");
    expect(state().place).toMatchObject({ view: "boards", path: "projects/trip/boards/map.canvas" });
  });

  it("makes the page a ghost stands for, in the project of the pages that link it, and opens it", async () => {
    expect(ghostTitle("not written yet")).toBe("Not written yet");
    const linking = [node({ project: null }), node({ project: "trip" })];
    expect(projectForGhost(linking, "other")).toBe("trip");
    expect(projectForGhost([undefined, node({ project: null })], "other")).toBe("other");
    expect(projectForGhost([], null)).toBeNull();
    await openNode(node({ id: "ghost:not written yet", path: null, title: "not written yet", kind: "ghost" }), "right", "trip");
    const made = state().notes.find((n) => n.title === "Not written yet")!;
    expect(made.path.startsWith("projects/trip/")).toBe(true);
    expect(state().place.path).toBe(made.path);
    // The gap is filled: nothing is missing any more.
    const graph = await state().client!.graph({ kind: "vault" });
    expect(graph.nodes.some((n) => n.kind === "ghost")).toBe(false);
  });
});

describe("making pages from the graph", () => {
  it("makes an empty page where the double click was, in the project asked for", async () => {
    const made = await makePage("trip");
    expect(made!.meta.title).toBe("Untitled");
    expect(made!.meta.path.startsWith("projects/trip/")).toBe(true);
    expect((await makePage(null))!.meta.path.startsWith("library/")).toBe(true);
  });

  it("makes a page linked from the one a drag started on, and the graph shows the link", async () => {
    const made = await makeLinkedPage(node({ id: "library/a.md", path: "library/a.md", title: "Alpha" }), null);
    expect(made).not.toBeNull();
    const text = (await state().client!.read("library/a.md")).text;
    expect(text).toContain("[[Untitled]]");
    const second = await makeLinkedPage(node({ id: "library/a.md", path: "library/a.md", title: "Alpha" }), null);
    // The second page shares the title, so its link names its path and goes to it alone.
    expect((await state().client!.read("library/a.md")).text).toContain(`[[${second!.meta.path.replace(/\.md$/, "")}|Untitled]]`);
    const graph = await state().client!.graph({ kind: "vault" });
    const from = graph.nodes.findIndex((n) => n.id === "library/a.md");
    const to = graph.edges.filter((e) => e.from === from).map((e) => graph.nodes[e.to]!.id);
    expect(to).toContain(made!.meta.path);
    expect(to).toContain(second!.meta.path);
    expect(graph.edges.filter((e) => e.from === from && e.ambiguous)).toEqual([]);
  });

  it("makes the new page in the page's own project", async () => {
    const made = await makeLinkedPage(node({ id: "projects/trip/pages/plan.md", path: "projects/trip/pages/plan.md", title: "Plan", project: "trip" }), null);
    expect(made!.meta.path.startsWith("projects/trip/")).toBe(true);
  });

  it("only links from a page: not from a missing page, a whiteboard or a deck", async () => {
    for (const source of [node({ kind: "ghost", path: null, id: "ghost:x" }), node({ kind: "board", path: "projects/trip/boards/map.canvas" })]) {
      const before = state().notes.length;
      expect(await makeLinkedPage(source, null)).toBeNull();
      expect(state().notes).toHaveLength(before);
    }
    expect(state().toasts.at(-1)?.text).toContain("Only a page can link");
  });
});

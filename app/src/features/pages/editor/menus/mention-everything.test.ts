// `@` lists more than days: people, pages, whiteboards, decks and tags.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTestEditor } from "../../../../test/editor";
import type { LinkProvider } from "../links";

const links: LinkProvider = {
  weekStart: () => 1,
  pages: () => [
    { title: "Sam Taylor", path: "people/sam.md", icon: "🧑" },
    { title: "Samples of the roadmap", path: "notes/samples.md" },
    { title: "Photo organiser roadmap", path: "notes/roadmap.md" },
    { title: "Pricing talk notes", path: "notes/pricing.md" },
  ],
  people: () => [{ title: "Sam Taylor", path: "people/sam.md", icon: "🧑" }, { title: "Priya Rao", path: "people/priya.md" }],
  boards: () => [{ path: "boards/pricing-map.canvas", title: "Pricing map", hint: "Photo organiser" }],
  decks: () => [{ path: "projects/photo/pricing-talk.deck", title: "Pricing talk", hint: "Photo organiser" }],
  databases: () => [
    { tag: "pricing", path: "tags/pricing.yaml", count: 3 },
    { tag: "paper", path: "tags/paper.yaml", count: 1 },
  ],
  open: vi.fn(),
  create: vi.fn(),
};
const editor = useTestEditor({ links });
const menu = () => document.querySelector<HTMLElement>(".kasten-menu");
const keys = () => [...(menu()?.querySelectorAll<HTMLElement>(".kasten-menu-item") ?? [])].map((row) => row.dataset.key);
const titles = () => [...(menu()?.querySelectorAll<HTMLElement>(".kasten-menu-title") ?? [])].map((row) => row.textContent);

beforeEach(() => void vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 7, 10, 30) }));
afterEach(() => {
  editor.press("Escape");
  vi.useRealTimers();
});

describe("@ for people", () => {
  it("lists people before pages, once each", () => {
    editor.open("- [ ] Call Sam\n").caret("Call Sam", true);
    editor.type(" @sam");
    expect(titles()).toEqual(["People", "Link to page"]);
    expect(keys()).toEqual(["page:people/sam.md", "page:notes/samples.md"]);
  });

  it("links the person and goes on to a date in a to-do", () => {
    editor.open("- [ ] Call\n").caret("Call", true);
    editor.type(" @pri");
    editor.press("Enter");
    editor.type("@friday");
    editor.press("Enter");
    expect(editor.save()).toBe("- [ ] Call [[Priya Rao]] [[2026-10-09]]\n");
  });
});

describe("@ for whiteboards, decks and tags", () => {
  it("keeps a bare @ short", () => {
    editor.open("x\n").caret("x", true);
    editor.type(" @");
    expect(titles()).toEqual(["Date", "People", "Link to page"]);
    expect(keys().some((key) => key?.startsWith("board:") || key?.startsWith("deck:") || key?.startsWith("tag:"))).toBe(false);
  });

  it("lists each kind that matches", () => {
    editor.open("x\n").caret("x", true);
    editor.type(" @pric");
    expect(titles()).toEqual(["Link to page", "Whiteboards", "Decks", "Tags"]);
    expect(keys()).toEqual(["page:notes/pricing.md", "board:boards/pricing-map.canvas", "deck:projects/photo/pricing-talk.deck", "tag:tags/pricing.yaml"]);
  });

  it("links a whiteboard by its path", () => {
    editor.open("x\n").caret("x", true);
    editor.type(" @pricing map");
    editor.press("Enter");
    expect(editor.save()).toBe("x [[boards/pricing-map.canvas]]\n");
  });

  it("links a deck by its path", () => {
    editor.open("x\n").caret("x", true);
    editor.type(" @pricing talk");
    editor.press("ArrowDown");
    editor.press("Enter");
    expect(editor.save()).toBe("x [[projects/photo/pricing-talk.deck]]\n");
  });

  it("references a tag's page, not the page's own tags", () => {
    editor.open("x\n").caret("x", true);
    editor.type(" @#pap");
    expect(keys()).toEqual(["tag:tags/paper.yaml"]);
    editor.press("Enter");
    expect(editor.save()).toBe("x [[tags/paper.yaml|#paper]]\n");
  });
});

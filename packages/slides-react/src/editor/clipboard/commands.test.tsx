// The Edit menu and the right-click menus: Cut, Copy and Paste run through the browser's asynchronous clipboard, on the slides when the
// focus was in the filmstrip or the grid and on the blocks otherwise, and what they write another deck's paste reads back.

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runCommand } from "../commands/index.ts";
import { shape } from "../factory.ts";
import { idsOf, openDeck } from "../filmstrip/test-support.ts";
import { Workspace } from "../SlidesEditor.tsx";
import { forget } from "./store.ts";

/** A clipboard that keeps what is written, and one item at a time. */
function stubClipboard() {
  const kept: { types: string[]; blobs: Map<string, Blob> }[] = [];
  class Item {
    readonly blobs: Map<string, Blob>;
    constructor(items: Record<string, Blob>) {
      this.blobs = new Map(Object.entries(items));
    }
    get types() {
      return [...this.blobs.keys()];
    }
    async getType(type: string) {
      return this.blobs.get(type)!;
    }
  }
  vi.stubGlobal("ClipboardItem", Item);
  vi.stubGlobal("navigator", {
    clipboard: {
      write: async (items: Item[]) => void (kept.length = 0, kept.push(...items.map((item) => ({ types: item.types, blobs: item.blobs })))),
      read: async () => kept.map((item) => new Item(Object.fromEntries(item.blobs))),
      writeText: async (text: string) => void (kept.length = 0, kept.push({ types: ["text/plain"], blobs: new Map([["text/plain", new Blob([text])]]) })),
      readText: async () => (await kept[0]?.blobs.get("text/plain")?.text()) ?? "",
    },
  });
  return kept;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(forget);

async function open() {
  const made = await openDeck({ slides: 4 });
  const { session } = made;
  const [a] = session.elements.insert([shape("rect", { x: 100, y: 100, w: 200, h: 100 })]) as [string];
  session.select([]);
  const view = render(<Workspace session={session} ui={made.ui} />);
  return { ...made, view, a, ctx: { session, ui: made.ui } };
}

describe("Copy and Paste from a menu", () => {
  it("copy writes the HTML that carries the blocks and their words, and paste reads it back, 16 down and right", async () => {
    const kept = stubClipboard();
    const { session, a, ctx, view } = await open();
    view.container.querySelector<HTMLElement>(".ks-stage")!.focus();
    act(() => session.select([a]));
    await act(async () => runCommand("edit.copy", ctx));
    expect(kept[0]!.types).toEqual(["text/html", "text/plain"]);
    expect(await kept[0]!.blobs.get("text/html")!.text()).toContain("data-kasten-slides=");
    await act(async () => runCommand("edit.paste", ctx));
    const [made] = session.state.selection as [string];
    const box = session.slide.elements.find((e) => e.id === made)!;
    expect([box.x, box.y]).toEqual([116, 116]);
  });

  it("paste in place puts them where they were", async () => {
    stubClipboard();
    const { session, a, ctx, view } = await open();
    view.container.querySelector<HTMLElement>(".ks-stage")!.focus();
    act(() => session.select([a]));
    await act(async () => runCommand("edit.copy", ctx));
    await act(async () => runCommand("edit.paste-in-place", ctx));
    const [made] = session.state.selection as [string];
    const box = session.slide.elements.find((e) => e.id === made)!;
    expect([box.x, box.y]).toEqual([100, 100]);
  });

  it("cut removes what it copies, and paste puts it back where it was", async () => {
    stubClipboard();
    const { session, a, ctx, view } = await open();
    view.container.querySelector<HTMLElement>(".ks-stage")!.focus();
    act(() => session.select([a]));
    await act(async () => runCommand("edit.cut", ctx));
    expect(session.slide.elements.some((e) => e.id === a)).toBe(false);
    await act(async () => runCommand("edit.paste", ctx));
    const [made] = session.state.selection as [string];
    const box = session.slide.elements.find((e) => e.id === made)!;
    expect([box.x, box.y]).toEqual([100, 100]);
  });

  it("on the slides when the focus was in the filmstrip: copy, then paste after the slide picked", async () => {
    stubClipboard();
    const { session, ctx } = await open();
    const ids = idsOf(session);
    act(() => session.selectSlides([ids[0]!, ids[1]!]));
    const list = screen.getByRole("listbox", { name: "Slides" });
    list.focus();
    await act(async () => runCommand("edit.copy", ctx));
    act(() => session.selectSlides([ids[2]!]));
    list.focus();
    await act(async () => runCommand("edit.paste", ctx));
    expect(session.deck.slides).toHaveLength(ids.length + 2);
    expect(idsOf(session).slice(0, 3)).toEqual(ids.slice(0, 3));
  });

  it("duplicates and deletes slides, not blocks, when the focus was in the filmstrip", async () => {
    stubClipboard();
    const { session, ctx, a } = await open();
    const ids = idsOf(session);
    act(() => session.select([a]));
    act(() => session.selectSlides([ids[1]!]));
    const list = screen.getByRole("listbox", { name: "Slides" });
    list.focus();
    await act(async () => runCommand("edit.duplicate", ctx));
    expect(session.deck.slides).toHaveLength(ids.length + 1);
    await act(async () => runCommand("edit.delete", ctx));
    expect(session.deck.slides).toHaveLength(ids.length);
  });
});

describe("what a menu cannot read", () => {
  it("pastes what this window last copied when the clipboard cannot be read", async () => {
    vi.stubGlobal("navigator", { clipboard: { write: async () => {}, writeText: async () => {}, read: async () => Promise.reject(new Error("denied")), readText: async () => Promise.reject(new Error("denied")) } });
    const { session, a, ctx, view } = await open();
    view.container.querySelector<HTMLElement>(".ks-stage")!.focus();
    act(() => session.select([a]));
    await act(async () => runCommand("edit.copy", ctx));
    const before = session.slide.elements.length;
    await act(async () => runCommand("edit.paste", ctx));
    expect(session.slide.elements).toHaveLength(before + 1);
  });

  it("pastes words that were copied elsewhere as a text box, and nothing when the clipboard is empty", async () => {
    const kept = stubClipboard();
    const { session, ctx } = await open();
    kept.push({ types: ["text/plain"], blobs: new Map([["text/plain", new Blob(["From another program"])]]) });
    await act(async () => runCommand("edit.paste", ctx));
    const [made] = session.state.selection as [string];
    expect(session.slide.elements.find((e) => e.id === made)?.type).toBe("text");
    kept.length = 0;
    const count = session.slide.elements.length;
    await act(async () => runCommand("edit.paste", ctx));
    // Nothing on the clipboard and nothing copied in this window: nothing is pasted.
    expect(session.slide.elements).toHaveLength(count);
  });
});

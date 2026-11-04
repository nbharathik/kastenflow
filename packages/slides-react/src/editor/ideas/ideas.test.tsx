import type { Element, Layout } from "@kasten-slides/wasm";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { MemoryHost } from "../memory-host.ts";
import { EditorSession } from "../session/session.ts";
import { EditorUi } from "../ui-state.ts";
import { applyIdea, insertBlock } from "./apply.ts";
import { BLOCKS } from "./blocks.ts";
import { contentOf } from "./content.ts";
import { describeLayout, designIdeas } from "./ideas.ts";
import { IdeasPanel } from "./IdeasPanel.tsx";

afterEach(cleanup);

async function open() {
  return new EditorSession(await newDeck("Ideas", "Light"), new MemoryHost(), { saveDelay: 60_000, onError: () => {} });
}

const photo = { type: "image", id: "", src: "assets/photo.png", x: 100, y: 200, w: 300, h: 200 } as Element;

/** A slide with a title and a body from the layout, and a picture of its own. */
async function withPicture() {
  const session = await open();
  session.slides.add({ layout: "title-body", content: { title: "Our results", body: "- first\n- second" } });
  session.elements.insert([photo]);
  return session;
}

describe("what a slide holds", () => {
  it("tells a title, bodies and pictures apart, and counts an empty slot as nothing", async () => {
    const session = await withPicture();
    const content = contentOf(session.slide);
    expect(content.title?.placeholder).toBe("title");
    expect(content.bodies).toHaveLength(1);
    expect(content.pictures).toHaveLength(1);
    expect(content.usedRoles.sort()).toEqual(["body", "title"]);
    const blank = await open();
    blank.slides.add({ layout: "title-body" });
    expect(contentOf(blank.slide).usedRoles).toEqual([]);
  });
});

describe("design ideas", () => {
  it("offers none for a slide with nothing on it", async () => {
    const session = await open();
    session.slides.add({ layout: "blank" });
    expect(designIdeas(session.deck, session.slide)).toEqual([]);
  });

  it("offers the picture on either side, or full-bleed, for a title, words and a picture, and no more than six", async () => {
    const session = await withPicture();
    const ideas = designIdeas(session.deck, session.slide);
    const ids = ideas.map((idea) => idea.id);
    expect(ids).toEqual(expect.arrayContaining(["arrange:picture-right", "arrange:picture-left", "arrange:full-bleed"]));
    expect(ideas.length).toBeGreaterThanOrEqual(3);
    expect(ideas.length).toBeLessThanOrEqual(6);
    expect(new Set(ideas.map((idea) => idea.label)).size).toBe(ideas.length);
    // The same slide gives the same ideas.
    expect(designIdeas(session.deck, session.slide).map((idea) => idea.id)).toEqual(ids);
    const right = ideas.find((idea) => idea.id === "arrange:picture-right");
    const shown = right?.preview.elements.find((element) => element.type === "image");
    const { w, h } = session.deck.size;
    expect(shown?.type === "image" && [shown.x, shown.y, shown.h]).toEqual([w - Math.round(w * 0.42), 0, h]);
  });

  it("offers layouts that have a slot for everything the slide holds, never the one it has", async () => {
    const session = await open();
    session.slides.add({ layout: "title-body", content: { title: "Hello", body: "Words" } });
    const ideas = designIdeas(session.deck, session.slide);
    const layouts = ideas.filter((idea) => idea.id.startsWith("layout:"));
    expect(layouts.length).toBeGreaterThan(0);
    for (const idea of layouts) {
      const name = idea.id.slice("layout:".length);
      expect(name).not.toBe("title-body");
      const layout = session.deck.theme.layouts.find((candidate) => candidate.name === name) as Layout;
      expect(layout.placeholders.map((slot) => slot.role)).toEqual(expect.arrayContaining(["title", "body"]));
      expect(idea.preview.layout).toBe(name);
    }
  });

  it("does an idea as one step of undo, and undo puts the slide back exactly", async () => {
    const session = await withPicture();
    const before = JSON.stringify(session.slide.elements);
    const steps = session.stepLog.length;
    const idea = designIdeas(session.deck, session.slide).find((candidate) => candidate.id === "arrange:full-bleed");
    expect(idea).toBeDefined();
    expect(applyIdea(session, idea as NonNullable<typeof idea>)).toBe(true);
    expect(session.stepLog.length).toBe(steps + 1);
    const elements = session.slide.elements;
    // The picture is at the back and fills the slide, with a veil over it.
    expect(elements[0]?.type).toBe("image");
    expect(elements[1]?.type).toBe("shape");
    const { w, h } = session.deck.size;
    expect(elements[0]).toMatchObject({ x: 0, y: 0, w, h });
    session.undo();
    expect(JSON.stringify(session.slide.elements)).toBe(before);
  });

  it("moves the layout in one step when a layout idea is chosen", async () => {
    const session = await open();
    session.slides.add({ layout: "title-body", content: { title: "Hello", body: "Words" } });
    const idea = designIdeas(session.deck, session.slide).find((candidate) => candidate.id.startsWith("layout:"));
    expect(idea).toBeDefined();
    applyIdea(session, idea as NonNullable<typeof idea>);
    expect(session.slide.layout).toBe(idea?.id.slice("layout:".length));
    session.undo();
    expect(session.slide.layout).toBe("title-body");
  });

  it("describes a layout by where its picture and columns are", () => {
    const size = { w: 960, h: 540 };
    const slot = (role: string, kind: string, x: number, w: number, h = 300) => ({ role, kind, x, y: 100, w, h, prompt: "" });
    const layout = (placeholders: ReturnType<typeof slot>[]) => ({ name: "x", label: "X", placeholders }) as unknown as Layout;
    expect(describeLayout(layout([slot("image", "image", 0, 400)]), size)).toBe("Picture left");
    expect(describeLayout(layout([slot("image", "image", 500, 400)]), size)).toBe("Picture right");
    expect(describeLayout(layout([slot("image", "image", 0, 960, 540)]), size)).toBe("Full-bleed picture");
    expect(describeLayout(layout([slot("body", "text", 0, 400), slot("body2", "text", 500, 400)]), size)).toBe("Two columns");
    expect(describeLayout(layout([slot("number", "text", 0, 400)]), size)).toBe("Big number");
  });
});

describe("ready-made blocks", () => {
  it("drops each block on the slide as one group, in theme colours, selected, as one step of undo", async () => {
    for (const block of BLOCKS) {
      const session = await open();
      session.slides.add({ layout: "blank" });
      const steps = session.stepLog.length;
      const id = insertBlock(session, block.kind);
      expect(id, block.kind).toBeDefined();
      const [group] = session.slide.elements;
      expect(group?.type, block.kind).toBe("group");
      expect(group?.type === "group" && group.children.length, block.kind).toBeGreaterThan(1);
      expect(group?.name).toBe(block.label);
      expect(session.state.selection).toEqual([id]);
      expect(session.stepLog.length).toBe(steps + 1);
      // Colours are the theme's own names, so the block follows a change of theme.
      expect(JSON.stringify(group)).not.toMatch(/#[0-9a-fA-F]{3,6}/);
      // Everything stays on the slide.
      const { w, h } = session.deck.size;
      if (group?.type === "group") {
        for (const child of group.children) {
          expect(child.x ?? 0, block.kind).toBeGreaterThanOrEqual(0);
          expect((child.x ?? 0) + (child.w ?? 0), block.kind).toBeLessThanOrEqual(w + 1);
          expect((child.y ?? 0) + (child.h ?? 0), block.kind).toBeLessThanOrEqual(h + 1);
        }
      }
      session.undo();
      expect(session.slide.elements, block.kind).toHaveLength(0);
    }
  });

  it("puts a second block of the same kind in another place", async () => {
    const session = await open();
    session.slides.add({ layout: "blank" });
    insertBlock(session, "key-number");
    insertBlock(session, "key-number");
    expect(session.slide.elements).toHaveLength(2);
  });
});

describe("the panel", () => {
  it("shows the ideas as options with their names, applies one on a click, and lists the blocks", async () => {
    const session = await withPicture();
    render(<IdeasPanel session={session} ui={new EditorUi()} />);
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.getAttribute("aria-label"))).toContain("Picture right");
    for (const block of BLOCKS) expect(screen.getByRole("button", { name: new RegExp(`^${block.label}`) })).toBeTruthy();
    const steps = session.stepLog.length;
    fireEvent.click(screen.getByRole("option", { name: "Picture right" }));
    expect(session.stepLog.length).toBe(steps + 1);
    const image = session.slide.elements.find((element) => element.type === "image");
    expect(image).toMatchObject({ y: 0 });
  });

  it("says what to do on a slide with nothing on it, and still offers the blocks", async () => {
    const session = await open();
    session.slides.add({ layout: "blank" });
    render(<IdeasPanel session={session} ui={new EditorUi()} />);
    expect(screen.getByText(/Nothing to rearrange yet/)).toBeTruthy();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    act(() => void fireEvent.click(screen.getByRole("button", { name: /^Agenda/ })));
    expect(session.slide.elements).toHaveLength(1);
  });
});

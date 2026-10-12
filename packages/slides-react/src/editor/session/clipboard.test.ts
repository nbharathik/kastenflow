// Copying, cutting, pasting and duplicating blocks on a slide: where the copies land, what is selected after, and that each is one step of undo.

import { beforeEach, describe, expect, it } from "vitest";

import { forget } from "../clipboard/store.ts";
import { shape, textBox } from "../factory.ts";
import { openDeck } from "../filmstrip/test-support.ts";
import { STEP } from "./clipboard.ts";

beforeEach(forget);

async function open() {
  const made = await openDeck({ slides: 2 });
  // A blank slide to work on, and another to paste onto.
  const { session } = made;
  session.slides.add({ layout: "blank" });
  const work = session.state.slideId;
  const other = session.slides.add({ layout: "blank" })!;
  session.goTo(work);
  const [a, b] = session.elements.insert([shape("rect", { x: 100, y: 100, w: 200, h: 100 }), textBox({ x: 400, y: 300, w: 300, h: 60 }, "Words")]) as [string, string];
  session.select([]);
  const at = (id: string) => session.slide.elements.find((e) => e.id === id)!;
  return { ...made, work, other, a, b, at };
}

describe("copying and pasting", () => {
  it("is 16 units, down and right, on the slide the blocks came from, and each paste of the same copy 16 further", async () => {
    const { session, a, at } = await open();
    expect(STEP).toBe(16);
    session.select([a]);
    const clip = session.clipboard.copy()!;
    const [one] = session.clipboard.pasteElements(clip);
    const [two] = session.clipboard.pasteElements(clip);
    expect([at(one!).x, at(one!).y]).toEqual([116, 116]);
    expect([at(two!).x, at(two!).y]).toEqual([132, 132]);
    expect(session.state.selection).toEqual([two]);
  });

  it("lands where it was on another slide, and steps from there for each paste after the first", async () => {
    const { session, a, other, at } = await open();
    session.select([a]);
    const clip = session.clipboard.copy()!;
    session.goTo(other);
    const [one] = session.clipboard.pasteElements(clip);
    const [two] = session.clipboard.pasteElements(clip);
    expect([at(one!).x, at(one!).y]).toEqual([100, 100]);
    expect([at(two!).x, at(two!).y]).toEqual([116, 116]);
  });

  it("is a new copy each time it is copied: the steps start again", async () => {
    const { session, a, at } = await open();
    session.select([a]);
    session.clipboard.pasteElements(session.clipboard.copy()!);
    session.select([a]);
    const [again] = session.clipboard.pasteElements(session.clipboard.copy()!);
    expect([at(again!).x, at(again!).y]).toEqual([116, 116]);
  });

  it("keeps the place for Paste in place, every time, on any slide", async () => {
    const { session, a, other, at } = await open();
    session.select([a]);
    const clip = session.clipboard.copy()!;
    const [one] = session.clipboard.pasteElements(clip, { inPlace: true });
    const [two] = session.clipboard.pasteElements(clip, { inPlace: true });
    expect([at(one!).x, at(two!).x]).toEqual([100, 100]);
    session.goTo(other);
    const [three] = session.clipboard.pasteElements(clip, { inPlace: true });
    expect(at(three!).x).toBe(100);
  });

  it("puts a cut back exactly where it was, and steps from the second paste", async () => {
    const { session, a, at } = await open();
    session.select([a]);
    const clip = session.clipboard.cut()!;
    expect(session.slide.elements.find((e) => e.id === a)).toBeUndefined();
    const [one] = session.clipboard.pasteElements(clip);
    const [two] = session.clipboard.pasteElements(clip);
    expect([at(one!).x, at(one!).y]).toEqual([100, 100]);
    expect([at(two!).x, at(two!).y]).toEqual([116, 116]);
  });

  it("copies several blocks and pastes them together, selected, as one step of undo", async () => {
    const { session, a, b } = await open();
    session.select([a, b]);
    const clip = session.clipboard.copy()!;
    const before = session.slide.elements.length;
    const revision = session.state.revision;
    const ids = session.clipboard.pasteElements(clip);
    expect(ids).toHaveLength(2);
    expect(session.slide.elements).toHaveLength(before + 2);
    expect(session.state.selection).toEqual(ids);
    expect(session.state.revision).toBe(revision + 1);
    session.undo();
    expect(session.slide.elements).toHaveLength(before);
  });

  it("cuts as one step of undo too", async () => {
    const { session, a, b } = await open();
    session.select([a, b]);
    const before = session.slide.elements.length;
    session.clipboard.cut();
    expect(session.slide.elements).toHaveLength(before - 2);
    session.undo();
    expect(session.slide.elements).toHaveLength(before);
  });

  it("copies a group whole, and pastes a group of new blocks, selected", async () => {
    const { session, a, b } = await open();
    session.select([a, b]);
    session.elements.group();
    const [group] = session.state.selection as [string];
    const clip = session.clipboard.copy()!;
    expect(clip.elements).toHaveLength(1);
    expect(clip.elements[0]!.type).toBe("group");
    const [made] = session.clipboard.pasteElements(clip);
    const pasted = session.slide.elements.find((e) => e.id === made);
    expect(pasted?.type).toBe("group");
    expect(made).not.toBe(group);
    expect(session.state.selection).toEqual([made]);
    // The children are new blocks, not the first group's.
    const ids = (e: { type: string; children?: { id: string }[] } | undefined) => (e?.children ?? []).map((c) => c.id);
    const first = ids(session.slide.elements.find((e) => e.id === group) as never);
    const second = ids(pasted as never);
    expect(second).toHaveLength(2);
    expect(second.some((id) => first.includes(id))).toBe(false);
  });

  it("duplicates 16 units down and right, selects the copy, and repeats from the copy", async () => {
    const { session, a, at } = await open();
    session.select([a]);
    session.elements.duplicate();
    const [copy] = session.state.selection as [string];
    expect([at(copy).x, at(copy).y]).toEqual([116, 116]);
    session.elements.duplicate();
    const [again] = session.state.selection as [string];
    expect([at(again).x, at(again).y]).toEqual([132, 132]);
  });

  it("copies the box a block takes from its layout, and drops the slot, so it lands the same size on any slide", async () => {
    const { session } = await open();
    session.goTo(session.deck.slides[0]!.id);
    const title = session.slide.elements.find((e) => e.placeholder === "title")!;
    session.select([title.id]);
    const clip = session.clipboard.copy()!;
    expect(clip.elements[0]!.placeholder).toBeUndefined();
    expect(clip.elements[0]!.w).toBeGreaterThan(0);
  });
});

describe("pasting words", () => {
  it("makes a text box with the middle where it is asked, one paragraph to a line", async () => {
    const { session, at } = await open();
    const [id] = session.clipboard.pasteText("One\nTwo", { x: 480, y: 270 });
    const box = at(id!);
    expect(box.type).toBe("text");
    if (box.type !== "text") return;
    expect(box.text.paragraphs.map((p) => p.runs.map((r) => r.t).join(""))).toEqual(["One", "Two"]);
    expect(box.x! + box.w! / 2).toBeCloseTo(480, 0);
    expect(session.state.selection).toEqual([id]);
  });

  it("makes the box in the middle of the slide when it is not told where, and keeps it on the slide", async () => {
    const { session, at } = await open();
    const { w, h } = session.deck.size;
    const [middle] = session.clipboard.pasteText("Hello");
    expect(at(middle!).x! + at(middle!).w! / 2).toBeCloseTo(w / 2, 0);
    const [edge] = session.clipboard.pasteText("Hello", { x: w - 5, y: h - 5 });
    expect(at(edge!).x! + at(edge!).w!).toBeLessThanOrEqual(w);
    expect(at(edge!).y! + at(edge!).h!).toBeLessThanOrEqual(h);
  });

  it("takes plain text from the first versions' copy as blocks, and any other text as words", async () => {
    const { session, a } = await open();
    session.select([a]);
    const legacy = "kasten-slides:" + JSON.stringify({ v: 1, elements: [session.slide.elements.find((e) => e.id === a)] });
    const [block] = session.clipboard.paste(legacy);
    expect(session.slide.elements.find((e) => e.id === block)?.type).toBe("shape");
    const [words] = session.clipboard.paste("Just some words");
    expect(session.slide.elements.find((e) => e.id === words)?.type).toBe("text");
    expect(session.clipboard.paste("   ")).toEqual([]);
  });
});

// Copying, cutting and pasting slides: what a copy keeps (notes, the look, the sections), where the pasted slides go, into another deck
// too, and that each is one step of undo.

import { beforeEach, describe, expect, it } from "vitest";

import { boxOf } from "../../theme/index.ts";
import { type SlidesClip, decode, encode } from "../clipboard/format.ts";
import { forget } from "../clipboard/store.ts";
import { idsOf, openDeck } from "../filmstrip/test-support.ts";

beforeEach(forget);

describe("copying slides", () => {
  it("copies the slides picked in the filmstrip, in deck order, with their notes, flags and transition", async () => {
    const { session } = await openDeck({ slides: 5, hidden: [2] });
    const ids = idsOf(session);
    session.slides.setNotes("Say this first", ids[3]!);
    session.slides.setTransition({ kind: "fade", duration: 0.5 }, [ids[3]!]);
    session.selectSlides([ids[3]!, ids[1]!, ids[2]!], ids[1]);
    const clip = session.slideClipboard.copy()!;
    expect(clip.kind).toBe("slides");
    expect(clip.slides.map((s) => s.id)).toEqual([ids[1], ids[2], ids[3]]);
    expect(clip.slides[2]!.notes).toBe("Say this first");
    expect(clip.slides[2]!.transition).toMatchObject({ kind: "fade" });
    expect(clip.slides[1]!.hidden).toBe(true);
    // Copying changes nothing in the deck.
    expect(session.deck.slides).toHaveLength(5);
  });

  it("is JSON that comes back whole", async () => {
    const { session } = await openDeck({ slides: 3 });
    session.selectSlides(idsOf(session));
    const clip = session.slideClipboard.copy()!;
    expect(decode(encode(clip))).toEqual(clip);
  });
});

describe("pasting slides", () => {
  it("puts them after the last slide picked, in order, keeps their notes, selects them and shows the first", async () => {
    const { session } = await openDeck({ slides: 5 });
    const ids = idsOf(session);
    session.slides.setNotes("n1", ids[1]!);
    session.selectSlides([ids[1]!, ids[2]!]);
    const clip = session.slideClipboard.copy()!;
    session.selectSlides([ids[3]!]);
    const made = session.slideClipboard.paste(clip);
    expect(made).toHaveLength(2);
    expect(idsOf(session)).toEqual([ids[0], ids[1], ids[2], ids[3], made[0], made[1], ids[4]]);
    expect(session.deck.slides[4]!.notes).toBe("n1");
    expect(session.state.slideSelection).toEqual(made);
    expect(session.state.slideId).toBe(made[0]);
  });

  it("makes new slides of the copies, with the elements' ids kept (a copy edited a little is ready for Morph)", async () => {
    const { session } = await openDeck({ slides: 3 });
    const ids = idsOf(session);
    session.selectSlides([ids[1]!]);
    const clip = session.slideClipboard.copy()!;
    const [made] = session.slideClipboard.paste(clip);
    expect(made).not.toBe(ids[1]);
    const was = session.deck.slides.find((s) => s.id === ids[1])!;
    const now = session.deck.slides.find((s) => s.id === made)!;
    expect(now.elements.map((e) => e.id)).toEqual(was.elements.map((e) => e.id));
  });

  it("is one step of undo, and takes the slides away again", async () => {
    const { session } = await openDeck({ slides: 4 });
    const ids = idsOf(session);
    session.selectSlides([ids[0]!, ids[1]!]);
    const clip = session.slideClipboard.copy()!;
    const revision = session.state.revision;
    session.slideClipboard.paste(clip);
    expect(session.deck.slides).toHaveLength(6);
    expect(session.state.revision).toBe(revision + 1);
    session.undo();
    expect(idsOf(session)).toEqual(ids);
  });

  it("goes to the end of the deck when nothing says where", async () => {
    const { session } = await openDeck({ slides: 3 });
    const ids = idsOf(session);
    session.selectSlides([ids[0]!]);
    const clip = session.slideClipboard.copy()!;
    const last = ids[ids.length - 1]!;
    session.selectSlides([last]);
    const [made] = session.slideClipboard.paste(clip);
    expect(idsOf(session).at(-1)).toBe(made);
  });

  it("puts a cut back where the paste is, keeping what the slides were", async () => {
    const { session } = await openDeck({ slides: 4 });
    const ids = idsOf(session);
    session.slides.setNotes("kept", ids[1]!);
    session.selectSlides([ids[1]!]);
    const clip = session.slideClipboard.cut()!;
    expect(idsOf(session)).toEqual([ids[0], ids[2], ids[3]]);
    session.selectSlides([ids[3]!]);
    const [made] = session.slideClipboard.paste(clip);
    expect(idsOf(session)).toEqual([ids[0], ids[2], ids[3], made]);
    expect(session.deck.slides.at(-1)!.notes).toBe("kept");
  });

  it("will not cut every slide of the deck: the deck keeps one, and says so", async () => {
    const { session, errors } = await openDeck({ slides: 2 });
    session.selectSlides(idsOf(session));
    session.slideClipboard.cut();
    expect(session.deck.slides).toHaveLength(2);
    expect(errors.join(" ")).toMatch(/at least one slide/);
  });
});

describe("pasting into another deck", () => {
  it("brings the slides, with their notes, and puts them after the slide shown there", async () => {
    const from = await openDeck({ slides: 3 });
    const into = await openDeck({ slides: 2 });
    from.session.slides.setNotes("from elsewhere", idsOf(from.session)[1]!);
    from.session.selectSlides([idsOf(from.session)[1]!]);
    const clip = from.session.slideClipboard.copy()!;
    const [made] = into.session.slideClipboard.paste(decode(encode(clip)) as SlidesClip);
    expect(into.session.deck.slides).toHaveLength(3);
    expect(into.session.deck.slides[1]!.id).toBe(made);
    expect(into.session.deck.slides[1]!.notes).toBe("from elsewhere");
  });

  it("gives a slide whose layout the other deck's theme lacks a layout it has, with its slots as plain boxes in the places they were", async () => {
    const from = await openDeck({ slides: 2 });
    const into = await openDeck({ slides: 1 });
    const source = from.session.deck.slides[1]!;
    const title = source.elements.find((e) => e.placeholder === "title")!;
    // Where the slot is on the slide it is on (the editor's `boxOf` is for the slide shown, which is the first).
    const where = boxOf(from.session.deck.theme, source.layout, title)!;
    from.session.selectSlides([source.id]);
    const clip = from.session.slideClipboard.copy()!;
    // Make the other deck's theme unlike this one: the layout is a name it does not have.
    clip.slides[0]!.layout = "something-else";
    const [made] = into.session.slideClipboard.paste(clip);
    const slide = into.session.deck.slides.find((s) => s.id === made)!;
    expect(into.session.deck.theme.layouts.some((l) => l.name === slide.layout)).toBe(true);
    const there = slide.elements.find((e) => e.id === title.id)!;
    expect(there.placeholder ?? null).toBeNull();
    expect([there.x, there.y, there.w, there.h]).toEqual([where.x, where.y, where.w, where.h]);
  });
});

describe("the size of the deck the slides came from", () => {
  it("is kept with the copy, and comes back through the clipboard's JSON", async () => {
    const { session } = await openDeck({ slides: 2 });
    session.selectSlides([idsOf(session)[0]!]);
    const clip = session.slideClipboard.copy()!;
    expect(clip.size).toEqual({ w: 960, h: 540 });
    expect(decode(encode(clip))?.kind === "slides" && (decode(encode(clip)) as SlidesClip).size).toEqual({ w: 960, h: 540 });
  });

  it("is dropped from a copy that names no size, or an absurd one", () => {
    const base = { v: 2, kind: "slides", stamp: "s", slides: [{ id: "s-1", layout: "blank", elements: [] }], sections: [], pins: {}, cut: false };
    expect((decode(JSON.stringify(base)) as SlidesClip).size).toBeUndefined();
    expect((decode(JSON.stringify({ ...base, size: { w: -5, h: 10 } })) as SlidesClip).size).toBeUndefined();
    expect((decode(JSON.stringify({ ...base, size: { w: "wide", h: 10 } })) as SlidesClip).size).toBeUndefined();
    expect((decode(JSON.stringify({ ...base, size: { w: 720, h: 540 } })) as SlidesClip).size).toEqual({ w: 720, h: 540 });
  });

  it("makes no difference to slides pasted into a deck of the same size", async () => {
    const from = await openDeck({ slides: 2 });
    const into = await openDeck({ slides: 1 });
    from.session.elements.insert([{ type: "text", id: "", x: 100, y: 50, w: 400, h: 60, text: { paragraphs: [{ runs: [{ t: "kept" }] }] } } as never]);
    from.session.selectSlides([from.session.state.slideId]);
    const [made] = into.session.slideClipboard.paste(decode(encode(from.session.slideClipboard.copy()!)) as SlidesClip);
    const text = into.session.deck.slides.find((s) => s.id === made)!.elements.find((e) => e.type === "text" && e.text.paragraphs[0]?.runs[0]?.t === "kept")!;
    expect([text.x, text.y, text.w, text.h]).toEqual([100, 50, 400, 60]);
  });

  it("has the slides refitted to a deck of another size, as the engine refits a deck whose page size changes", async () => {
    const from = await openDeck({ slides: 2 });
    const into = await openDeck({ slides: 1 });
    into.engine.apply("set_page_size", { w: 480, h: 270 });
    from.session.elements.insert([{ type: "text", id: "", x: 100, y: 50, w: 400, h: 60, text: { paragraphs: [{ runs: [{ t: "kept" }] }] } } as never]);
    from.session.selectSlides([from.session.state.slideId]);
    const clip = decode(encode(from.session.slideClipboard.copy()!)) as SlidesClip;
    const [made] = into.session.slideClipboard.paste(clip);
    const text = into.session.deck.slides.find((s) => s.id === made)!.elements.find((e) => e.type === "text" && e.text.paragraphs[0]?.runs[0]?.t === "kept")!;
    // Half the size each way: the box stretches with the slide.
    expect([text.x, text.y, text.w, text.h]).toEqual([50, 25, 200, 30]);
    // Undone in one step.
    into.session.undo();
    expect(into.session.deck.slides).toHaveLength(1);
  });

  it("is pasted as it always was when the copy has no size (a clip from before sizes were kept)", async () => {
    const from = await openDeck({ slides: 2 });
    const into = await openDeck({ slides: 1 });
    into.engine.apply("set_page_size", { w: 480, h: 270 });
    from.session.elements.insert([{ type: "text", id: "", x: 100, y: 50, w: 400, h: 60, text: { paragraphs: [{ runs: [{ t: "kept" }] }] } } as never]);
    from.session.selectSlides([from.session.state.slideId]);
    const clip = from.session.slideClipboard.copy()!;
    delete clip.size;
    const [made] = into.session.slideClipboard.paste(clip);
    const text = into.session.deck.slides.find((s) => s.id === made)!.elements.find((e) => e.type === "text" && e.text.paragraphs[0]?.runs[0]?.t === "kept")!;
    expect([text.x, text.w]).toEqual([100, 400]);
  });
});

describe("sections", () => {
  const sections = [
    { title: "Intro", at: 0 },
    { title: "Part two", at: 2 },
  ];

  it("a section that began at a slide copied begins at its copy, when the copy ends a section (the slides after it start another)", async () => {
    const { session } = await openDeck({ slides: 4, sections });
    const ids = idsOf(session);
    session.selectSlides([ids[2]!, ids[3]!]);
    const clip = session.slideClipboard.copy()!;
    expect(clip.sections).toEqual([{ title: "Part two", startsAt: ids[2] }]);
    // After the last slide of the deck: nothing follows, so the pasted slides can begin a section of their own.
    session.selectSlides([ids[3]!]);
    const made = session.slideClipboard.paste(clip);
    const starts = (session.deck.sections ?? []).map((s) => [s.title, s.startsAt]);
    expect(starts).toContainEqual(["Part two", made[0]]);
  });

  it("joins the section of the slide it follows when it lands in the middle of one, rather than cutting that section in two", async () => {
    const { session } = await openDeck({ slides: 5, sections: [{ title: "Intro", at: 0 }, { title: "Part two", at: 3 }] });
    const ids = idsOf(session);
    session.selectSlides([ids[3]!]);
    const clip = session.slideClipboard.copy()!;
    const before = (session.deck.sections ?? []).length;
    session.selectSlides([ids[1]!]);
    const made = session.slideClipboard.paste(clip);
    expect(session.deck.sections ?? []).toHaveLength(before);
    expect((session.deck.sections ?? []).some((s) => s.startsAt === made[0])).toBe(false);
  });
});

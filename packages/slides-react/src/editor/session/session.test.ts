import { describe, expect, it, vi } from "vitest";

import { newDeck } from "../../test/engine.ts";
import type { SaveOutcome, SlidesHost } from "../host.ts";
import { shape, textBox } from "../factory.ts";
import { EditorSession } from "./session.ts";

interface FakeHost extends SlidesHost {
  saved: string[];
  answer: SaveOutcome;
}

function fakeHost(): FakeHost {
  const host: FakeHost = {
    saved: [],
    answer: { status: "saved" },
    save: async (text) => {
      host.saved.push(text);
      return host.answer;
    },
    imageUrl: () => undefined,
    addImage: async (name) => `assets/${name}`,
    deliver: async () => {},
    notify: () => {},
  };
  return host;
}

async function open(extra = 0) {
  const engine = await newDeck("Talk");
  for (let i = 0; i < extra; i++) engine.apply("add_slide", { layout: "title-body", content: { title: `Slide ${i + 2}` } });
  const host = fakeHost();
  const errors: string[] = [];
  const session = new EditorSession(engine, host, { saveDelay: 5, onError: (m) => errors.push(m) });
  return { session, host, errors, engine };
}

const ids = (session: EditorSession) => session.deck.slides.map((s) => s.id);

describe("slides", () => {
  it("starts on the first slide and follows added, duplicated and deleted slides", async () => {
    const { session } = await open();
    const first = session.state.slideId;
    expect(session.state.slideSelection).toEqual([first]);

    const second = session.slides.add();
    expect(second).toBeDefined();
    expect(session.state.slideId).toBe(second);
    // A new slide is blank, whatever comes before it.
    expect(session.slide.layout).toBe("blank");
    expect(ids(session)).toEqual([first, second]);

    const [copy] = session.slides.duplicate();
    expect(session.state.slideSelection).toEqual([copy]);
    expect(ids(session)).toEqual([first, second, copy]);

    session.slides.remove([copy!]);
    expect(session.state.slideId).toBe(second);
    session.slides.remove([second!]);
    expect(session.state.slideId).toBe(first);
  });

  it("shows what undo and redo changed", async () => {
    const { session } = await open(2);
    const [a, b, c] = ids(session) as [string, string, string];
    session.goTo(a);
    session.slides.setNotes("Say hello");
    session.goTo(c);
    session.undo();
    expect(session.state.slideId).toBe(a);
    expect(session.slide.notes ?? "").toBe("");
    expect(session.state.canRedo).toBe(true);
    session.redo();
    expect(session.slide.notes).toBe("Say hello");
    expect(b).toBeDefined();
  });

  it("moves slides by places and toggles flags", async () => {
    const { session } = await open(2);
    const [a, b, c] = ids(session) as [string, string, string];
    session.selectSlides([a]);
    session.slides.moveBy(1);
    expect(ids(session)).toEqual([b, a, c]);
    session.slides.moveBy(5);
    expect(ids(session)).toEqual([b, c, a]);
    session.slides.moveBy(-1, [c]);
    expect(ids(session)).toEqual([c, b, a]);
    session.slides.setFlags({ hidden: true }, [b]);
    expect(session.deck.slides.find((s) => s.id === b)?.hidden).toBe(true);
  });

  it("reports an operation that cannot be done and changes nothing", async () => {
    const { session, errors } = await open();
    const before = session.deck;
    session.slides.setLayout("no-such-layout");
    expect(errors).toHaveLength(1);
    expect(session.deck).toBe(before);
  });
});

describe("selection", () => {
  it("selects, adds and toggles elements, and drops what is gone", async () => {
    const { session } = await open();
    const [title, sub] = session.slide.elements.map((e) => e.id) as [string, string];
    session.select([title]);
    expect(session.state.selection).toEqual([title]);
    session.select([sub], "add");
    expect(session.state.selection).toEqual([title, sub]);
    session.select([title], "toggle");
    expect(session.state.selection).toEqual([sub]);
    session.select(["nope"]);
    expect(session.state.selection).toEqual([]);
    session.select([sub]);
    session.elements.remove();
    expect(session.state.selection).toEqual([]);
    session.undo();
    expect(session.slide.elements.map((e) => e.id)).toContain(sub);
  });

  it("starts and stops editing text", async () => {
    const { session } = await open();
    const id = session.slide.elements[0]!.id;
    session.startEditing(id);
    expect(session.state).toMatchObject({ editing: id, selection: [id] });
    session.select([id]);
    expect(session.state.editing).toBe(id);
    session.stopEditing();
    expect(session.state.editing).toBeNull();
    session.startEditing("nope");
    expect(session.state.editing).toBeNull();
  });
});

describe("elements", () => {
  it("inserts, moves, arranges, groups and duplicates", async () => {
    const { session } = await open();
    const [a, b] = session.elements.insert([shape("rect", { x: 100, y: 100, w: 80, h: 60 }), textBox({ x: 300, y: 100, w: 200, h: 40 }, "Hi")]) as [string, string];
    expect(session.state.selection).toEqual([a, b]);
    expect(session.state.tool).toBe("select");

    session.elements.nudge(10, -5, [a]);
    const moved = session.slide.elements.find((e) => e.id === a)!;
    expect([moved.x, moved.y]).toEqual([110, 95]);

    session.elements.arrange("back", [b]);
    expect(session.slide.elements[0]!.id).toBe(b);

    session.elements.align("left", [a, b]);
    expect(session.slide.elements.find((e) => e.id === a)!.x).toBe(session.slide.elements.find((e) => e.id === b)!.x);

    session.select([a, b]);
    session.elements.group();
    const group = session.slide.elements.find((e) => e.type === "group")!;
    expect(session.state.selection).toEqual([group.id]);
    session.elements.ungroup();
    expect(session.state.selection).toHaveLength(2);
    expect(session.slide.elements.some((e) => e.type === "group")).toBe(false);

    const before = session.slide.elements.length;
    session.elements.duplicate([a]);
    expect(session.slide.elements).toHaveLength(before + 1);
    expect(session.state.selection).toHaveLength(1);
    expect(session.state.selection[0]).not.toBe(a);
  });

  it("writes finished text once, and not at all when it did not change", async () => {
    const { session } = await open();
    const id = session.slide.elements[0]!.id;
    const revision = session.state.revision;
    const held = session.slide.elements[0]!;
    if (held.type !== "text") throw new Error("expected a text element");
    session.elements.setText(id, held.text);
    expect(session.state.revision).toBe(revision);
    session.elements.setText(id, { paragraphs: [{ runs: [{ t: "New words" }] }] });
    expect(session.state.revision).toBe(revision + 1);
    const changed = session.slide.elements.find((e) => e.id === id)!;
    expect(changed.type === "text" && changed.text.paragraphs[0]!.runs[0]!.t).toBe("New words");
  });

  it("finds and replaces across the deck as one step", async () => {
    const { session } = await open(1);
    session.elements.setText(session.slide.elements[0]!.id, { paragraphs: [{ runs: [{ t: "Tool use" }] }] });
    expect(session.elements.replaceAll("tool", "Skill")).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(session.deck)).toContain("Skill use");
  });
});

describe("clipboard", () => {
  // The details (steps, cut, groups, in place, slides) are in `clipboard.test.ts` and `slide-clipboard.test.ts`.
  it("copies, pastes with a step, cuts, and turns plain text into a text box", async () => {
    const { session } = await open();
    const [a] = session.elements.insert([shape("ellipse", { x: 50, y: 50, w: 100, h: 100 })]) as [string];
    const clip = session.clipboard.copy([a])!;
    expect(clip.elements).toHaveLength(1);

    const [p1] = session.clipboard.paste();
    const [p2] = session.clipboard.paste();
    const at = (id: string) => session.slide.elements.find((e) => e.id === id)!;
    expect([at(p1!).x, at(p1!).y]).toEqual([66, 66]);
    expect([at(p2!).x, at(p2!).y]).toEqual([82, 82]);

    // Onto another slide it lands where it was.
    session.slides.add();
    const [p3] = session.clipboard.paste();
    expect([at(p3!).x, at(p3!).y]).toEqual([50, 50]);

    session.select([p3!]);
    const count = session.slide.elements.length;
    session.clipboard.cut();
    expect(session.slide.elements).toHaveLength(count - 1);

    const [words] = session.clipboard.paste("Just some words");
    const made = at(words!);
    expect(made.type).toBe("text");
    // A copy from another deck is what a paste is given.
    const [fromClip] = session.clipboard.paste(clip);
    expect(at(fromClip!).type).toBe("shape");
  });
});

describe("formatting a selected box", () => {
  it("bolds, colours, aligns and lists all the words, and summarises them", async () => {
    const { session } = await open();
    const [a] = session.elements.insert([textBox({ x: 50, y: 300, w: 400, h: 100 }, "Plain words")]) as [string];
    expect(session.text.state([a]).bold).toBe(false);
    session.text.toggle("b", [a]);
    expect(session.text.state([a]).bold).toBe(true);
    session.text.toggle("b", [a]);
    expect(session.text.state([a]).bold).toBe(false);
    session.text.setRun("color", "accent2", [a]);
    session.text.setRun("size", 30, [a]);
    session.text.setAlign("center", [a]);
    session.text.toggleList("bullet", [a]);
    expect(session.text.state([a])).toMatchObject({ color: "accent2", size: 30, align: "center", list: "bullet" });
    session.text.indent(1, [a]);
    expect(session.text.state([a]).level).toBe(1);
    session.text.clearFormatting([a]);
    expect(session.text.state([a])).toMatchObject({ color: null, size: null });
    // One undo step per command.
    session.undo();
    expect(session.text.state([a])).toMatchObject({ color: "accent2", size: 30 });
  });

  it("says mixed when the selection disagrees", async () => {
    const { session } = await open();
    const [a, b] = session.elements.insert([textBox({ x: 50, y: 300, w: 300, h: 60 }, "One"), textBox({ x: 50, y: 400, w: 300, h: 60 }, "Two")]) as [string, string];
    session.text.toggle("i", [a]);
    expect(session.text.state([a, b]).italic).toBe("mixed");
    session.text.toggle("i", [a, b]);
    expect(session.text.state([a, b]).italic).toBe(true);
  });
});

describe("saving", () => {
  it("saves once after the changes pause, and reports where it stands", async () => {
    const { session, host } = await open();
    expect(session.state.saving.status).toBe("saved");
    session.slides.setNotes("a");
    session.slides.setNotes("ab");
    expect(session.state.saving.status).toBe("unsaved");
    await vi.waitFor(() => expect(session.state.saving.status).toBe("saved"));
    expect(host.saved).toHaveLength(1);
    expect(host.saved[0]).toContain('"notes": "ab"');
  });

  it("does not save what is already saved", async () => {
    const { session, host } = await open();
    await session.flush();
    expect(host.saved).toHaveLength(0);
    session.slides.setNotes("x");
    await session.flush();
    await session.flush();
    expect(host.saved).toHaveLength(1);
  });

  it("holds a conflict until the person settles it", async () => {
    const { session, host } = await open();
    host.answer = { status: "conflict", theirs: "THEIRS", copy: "library/talk (conflict).deck" };
    session.slides.setNotes("mine");
    await session.flush();
    expect(session.state.saving).toEqual({ status: "conflict", theirs: "THEIRS", copy: "library/talk (conflict).deck" });
    // Further changes wait: the file is not the one being edited.
    session.slides.setNotes("mine again");
    await new Promise((r) => setTimeout(r, 30));
    expect(host.saved).toHaveLength(1);
    host.answer = { status: "saved" };
    await session.overwrite();
    expect(host.saved).toHaveLength(2);
    expect(session.state.saving.status).toBe("saved");
  });

  it("reports a failed save and tries again on the next change", async () => {
    const { session, host } = await open();
    host.save = async () => {
      throw new Error("disk full");
    };
    session.slides.setNotes("x");
    await session.flush();
    expect(session.state.saving).toEqual({ status: "error", message: "disk full" });
  });

  it("takes a change made outside when nothing is unsaved, and sets it beside the work otherwise", async () => {
    const { session } = await open();
    const other = await newDeck("Other");
    other.apply("set_title", { title: "Changed elsewhere" });
    const text = other.save();
    session.receive(text);
    expect(session.deck.title).toBe("Changed elsewhere");
    expect(session.state.saving.status).toBe("saved");

    session.slides.setNotes("mine");
    other.apply("set_title", { title: "Changed again" });
    session.receive(other.save());
    expect(session.state.saving.status).toBe("conflict");
    session.load(other.save());
    expect(session.state.saving.status).toBe("saved");
    expect(session.deck.title).toBe("Changed again");
  });
});

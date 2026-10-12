import { act, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parserIsIn } from "../filmstrip/test-support.ts";
import { body, p, setup, title, type as typeInto, wait, words } from "./outline-support.tsx";
import { WRITE_DELAY } from "./useDraft.ts";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("editing a title", () => {
  it("writes it to the deck after a pause, as one step", async () => {
    const { session, slot } = await setup({ slides: 3 });
    const before = session.deck;
    typeInto(title(2), "A better title");
    expect(title(2).value).toBe("A better title");
    wait(WRITE_DELAY - 1);
    expect(session.deck).toBe(before);
    wait(1);
    expect(words(slot(1, "title"))).toEqual(["A better title"]);
    act(() => session.undo());
    expect(words(slot(1, "title"))).toEqual(["Slide 2"]);
  });

  it("waits for a pause, and writes at once when the focus leaves", async () => {
    const { session, slot } = await setup({ slides: 3 });
    title(2).focus();
    typeInto(title(2), "Al");
    wait(300);
    typeInto(title(2), "Alpha");
    wait(300);
    expect(words(slot(1, "title"))).toEqual(["Slide 2"]);
    fireEvent.blur(title(2));
    expect(words(slot(1, "title"))).toEqual(["Alpha"]);
    // Nothing more, later.
    const settled = session.deck;
    wait(WRITE_DELAY * 2);
    expect(session.deck).toBe(settled);
  });

  it("goes through set_text, and nothing else, with the words as Markdown", async () => {
    const { session, ids } = await setup({ slides: 3 });
    const apply = vi.spyOn(session.core, "apply");
    typeInto(title(2), "Why **tools**?");
    fireEvent.blur(title(2));
    const elementId = session.deck.slides[1]!.elements.find((e) => e.placeholder === "title")!.id;
    expect(apply.mock.calls).toEqual([["set_text", { slide: ids[1], id: elementId, markdown: "Why **tools**?" }]]);
  });

  it("keeps a typed number and dot from becoming a list", async () => {
    const { session, ids } = await setup({ slides: 3 });
    const apply = vi.spyOn(session.core, "apply");
    typeInto(title(2), "1. Intro");
    fireEvent.blur(title(2));
    expect(apply.mock.calls[0]?.[1]).toMatchObject({ slide: ids[1], markdown: "1\\. Intro" });
  });

  it("writes nothing when the title is what it was", async () => {
    const { session } = await setup({ slides: 3 });
    const before = session.deck;
    title(2).focus();
    fireEvent.blur(title(2));
    typeInto(title(2), "Slide 2");
    fireEvent.blur(title(2));
    typeInto(title(2), "Slide 2  ");
    fireEvent.blur(title(2));
    expect(session.deck).toBe(before);
  });

  it("writes when the outline goes away", async () => {
    const { slot, unmount } = await setup({ slides: 3 });
    typeInto(title(3), "Last word");
    unmount();
    expect(words(slot(2, "title"))).toEqual(["Last word"]);
  });

  it("writes one row at a time: only the slide edited changes", async () => {
    const { session, ids } = await setup({ slides: 3 });
    const others = [session.deck.slides[0], session.deck.slides[2]];
    typeInto(title(2), "Changed");
    fireEvent.blur(title(2));
    expect(session.deck.slides[0]).toBe(others[0]);
    expect(session.deck.slides[2]).toBe(others[1]);
    expect(session.deck.slides[1]!.id).toBe(ids[1]);
  });
});

describe("editing a body", () => {
  it("writes a line to a paragraph, and gives them the slot's bullets", async () => {
    const { session, slot } = await setup({ slides: 3 });
    body(2).focus();
    typeInto(body(2), "First point\nSecond point");
    // Still the words as typed while the caret is there.
    wait(WRITE_DELAY);
    expect(body(2).value).toBe("First point\nSecond point");
    expect(words(slot(1, "body"))).toEqual(["First point", "Second point"]);
    expect(slot(1, "body")?.paragraphs.map((paragraph) => paragraph.list)).toEqual(["bullet", "bullet"]);
    // Once the focus is gone the deck's own wording is shown.
    fireEvent.blur(body(2));
    expect(body(2).value).toBe("- First point\n- Second point");
    // One undo step for it.
    act(() => session.undo());
    expect(words(slot(1, "body"))).toEqual(["Point 2"]);
  });

  it("is written through set_text as the Markdown that was typed", async () => {
    const { session, ids } = await setup({ slides: 3 });
    const apply = vi.spyOn(session.core, "apply");
    typeInto(body(3), "- one\n  - two\n**bold** and [a link](https://a.b)");
    fireEvent.blur(body(3));
    const elementId = session.deck.slides[2]!.elements.find((e) => e.placeholder === "body")!.id;
    expect(apply.mock.calls).toEqual([["set_text", { slide: ids[2], id: elementId, markdown: "- one\n  - two\n**bold** and [a link](https://a.b)" }]]);
  });

  it("clears a body that is emptied", async () => {
    const { slot } = await setup({ slides: 3 });
    typeInto(body(2), "");
    fireEvent.blur(body(2));
    expect(words(slot(1, "body")).join("")).toBe("");
    expect(body(2).value).toBe("");
  });

  it("grows with its words: the field is sized by a copy of them", async () => {
    const { container } = await setup({ slides: 3 });
    typeInto(body(2), "a\nb\nc");
    expect((container.querySelectorAll(".ks-ol-grow")[1] as HTMLElement).getAttribute("data-value")).toBe("a\nb\nc");
  });

  it("carries a list on with Enter, and Tab moves an empty item in", async () => {
    await setup({ slides: 3 });
    const field = body(2);
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
    fireEvent.keyDown(field, { key: "Enter" });
    expect(field.value).toBe("- Point 2\n- ");
    expect(field.selectionStart).toBe(field.value.length);
    fireEvent.keyDown(field, { key: "Tab" });
    expect(field.value).toBe("- Point 2\n  - ");
    expect(field.selectionStart).toBe(field.value.length);
    fireEvent.keyDown(field, { key: "Tab", shiftKey: true });
    expect(field.value).toBe("- Point 2\n- ");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(field.value).toBe("- Point 2\n");
  });

  it("lets Tab leave a body it has nothing to do with", async () => {
    await setup({ slides: 3 });
    const field = body(2);
    field.setSelectionRange(3, 3);
    expect(fireEvent.keyDown(field, { key: "Tab" })).toBe(true);
    expect(fireEvent.keyDown(field, { key: "Enter", shiftKey: true })).toBe(true);
  });
});

describe("changes from elsewhere while a field has the focus", () => {
  it("shows an undo made from a toolbar, once what was typed has been written", async () => {
    const { session, slot } = await setup({ slides: 3 });
    body(2).focus();
    typeInto(body(2), "First\nSecond");
    wait(WRITE_DELAY);
    // Written, and still shown as it was typed.
    expect(words(slot(1, "body"))).toEqual(["First", "Second"]);
    expect(body(2).value).toBe("First\nSecond");
    act(() => session.undo());
    expect(words(slot(1, "body"))).toEqual(["Point 2"]);
    expect(body(2).value).toBe("- Point 2");
  });

  it("does the same for a title", async () => {
    const { session } = await setup({ slides: 3 });
    title(2).focus();
    typeInto(title(2), "Typed");
    wait(WRITE_DELAY);
    expect(title(2).value).toBe("Typed");
    act(() => session.undo());
    expect(title(2).value).toBe("Slide 2");
  });

  it("keeps what the person has typed since the last write", async () => {
    const { session, engine, ids, slot } = await setup({ slides: 3 });
    body(2).focus();
    typeInto(body(2), "written");
    wait(WRITE_DELAY);
    typeInto(body(2), "written and more");
    const element = session.deck.slides[1]!.elements.find((e) => e.placeholder === "body")!;
    act(() => void engine.apply("set_rich_text", { slide: ids[1]!, id: element.id, text: { paragraphs: [p("from elsewhere", { list: "bullet" })] } }));
    expect(body(2).value).toBe("written and more");
    // Written in its turn, over the other.
    fireEvent.blur(body(2));
    expect(words(slot(1, "body"))).toEqual(["written and more"]);
  });

  it("shows a change from elsewhere in a field that has the focus but has not been typed in", async () => {
    const { session, engine, ids } = await setup({ slides: 3 });
    body(2).focus();
    const element = session.deck.slides[1]!.elements.find((e) => e.placeholder === "body")!;
    act(() => void engine.apply("set_rich_text", { slide: ids[1]!, id: element.id, text: { paragraphs: [p("from elsewhere", { list: "bullet" })] } }));
    expect(body(2).value).toBe("- from elsewhere");
  });
});

describe("undo and redo from the keyboard", () => {
  it("undo the last change to the deck when a field has the focus and nothing typed is waiting", async () => {
    const { session, slot } = await setup({ slides: 3 });
    body(2).focus();
    typeInto(body(2), "First\nSecond");
    wait(WRITE_DELAY);
    expect(words(slot(1, "body"))).toEqual(["First", "Second"]);
    expect(fireEvent.keyDown(body(2), { key: "z", ctrlKey: true })).toBe(false);
    expect(words(slot(1, "body"))).toEqual(["Point 2"]);
    expect(body(2).value).toBe("- Point 2");
    expect(fireEvent.keyDown(body(2), { key: "z", ctrlKey: true, shiftKey: true })).toBe(false);
    expect(words(slot(1, "body"))).toEqual(["First", "Second"]);
    fireEvent.keyDown(body(2), { key: "z", ctrlKey: true });
    expect(session.state.redoLabel).toBeDefined();
    fireEvent.keyDown(body(2), { key: "y", ctrlKey: true });
    expect(words(slot(1, "body"))).toEqual(["First", "Second"]);
  });

  it("does the same in a title", async () => {
    await setup({ slides: 3 });
    title(2).focus();
    typeInto(title(2), "Retitled");
    wait(WRITE_DELAY);
    expect(fireEvent.keyDown(title(2), { key: "z", metaKey: true })).toBe(false);
    expect(title(2).value).toBe("Slide 2");
  });

  it("leave Ctrl+Z to the field while typed words are waiting to be written", async () => {
    const { session, slot } = await setup({ slides: 3 });
    body(2).focus();
    typeInto(body(2), "Typed");
    expect(fireEvent.keyDown(body(2), { key: "z", ctrlKey: true })).toBe(true);
    expect(words(slot(1, "body"))).toEqual(["Point 2"]);
    expect(body(2).value).toBe("Typed");
    expect(session.state.canRedo).toBe(false);
  });
});

// What is typed is Markdown, and once `set_text` reads it the deck gets bullets, levels and looks from it.
const parser = await parserIsIn();

describe.skipIf(!parser)("typing Markdown, once the parser is in", () => {
  it("makes bullets, levels, numbers, looks and links of what is typed in a body", async () => {
    const { slot } = await setup({ slides: 3 });
    typeInto(body(2), "- one\n  - two\n1. three\n**bold** and [a link](https://a.b)");
    fireEvent.blur(body(2));
    const text = slot(1, "body")!;
    expect(text.paragraphs.map((paragraph) => [paragraph.list ?? null, paragraph.level ?? 0, paragraph.runs.map((run) => run.t).join("")])).toEqual([
      ["bullet", 0, "one"],
      ["bullet", 1, "two"],
      ["number", 0, "three"],
      ["bullet", 0, "bold and a link"],
    ]);
    const last = text.paragraphs[3]!.runs;
    expect(last.map((run) => [run.t, run.b === true, run.link ?? null])).toEqual([
      ["bold", true, null],
      [" and ", false, null],
      ["a link", false, "https://a.b"],
    ]);
  });

  it("shows what was made of it, as Markdown, once the focus has left", async () => {
    await setup({ slides: 3 });
    typeInto(body(2), "* one\n  * two   \n\n\n2) **three**");
    fireEvent.blur(body(2));
    // A number typed is the number the list counts from (2), as Markdown says; it is not counted over from 1.
    expect(body(2).value).toBe("- one\n  - two\n2. **three**");
  });

  it("makes the looks of a title from what is typed in it", async () => {
    const { slot } = await setup({ slides: 3 });
    typeInto(title(2), "Why **tools** and `code`?");
    fireEvent.blur(title(2));
    expect(slot(1, "title")!.paragraphs[0]!.runs.map((run) => [run.t, run.b === true, run.code === true])).toEqual([
      ["Why ", false, false],
      ["tools", true, false],
      [" and ", false, false],
      ["code", false, true],
      ["?", false, false],
    ]);
    expect(title(2).value).toBe("Why **tools** and `code`?");
  });

  it("writes a title that looks like a list as the words it is", async () => {
    const { slot } = await setup({ slides: 3 });
    typeInto(title(2), "1. Intro");
    fireEvent.blur(title(2));
    const paragraph = slot(1, "title")!.paragraphs[0]!;
    expect(paragraph.list ?? null).toBeNull();
    expect(paragraph.runs.map((run) => run.t).join("")).toBe("1. Intro");
    expect(title(2).value).toBe("1\\. Intro");
  });

  it("makes a nested bullet of Enter, Tab and words", async () => {
    const { slot } = await setup({ slides: 3 });
    const field = body(2);
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.keyDown(field, { key: "Tab" });
    typeInto(field, `${field.value}nested`);
    fireEvent.blur(field);
    expect(slot(1, "body")!.paragraphs.map((paragraph) => [paragraph.list ?? null, paragraph.level ?? 0, paragraph.runs.map((run) => run.t).join("")])).toEqual([
      ["bullet", 0, "Point 2"],
      ["bullet", 1, "nested"],
    ]);
    expect(body(2).value).toBe("- Point 2\n  - nested");
  });

  it("brings the words and their looks back with an undo", async () => {
    const { session, slot } = await setup({ slides: 3 });
    typeInto(body(2), "- **new**");
    fireEvent.blur(body(2));
    expect(slot(1, "body")!.paragraphs[0]!.runs[0]!.b).toBe(true);
    act(() => session.undo());
    expect(words(slot(1, "body"))).toEqual(["Point 2"]);
    expect(body(2).value).toBe("- Point 2");
  });
});

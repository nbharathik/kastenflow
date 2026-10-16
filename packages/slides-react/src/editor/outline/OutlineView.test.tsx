import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { idsOf } from "../filmstrip/test-support.ts";
import { OutlineView } from "./OutlineView.tsx";
import { body, p, setup, title, type as typeInto, wait, words } from "./outline-support.tsx";
import { WRITE_DELAY } from "./useDraft.ts";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("what it shows", () => {
  it("has a row for each slide with its number, its title and its body as Markdown", async () => {
    const { container } = await setup({ slides: 3 });
    expect(container.querySelectorAll(".ks-ol-row")).toHaveLength(3);
    expect(title(1).value).toBe("Talk");
    expect(title(2).value).toBe("Slide 2");
    expect(body(2).value).toBe("- Point 2");
    expect(body(3).value).toBe("- Point 3");
    expect([...container.querySelectorAll(".ks-ol-num")].map((n) => n.textContent)).toEqual(["1", "2", "3"]);
  });

  it("shows the body of an opening slide, which is its subtitle, and marks the shown row", async () => {
    const { container } = await setup({ slides: 2 });
    expect(body(1).value).toBe("");
    const rows = container.querySelectorAll(".ks-ol-row");
    expect(rows[0]!.classList.contains("is-shown")).toBe(true);
    expect(rows[1]!.classList.contains("is-shown")).toBe(false);
  });

  it("writes nested bullets, numbers and looks as Markdown", async () => {
    const { engine, session } = await setup({ slides: 2 });
    const slide = session.deck.slides[1]!;
    const bodyEl = slide.elements.find((e) => e.placeholder === "body")!;
    act(() =>
      void engine.apply("set_rich_text", {
        slide: slide.id,
        id: bodyEl.id,
        text: { paragraphs: [p("One", { list: "bullet" }), { runs: [{ t: "Two", b: true }, { t: " and ", i: false }, { t: "code", code: true }], list: "bullet", level: 1 }, p("Third", { list: "number" })] },
      }),
    );
    expect(body(2).value).toBe("- One\n  - **Two** and `code`\n1. Third");
  });

  it("dims a slide that is skipped and tags a backup slide", async () => {
    const { container } = await setup({ slides: 3, hidden: [1], backup: [2] });
    const rows = container.querySelectorAll(".ks-ol-row");
    expect(rows[1]!.classList.contains("is-skipped")).toBe(true);
    expect(rows[1]!.querySelector('[title="Skipped when presenting"]')).not.toBeNull();
    expect(rows[2]!.classList.contains("is-backup")).toBe(true);
    expect(rows[2]!.textContent).toContain("Backup");
    expect(rows[0]!.classList.contains("is-skipped")).toBe(false);
  });

  it("follows changes made elsewhere", async () => {
    const { session, ids, engine } = await setup({ slides: 2 });
    const bodyEl = session.deck.slides[1]!.elements.find((e) => e.placeholder === "body")!;
    act(() => void engine.apply("set_rich_text", { slide: ids[1]!, id: bodyEl.id, text: { paragraphs: [p("Changed", { list: "bullet" })] } }));
    expect(body(2).value).toBe("- Changed");
    act(() => session.undo());
    expect(body(2).value).toBe("- Point 2");
  });
});

describe("a slide without a title or a body", () => {
  it("uses the first text on the slide as its title and the next as its body", async () => {
    const made = await setup({ slides: 1 });
    cleanup();
    const added = made.engine.apply("add_slide", { layout: "blank" }).output.slide;
    made.engine.apply("add_elements", {
      slide: added,
      elements: [
        { type: "text", id: "", x: 10, y: 10, w: 200, h: 40, text: { paragraphs: [p("A loose box")] } },
        { type: "text", id: "", x: 10, y: 80, w: 200, h: 40, text: { paragraphs: [p("Another")] } },
      ] as never,
    });
    render(<OutlineView session={made.session} ui={made.ui} />);
    expect(title(2).value).toBe("A loose box");
    expect(body(2).value).toBe("Another");
  });

  it("shows a slide with things on it but no text as untitled, read only and dimmed, and has no body", async () => {
    const made = await setup({ slides: 2 });
    cleanup();
    const bare = made.session.deck.slides[1]!;
    made.engine.apply("delete_elements", { slide: bare.id, ids: bare.elements.map((e) => e.id) });
    made.engine.apply("add_elements", { slide: bare.id, elements: [{ type: "shape", id: "", shape: "rect", x: 10, y: 10, w: 100, h: 100 } as never] });
    render(<OutlineView session={made.session} ui={made.ui} />);
    const field = title(2);
    expect(field.readOnly).toBe(true);
    expect(field.value).toBe("");
    expect(field.placeholder).toBe("Untitled slide");
    expect(field.classList.contains("is-none")).toBe(true);
    expect(screen.queryByLabelText("Text of slide 2")).toBeNull();
    // Typing does nothing to the deck: the outline does not make a box beside what is there.
    const before = made.session.deck;
    typeInto(field, "Something");
    wait(WRITE_DELAY * 2);
    expect(made.session.deck).toBe(before);
  });
});

describe("a slide with nothing on it", () => {
  /** A deck whose second slide is blank, in an outline. */
  async function withBlank() {
    const made = await setup({ slides: 1 });
    cleanup();
    const bare = made.engine.apply("add_slide", { layout: "blank" }).output.slide;
    render(<OutlineView session={made.session} ui={made.ui} />);
    return { ...made, bare };
  }

  it("has a title field to type in, and no body", async () => {
    await withBlank();
    const field = title(2);
    expect(field.readOnly).toBe(false);
    expect(field.value).toBe("");
    expect(field.classList.contains("is-none")).toBe(false);
    expect(screen.queryByLabelText("Text of slide 2")).toBeNull();
  });

  it("gets its title box, in the layout of a title alone, from the first words typed", async () => {
    const made = await withBlank();
    typeInto(title(2), "Hello");
    expect(made.session.deck.slides[1]!.elements).toHaveLength(0);
    wait(WRITE_DELAY * 2);
    const slide = made.session.deck.slides[1]!;
    expect(slide.layout).toBe("title-only");
    expect(slide.elements).toHaveLength(1);
    const box = slide.elements[0]!;
    expect(box.placeholder).toBe("title");
    expect(box.type === "text" && words(box.text)).toEqual(["Hello"]);
    // The caret stays where it was: the field is the same field.
    expect(title(2).value).toBe("Hello");
  });

  it("keeps writing into the title it made, as it does into any other", async () => {
    const made = await withBlank();
    typeInto(title(2), "Hello");
    wait(WRITE_DELAY * 2);
    typeInto(title(2), "Hello again");
    wait(WRITE_DELAY * 2);
    expect(made.slot(1, "title")).toBeTruthy();
    expect(words(made.slot(1, "title"))).toEqual(["Hello again"]);
    expect(made.session.deck.slides[1]!.elements).toHaveLength(1);
  });

  it("takes the box and the words away together with one undo", async () => {
    const made = await withBlank();
    typeInto(title(2), "Hello");
    wait(WRITE_DELAY * 2);
    act(() => made.session.undo());
    expect(made.session.deck.slides[1]!.elements).toHaveLength(0);
    expect(made.session.deck.slides[1]!.layout).toBe("blank");
    expect(title(2).value).toBe("");
  });

  it("makes no box for words that are only space, or for a title typed and taken away again", async () => {
    const made = await withBlank();
    typeInto(title(2), "   ");
    wait(WRITE_DELAY * 2);
    expect(made.session.deck.slides[1]!.elements).toHaveLength(0);
    typeInto(title(2), "x");
    typeInto(title(2), "");
    wait(WRITE_DELAY * 2);
    expect(made.session.deck.slides[1]!.elements).toHaveLength(0);
  });

  it("makes the box when the focus leaves the field, without waiting for the pause", async () => {
    const made = await withBlank();
    typeInto(title(2), "Quick");
    fireEvent.blur(title(2));
    expect(made.session.deck.slides[1]!.elements).toHaveLength(1);
  });

  it("is what a slide added from the outline is: blank, with the caret in its title", async () => {
    const made = await setup({ slides: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Add a slide after slide 1" }));
    expect(made.session.deck.slides[1]!.elements).toHaveLength(0);
    expect(document.activeElement).toBe(title(2));
    typeInto(title(2), "New idea");
    wait(WRITE_DELAY * 2);
    expect(words(made.slot(1, "title"))).toEqual(["New idea"]);
  });
});

describe("moving about", () => {
  it("puts the caret in the body when Enter is pressed in the title", async () => {
    await setup({ slides: 3 });
    title(2).focus();
    fireEvent.keyDown(title(2), { key: "Enter" });
    expect(document.activeElement).toBe(body(2));
  });

  it("goes on to the next title when a slide has no body", async () => {
    const made = await setup({ slides: 3 });
    cleanup();
    const bare = made.session.deck.slides[1]!;
    const bodyEl = bare.elements.find((e) => e.placeholder === "body")!;
    made.engine.apply("delete_elements", { slide: bare.id, ids: [bodyEl.id] });
    render(<OutlineView session={made.session} ui={made.ui} />);
    title(2).focus();
    fireEvent.keyDown(title(2), { key: "Enter" });
    expect(document.activeElement).toBe(title(3));
  });

  it("shows the slide whose title or body has the focus", async () => {
    const { session, ids } = await setup({ slides: 3 });
    act(() => title(3).focus());
    expect(session.state.slideId).toBe(ids[2]);
    act(() => body(2).focus());
    expect(session.state.slideId).toBe(ids[1]);
  });

  it("shows a slide from its number, and opens it in the editor on a double click", async () => {
    const { session, ui, ids, container } = await setup({ slides: 3 });
    const numbers = () => [...container.querySelectorAll<HTMLElement>(".ks-ol-num")];
    fireEvent.click(numbers()[2]!);
    expect(session.state.slideId).toBe(ids[2]);
    expect(ui.state.view).toBe("edit");
    ui.setView("outline");
    fireEvent.doubleClick(numbers()[1]!);
    expect(session.state.slideId).toBe(ids[1]);
    expect(ui.state.view).toBe("edit");
  });

  it("picks just the slide when its number is used, even after several were picked", async () => {
    const { session, ids, container } = await setup({ slides: 3 });
    act(() => session.selectSlides([ids[0]!, ids[1]!]));
    fireEvent.click(container.querySelectorAll<HTMLElement>(".ks-ol-num")[0]!);
    expect(session.state.slideSelection).toEqual([ids[0]]);
  });
});

describe("adding slides", () => {
  it("adds one at the end from the last row, with the caret in its title", async () => {
    const { session, ids } = await setup({ slides: 3 });
    session.goTo(ids[0]!);
    fireEvent.click(screen.getByRole("button", { name: "New slide" }));
    expect(session.deck.slides).toHaveLength(4);
    expect(idsOf(session).slice(0, 3)).toEqual(ids);
    expect(session.state.slideId).toBe(idsOf(session)[3]);
    expect(document.activeElement).toBe(title(4));
  });

  it("adds one after a row from the plus between rows", async () => {
    const { session, ids } = await setup({ slides: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Add a slide after slide 1" }));
    expect(session.deck.slides).toHaveLength(4);
    expect(idsOf(session)[0]).toBe(ids[0]);
    expect(idsOf(session)[2]).toBe(ids[1]);
    expect(document.activeElement).toBe(title(2));
  });

  it("adds one after the row with Ctrl+Enter in a title or a body", async () => {
    const { session, ids } = await setup({ slides: 3 });
    fireEvent.keyDown(title(2), { key: "Enter", ctrlKey: true });
    expect(session.deck.slides).toHaveLength(4);
    expect(idsOf(session)[1]).toBe(ids[1]);
    fireEvent.keyDown(body(2), { key: "Enter", metaKey: true });
    expect(session.deck.slides).toHaveLength(5);
  });

  it("adds a blank slide, as New slide does, with nothing on it", async () => {
    const { session } = await setup({ slides: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Add a slide after slide 2" }));
    const added = session.deck.slides[2]!;
    expect(added.elements).toHaveLength(0);
    expect(added.layout).toBe("blank");
  });
});

describe("rows", () => {
  it("are drawn again only when their own slide changes", async () => {
    const titles = await import("./titles.ts");
    const spy = vi.spyOn(titles, "titleElement");
    const { session } = await setup({ slides: 4 });
    const firstDraw = spy.mock.calls.length;
    expect(firstDraw).toBeGreaterThanOrEqual(4);
    spy.mockClear();
    // An edit to the second slide draws that row again, and no other.
    typeInto(title(2), "Edited");
    fireEvent.blur(title(2));
    const drawn = new Set(spy.mock.calls.map(([slide]) => slide.id));
    expect(drawn).toEqual(new Set([session.deck.slides[1]!.id]));
  });
});

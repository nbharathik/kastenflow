// The sections layout (cards with title bars) and presenting a page one slide
// at a time: both are drawn over the same Markdown, which they never change.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { findText, useTestEditor } from "../../../../test/editor";
import { markdownFixtures } from "../../../../test/fixtures";
import { splitFrontmatter } from "../../markdown/frontmatter";
import { isSmart, jumpToSection, presentingAt, setFolded, setSmart, showSlide, startPresenting, stopPresenting } from "./api";
import { sectionsKey } from "./key";
import { sectionsOf } from "./model";
import { presentingIn } from "./presenting";
import { endPresenting, presentPage, sectionTexts, stepPresenting } from "./registry";

const editor = useTestEditor({ foldKey: "note-1" });

const FIVE = [
  "# Welcome",
  "",
  "Intro line.",
  "",
  "---",
  "",
  "## Problem",
  "",
  "- slow",
  "- noisy",
  "",
  "---",
  "",
  "## Plan",
  "",
  "Book the guesthouse.",
  "",
  "---",
  "",
  "## Budget",
  "",
  "Money words.",
  "",
  "---",
  "",
  "## Thanks",
  "",
  "Questions?",
  "",
].join("\n");

const dom = () => editor.view.dom as HTMLElement;
const heads = () => [...dom().querySelectorAll<HTMLElement>(".kasten-sec-head")];
const titles = () => heads().map((head) => head.querySelector(".kasten-sec-title")!.textContent);
/** What a block says, its list's markers and breaks squeezed out. */
const words = (node: Element) => (node.textContent ?? "").replace(/\s+/g, " ").trim();
const classes = (selector: string) => [...dom().querySelectorAll(selector)].map(words);
const shown = () => classes(".kasten-slide-now");
const rows = () => dom().querySelectorAll(".kasten-section-summary").length;
/** Where the editor is in its presentation, as the page around it learns it. */
const presenting = () => presentingIn(document.body);

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("the sections layout", () => {
  it("draws each section as a card: classes on its blocks, a title bar before it and an edge after", () => {
    editor.open(FIVE);
    expect(isSmart(editor.view.state)).toBe(false);
    expect(dom().querySelector(".is-sec-start")).toBeNull();
    expect(heads()).toHaveLength(0);

    setSmart(editor.view, true);
    expect(isSmart(editor.view.state)).toBe(true);
    expect(dom().classList.contains("kasten-sections-layout")).toBe(true);
    expect(titles()).toEqual(["Welcome", "Problem", "Plan", "Budget", "Thanks"]);
    expect(heads().map((head) => head.querySelector(".kasten-sec-number")!.textContent)).toEqual(["1", "2", "3", "4", "5"]);
    expect(dom().querySelectorAll(".kasten-sec-foot")).toHaveLength(5);
    // A section's first block starts its card and its last ends it; the blocks between are the inside of the card, by their place.
    expect(classes(".is-sec-start")).toEqual(["Welcome", "Problem", "Plan", "Budget", "Thanks"]);
    expect(classes(".is-sec-end")).toEqual(["Intro line.", "slow noisy", "Book the guesthouse.", "Money words.", "Questions?"]);
    // A section of one block starts and ends with it.
    editor.open("Only one.\n\n---\n\nTwo.\n\nThree.\n");
    expect(classes(".is-sec-start.is-sec-end")).toEqual(["Only one."]);
    editor.open(FIVE);
    setSmart(editor.view, true);
    // The dividers are still there: CSS hides them, the title bars take their place.
    expect(dom().querySelectorAll(".kasten-divider")).toHaveLength(4);

    setSmart(editor.view, false);
    expect(dom().classList.contains("kasten-sections-layout")).toBe(false);
    expect(dom().querySelector(".is-sec-start")).toBeNull();
    expect(heads()).toHaveLength(0);
  });

  it("starts in the layout when the page is opened in it", () => {
    editor.open(FIVE);
    setSmart(editor.view, true);
    // Opening another page keeps the layout on and draws its cards.
    editor.open("One.\n\n---\n\nTwo.\n");
    expect(titles()).toEqual(["One.", "Two."]);
    setSmart(editor.view, false);
  });

  it("leaves the Markdown of every fixture, and of a page, as it was, on or off", () => {
    for (const fixture of [...markdownFixtures().filter((f) => /thematic-breaks|sections/.test(f.name)), { name: "five", text: FIVE }]) {
      const { prefix, body } = splitFrontmatter(fixture.text);
      editor.open(body);
      const off = editor.save();
      setSmart(editor.view, true);
      expect(editor.save(), fixture.name).toBe(off);
      expect(prefix + editor.save(), fixture.name).toBe(fixture.text);
      setFolded(editor.view, [sectionsOf(editor.doc)[1]?.divider ?? -1], true);
      expect(editor.save(), fixture.name).toBe(off);
      setSmart(editor.view, false);
      expect(editor.save(), fixture.name).toBe(off);
    }
  });

  it("keeps the bar and the card as typing goes on inside a block, and reads the title again", () => {
    editor.open(FIVE);
    setSmart(editor.view, true);
    const bar = heads()[2]!;
    editor.caret("Book the", false);
    editor.type("Please ");
    // Typing in a block moved the cards along with the text; none was drawn again.
    expect(heads()[2]).toBe(bar);
    expect(classes(".is-sec-end")).toContain("Please Book the guesthouse.");
    editor.caret("Plan", false);
    editor.type("Big ");
    expect(titles()[2]).toBe("Big Plan");
    expect(editor.save()).toContain("## Big Plan");
  });

  it("draws the cards again when a section is added, taken away or turned into another block", () => {
    editor.open(FIVE);
    setSmart(editor.view, true);
    const { schema } = editor.view.state;
    const end = sectionsOf(editor.doc)[2]!.to;
    editor.view.dispatch(editor.view.state.tr.insert(end, [schema.nodes.hr!.create(), schema.nodes.paragraph!.create(null, schema.text("Extra"))]));
    expect(titles()).toEqual(["Welcome", "Problem", "Plan", "Extra", "Budget", "Thanks"]);
    expect(heads().map((head) => head.querySelector(".kasten-sec-number")!.textContent)).toEqual(["1", "2", "3", "4", "5", "6"]);
    // A paragraph turned into a heading keeps its place in its card.
    editor.view.dispatch(editor.view.state.tr.setNodeMarkup(findText(editor.doc, "Extra") - 1, schema.nodes.heading!, { level: 3 }));
    expect(classes(".is-sec-start")).toContain("Extra");
    expect(titles()[3]).toBe("Extra");
    editor.view.dispatch(editor.view.state.tr.delete(sectionsOf(editor.doc)[3]!.divider!, sectionsOf(editor.doc)[3]!.divider! + 1));
    expect(heads()).toHaveLength(5);
  });

  it("folds a section from its bar, which shows it folded, and presents from it", () => {
    editor.open(FIVE);
    setSmart(editor.view, true);
    const fold = () => heads()[1]!.querySelector<HTMLButtonElement>(".kasten-sec-fold")!;
    expect(fold().getAttribute("aria-label")).toBe("Fold section");
    fold().click();
    expect(heads()[1]!.classList.contains("is-folded")).toBe(true);
    expect(fold().getAttribute("aria-label")).toBe("Unfold section");
    expect(fold().getAttribute("aria-expanded")).toBe("false");
    expect(classes(".kasten-section-hidden")).toEqual(["Problem", "slow noisy"]);
    // The card is its bar alone; the layout says so in its own bar, not in a row.
    expect(rows()).toBe(1);
    fold().click();
    expect(heads()[1]!.classList.contains("is-folded")).toBe(false);
    expect(dom().querySelectorAll(".kasten-section-hidden")).toHaveLength(0);

    heads()[3]!.querySelector<HTMLButtonElement>(".kasten-sec-present")!.click();
    expect(presentingAt(editor.view.state)).toBe(3);
    expect(shown()).toEqual(["Budget", "Money words."]);
    stopPresenting(editor.view);
  });

  it("folds the first section from its bar, which has no divider", () => {
    editor.open(FIVE);
    setSmart(editor.view, true);
    heads()[0]!.querySelector<HTMLButtonElement>(".kasten-sec-fold")!.click();
    expect(sectionsKey.getState(editor.view.state)!.folded.has(-1)).toBe(true);
    heads()[0]!.querySelector<HTMLButtonElement>(".kasten-sec-fold")!.click();
    expect(sectionsKey.getState(editor.view.state)!.folded.size).toBe(0);
  });

  it("gives an empty section a place to click, which starts a block in it", () => {
    editor.open("One.\n\n---\n\n---\n\nThree.\n");
    setSmart(editor.view, true);
    const foot = dom().querySelector<HTMLElement>(".kasten-sec-foot.is-empty");
    expect(foot).not.toBeNull();
    expect(sectionsOf(editor.doc)[1]!.blocks).toBe(0);
    foot!.click();
    expect(sectionsOf(editor.doc)[1]!.blocks).toBe(1);
    expect(dom().querySelector(".kasten-sec-foot.is-empty")).toBeNull();
    expect(editor.view.state.selection.$from.parent.type.name).toBe("paragraph");
    // Nothing typed, nothing written.
    expect(editor.save()).toBe("One.\n\n---\n\n---\n\nThree.\n");
    setSmart(editor.view, false);
  });

  it("scrolls to a section and puts the caret at its start", () => {
    editor.open(FIVE);
    expect(jumpToSection(editor.view, 2)).toBe(true);
    expect(editor.view.state.selection.from).toBe(sectionsOf(editor.doc)[2]!.from + 1);
    expect(jumpToSection(editor.view, 9)).toBe(false);
  });
});

describe("on a long page", () => {
  it("draws a few decorations for each section, never one for each block, so typing stays quick", () => {
    editor.open("x\n");
    const { schema } = editor.view.state;
    const blocks = [];
    for (let i = 0; i < 3000; i++) {
      blocks.push(schema.nodes.paragraph!.create(null, schema.text(`Paragraph number ${i} with a few words in it`)));
      if (i % 30 === 29) blocks.push(schema.nodes.hr!.create());
    }
    editor.view.dispatch(editor.view.state.tr.replaceWith(0, editor.view.state.doc.content.size, schema.nodes.doc!.create(null, blocks).content));
    editor.caret("number 100 ", false);
    // The best of three, so a busy machine does not fail a test about the work itself.
    const lap = (run: () => unknown) => Math.min(...[1, 2, 3].map(() => {
      const started = performance.now();
      run();
      return performance.now() - started;
    }));
    const type = () => editor.view.dispatch(editor.view.state.tr.insertText("z", editor.view.state.selection.from));
    const plain = lap(type);
    setSmart(editor.view, true);
    const decorations = sectionsKey.getState(editor.view.state)!.smart.decorations.find().length;
    // A title bar, a bottom edge and the first and last blocks of 101 sections.
    expect(decorations).toBeLessThanOrEqual(101 * 4);
    const cards = lap(type);
    expect(cards, `typing took ${Math.round(cards)} ms in the layout, ${Math.round(plain)} ms without`).toBeLessThan(Math.max(plain * 40, 600));
    setSmart(editor.view, false);
  });
});

describe("presenting a page", () => {
  afterEach(() => {
    stopPresenting(editor.view);
    setSmart(editor.view, false);
  });

  it("shows one section at a time, read-only, and gives the page back", () => {
    editor.open(FIVE);
    expect(startPresenting(editor.view)).toBe(5);
    expect(dom().classList.contains("kasten-is-presenting")).toBe(true);
    expect(editor.view.editable).toBe(false);
    expect(shown()).toEqual(["Welcome", "Intro line."]);
    expect(presenting()).toMatchObject({ index: 0, count: 5, title: "Welcome" });

    showSlide(editor.view, 2);
    expect(shown()).toEqual(["Plan", "Book the guesthouse."]);
    expect(presenting()).toMatchObject({ index: 2, count: 5, title: "Plan" });
    // Past either end stays at the end.
    showSlide(editor.view, 99);
    expect(presenting()).toMatchObject({ index: 4, title: "Thanks" });
    showSlide(editor.view, -3);
    expect(presenting()).toMatchObject({ index: 0 });
    // The Markdown is what it was the whole time.
    expect(editor.save()).toBe(FIVE);

    stopPresenting(editor.view);
    expect(editor.view.editable).toBe(true);
    expect(dom().classList.contains("kasten-is-presenting")).toBe(false);
    expect(shown()).toEqual([]);
    expect(presenting()).toBeNull();
  });

  it("starts from a divider's label, with its own button, on the plain page", () => {
    editor.open(FIVE);
    const dividers = [...dom().querySelectorAll<HTMLElement>(".kasten-divider:not(.is-nested)")];
    expect(dividers).toHaveLength(4);
    const button = dividers[2]!.querySelector<HTMLButtonElement>(".kasten-divider-present")!;
    expect(button.getAttribute("aria-label")).toBe("Present from here");
    button.click();
    expect(presentingAt(editor.view.state)).toBe(3);
    expect(shown()).toEqual(["Budget", "Money words."]);
  });

  it("starts at the slide that holds a position, and nowhere when the page has nothing to show", () => {
    editor.open(FIVE);
    const third = sectionsOf(editor.doc)[2]!;
    expect(startPresenting(editor.view, third.divider)).toBe(5);
    expect(presentingAt(editor.view.state)).toBe(2);
    stopPresenting(editor.view);
    expect(startPresenting(editor.view, findText(editor.doc, "Questions?"))).toBe(5);
    expect(presentingAt(editor.view.state)).toBe(4);
    stopPresenting(editor.view);

    editor.open("");
    expect(startPresenting(editor.view)).toBe(0);
    expect(presentingAt(editor.view.state)).toBeNull();
    expect(editor.view.editable).toBe(true);
  });

  it("shows a folded section when it is its turn, and folds it again afterwards", () => {
    editor.open(FIVE);
    setFolded(editor.view, [sectionsOf(editor.doc)[1]!.divider!], true);
    expect(rows()).toBe(1);
    startPresenting(editor.view);
    showSlide(editor.view, 1);
    expect(shown()).toEqual(["Problem", "slow noisy"]);
    expect(dom().querySelectorAll(".kasten-section-hidden")).toHaveLength(0);
    expect(rows()).toBe(0);
    stopPresenting(editor.view);
    expect(rows()).toBe(1);
  });

  it("shows only the slide when the page is in the sections layout, and the cards again afterwards", () => {
    editor.open(FIVE);
    setSmart(editor.view, true);
    expect(heads()).toHaveLength(5);
    startPresenting(editor.view);
    expect(heads()).toHaveLength(0);
    expect(dom().querySelector(".is-sec-start")).toBeNull();
    expect(shown()).toEqual(["Welcome", "Intro line."]);
    stopPresenting(editor.view);
    expect(heads()).toHaveLength(5);
  });

  it("marks nothing to hide when the slide is the whole page", () => {
    editor.open("# Only a title\n\nand words\n");
    expect(startPresenting(editor.view)).toBe(1);
    expect(dom().classList.contains("kasten-slide-whole")).toBe(true);
    expect(shown()).toEqual([]);
    stopPresenting(editor.view);
    expect(dom().classList.contains("kasten-slide-whole")).toBe(false);
    // One slide among sections that are empty is not the whole page: the rest is hidden.
    editor.open("Words.\n\n---\n\n---\n");
    expect(startPresenting(editor.view)).toBe(1);
    expect(dom().classList.contains("kasten-slide-whole")).toBe(false);
    expect(shown()).toEqual(["Words."]);
  });

  it("cuts a page with no divider at its headings", () => {
    editor.open("# One\n\nfirst\n\n# Two\n\nsecond\n");
    expect(startPresenting(editor.view)).toBe(2);
    showSlide(editor.view, 1);
    expect(shown()).toEqual(["Two", "second"]);
    // One slide when there is nothing to cut at.
    stopPresenting(editor.view);
    editor.open("Just one block of words.\n");
    expect(startPresenting(editor.view)).toBe(1);
  });

  it("is reached through the page's registry, as the menus and the palette do", () => {
    editor.open(FIVE);
    expect(presentPage("another-page")).toBe(0);
    expect(presentPage("note-1")).toBe(5);
    stepPresenting("note-1", "next");
    stepPresenting("note-1", "next");
    expect(presenting()?.index).toBe(2);
    stepPresenting("note-1", "previous");
    expect(presenting()?.index).toBe(1);
    stepPresenting("note-1", "last");
    expect(presenting()?.index).toBe(4);
    stepPresenting("note-1", "first");
    expect(presenting()?.index).toBe(0);
    endPresenting("note-1");
    expect(presenting()).toBeNull();
    // Nothing to step when it is not presenting.
    stepPresenting("note-1", "next");
    expect(presenting()).toBeNull();
  });

  it("gives each slide's words as Markdown, for making a deck of them", () => {
    editor.open(FIVE);
    const texts = sectionTexts("note-1")!;
    expect(texts.map((t) => t.title)).toEqual(["Welcome", "Problem", "Plan", "Budget", "Thanks"]);
    expect(texts[1]!.markdown).toBe("## Problem\n\n- slow\n- noisy");
    expect(texts[0]!.markdown).toBe("# Welcome\n\nIntro line.");
    expect(sectionTexts("another-page")).toBeNull();
  });
});

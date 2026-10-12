// Sections from dividers: where a page splits and what a section is called,
// folding (which never touches the file), the guards that keep the caret
// and edits honest, and the folds kept per page.

import { TextSelection } from "@milkdown/kit/prose/state";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { findText, useTestEditor } from "../../../../test/editor";
import { markdownFixtures } from "../../../../test/fixtures";
import { splitFrontmatter } from "../../markdown/frontmatter";
import { aloneMarks } from "../blocks/alone";
import { foldAll, hasSections, isHidden, listSections, revealPos, setFolded, toggleFold } from "./api";
import { foldDecorations } from "./decorate";
import { MOST_PAGES, readFolds, writeFolds } from "./folds";
import { sectionsKey } from "./key";
import { firstDivider, sectionsOf, sectionTitle, START } from "./model";
import { foldAllSections } from "./registry";

const editor = useTestEditor({ foldKey: "note-1" });

const PAGE = [
  "Intro paragraph with several words in it to cut.",
  "",
  "---",
  "",
  "## Plan",
  "",
  "Book the guesthouse.",
  "",
  "***",
  "",
  "- a list",
  "- of items",
  "",
  "> a quote",
  "",
  "<details>",
  "<summary>Inside</summary>",
  "",
  "---",
  "",
  "</details>",
  "",
  "___",
  "",
  "Last words",
  "",
].join("\n");

const hidden = () => [...editor.view.dom.querySelectorAll(".kasten-section-hidden")];
const rows = () => [...editor.view.dom.querySelectorAll<HTMLElement>(".kasten-section-summary")].map((row) => row.textContent);

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("where a page splits", () => {
  it("cuts only at top-level dividers, whatever their marker", () => {
    editor.open(PAGE);
    const sections = sectionsOf(editor.doc);
    expect(sections).toHaveLength(4);
    expect(sections.map((s) => s.blocks)).toEqual([1, 2, 3, 1]);
    // A divider inside a toggle (or a list, or a quote) is just a line.
    expect(sections.map((s) => s.divider !== null)).toEqual([false, true, true, true]);
    expect(hasSections(editor.view.state)).toBe(true);
    expect(sections[0]!.divider).toBeNull();
    expect(sections[1]!.from).toBe(sections[1]!.divider! + 1);
    expect(sections[3]!.to).toBe(editor.doc.content.size);
  });

  it("does not take a heading's underline for a divider, nor a page without one for sections", () => {
    editor.open("Setext heading\n---\n\nBody.\n");
    expect(editor.doc.firstChild?.type.name).toBe("heading");
    expect(hasSections(editor.view.state)).toBe(false);
    expect(sectionsOf(editor.doc)).toHaveLength(1);
  });

  it("names a section by its first heading, else its first six words, else nothing", () => {
    editor.open(PAGE);
    expect(listSections(editor.view.state).map((s) => s.title)).toEqual(["Intro paragraph with several words in…", "Plan", "a list of items", "Last words"]);
    editor.open("One.\n\n---\n\n---\n\n\n\n---\n\n[[Trip plan|The trip]] and more\n");
    const titles = listSections(editor.view.state).map((s) => s.title);
    expect(titles[1]).toBe("Untitled section");
    expect(titles.at(-1)).toBe("The trip and more");
    expect(sectionTitle(editor.doc, sectionsOf(editor.doc)[0]!)).toBe("One.");
  });

  it("shows a divider's section title only on hover, and its button folds the section", () => {
    editor.open(PAGE);
    const dividers = [...editor.view.dom.querySelectorAll<HTMLElement>(".kasten-divider:not(.is-nested)")];
    expect(dividers).toHaveLength(3);
    // The one inside the toggle is only a line.
    expect(editor.view.dom.querySelectorAll(".kasten-divider.is-nested")).toHaveLength(1);
    expect(dividers[0]!.querySelector(".kasten-divider-title")!.textContent).toBe("");
    dividers[0]!.dispatchEvent(new MouseEvent("mouseenter"));
    expect(dividers[0]!.querySelector(".kasten-divider-title")!.textContent).toBe("Plan");
    const button = dividers[0]!.querySelector<HTMLButtonElement>(".kasten-divider-fold")!;
    expect(button.getAttribute("aria-label")).toBe("Fold section");
    button.click();
    expect(hidden().map((node) => node.textContent)).toEqual(["Plan", "Book the guesthouse."]);
    expect(editor.view.dom.querySelector(".kasten-divider.is-folded")).not.toBeNull();
    expect(dividers[0]!.querySelector(".kasten-divider-fold")!.getAttribute("aria-label")).toBe("Unfold section");
  });
});

describe("folding", () => {
  it("hides a section's blocks behind one row, and leaves the file as it was", () => {
    editor.open(PAGE);
    const second = sectionsOf(editor.doc)[1]!;
    setFolded(editor.view, [second.divider!], true);
    expect(hidden().map((node) => node.textContent)).toEqual(["Plan", "Book the guesthouse."]);
    expect(rows()).toEqual(["▸Plan· 2 blocks"]);
    expect(editor.save()).toBe(PAGE);
    // The row unfolds it.
    editor.view.dom.querySelector<HTMLElement>(".kasten-section-summary")!.click();
    expect(hidden()).toHaveLength(0);
    expect(rows()).toEqual([]);
  });

  it("folds the first section too, and every section at once", () => {
    editor.open(PAGE);
    setFolded(editor.view, [START], true);
    expect(rows()).toEqual(["▸Intro paragraph with several words in…· 1 block"]);
    expect(foldAll(editor.view, true)).toBe(4);
    expect(rows()).toHaveLength(4);
    expect(editor.save()).toBe(PAGE);
    expect(foldAll(editor.view, false)).toBe(4);
    expect(rows()).toEqual([]);
    expect(foldAll(editor.view, true)).toBe(4);
    toggleFold(editor.view, START);
    expect(rows()).toHaveLength(3);
  });

  it("leaves every fixture's bytes alone, folded or not", () => {
    for (const fixture of markdownFixtures().filter((f) => /thematic-breaks|sections/.test(f.name))) {
      const { prefix, body } = splitFrontmatter(fixture.text);
      editor.open(body);
      foldAll(editor.view, true);
      expect(prefix + editor.save(), fixture.name).toBe(fixture.text);
    }
  });

  it("folds nothing on a page with no divider", () => {
    editor.open("Just text.\n");
    expect(foldAll(editor.view, true)).toBe(0);
    setFolded(editor.view, [START], true);
    expect(rows()).toEqual([]);
    expect(hidden()).toHaveLength(0);
  });

  it("leaves a fold as it was when the page is edited elsewhere, and its row still unfolds it", () => {
    editor.open(PAGE);
    const sections = sectionsOf(editor.doc);
    setFolded(editor.view, [sections[1]!.divider!, sections[3]!.divider!], true);
    const before = sectionsKey.getState(editor.view.state)!;
    const row = editor.view.dom.querySelector(".kasten-section-summary")!;
    editor.caret("Intro", false);
    editor.type("More words above. ");
    editor.caret("a list", false);
    editor.type("And inside. ");
    const after = sectionsKey.getState(editor.view.state)!;
    // Made again only when a fold changes: the same rows, moved along.
    expect(after.rev).toBe(before.rev);
    expect(after.hidden).toHaveLength(2);
    expect(editor.view.dom.querySelector(".kasten-section-summary")).toBe(row);
    expect(rows()).toEqual(["▸Plan· 2 blocks", "▸Last words· 1 block"]);
    // The row knows where it is now: it unfolds its own section, not the one that was there.
    editor.view.dom.querySelector<HTMLElement>(".kasten-section-summary")!.click();
    expect(rows()).toEqual(["▸Last words· 1 block"]);
    expect(editor.save()).toContain("More words above. Intro");
  });

  it("follows the page as it is edited, and forgets a divider that is taken away", () => {
    editor.open(PAGE);
    const second = sectionsOf(editor.doc)[1]!;
    setFolded(editor.view, [second.divider!], true);
    // Typing above moves the fold with its divider.
    editor.caret("Intro", false);
    editor.type("More. ");
    expect(rows()).toEqual(["▸Plan· 2 blocks"]);
    const after = sectionsOf(editor.doc)[1]!;
    expect(sectionsKey.getState(editor.view.state)!.folded.has(after.divider!)).toBe(true);
    // Taking the divider away takes the fold with it.
    editor.view.dispatch(editor.view.state.tr.delete(after.divider!, after.divider! + 1));
    expect(rows()).toEqual([]);
    expect(sectionsKey.getState(editor.view.state)!.folded.size).toBe(0);
  });
});

describe("guards", () => {
  it("move the caret out of a folded section, in the direction it was going", () => {
    editor.open(PAGE);
    const [, second, third] = sectionsOf(editor.doc);
    setFolded(editor.view, [second!.divider!], true);
    const inside = findText(editor.doc, "Book the guesthouse") + 3;
    const { view } = editor;
    // Coming from above, it goes past the section.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, findText(editor.doc, "Intro"))));
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, inside)));
    expect(view.state.selection.from).toBeGreaterThan(third!.divider!);
    // Coming from below, it goes back before it.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, findText(editor.doc, "a list"))));
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, findText(editor.doc, "Book the guesthouse") + 2)));
    expect(view.state.selection.from).toBeLessThan(second!.divider!);
    expect(isHidden(view.state, view.state.selection.from)).toBe(false);
  });

  it("move a caret under a fold out of it, and never leave one in what is not shown", () => {
    editor.open(PAGE);
    editor.caret("Book the guesthouse", false);
    setFolded(editor.view, [sectionsOf(editor.doc)[1]!.divider!], true);
    expect(isHidden(editor.view.state, editor.view.state.selection.from)).toBe(false);
  });

  it("unfold a section an edit reaches, before the edit is seen", () => {
    editor.open(PAGE);
    const second = sectionsOf(editor.doc)[1]!;
    setFolded(editor.view, [second.divider!], true);
    const { view } = editor;
    view.dispatch(view.state.tr.insertText("Rewritten: ", findText(editor.doc, "Book the guesthouse")));
    expect(rows()).toEqual([]);
    expect(hidden()).toHaveLength(0);
    expect(editor.save()).toContain("Rewritten: Book the guesthouse.");
  });

  it("leave a section alone when the edit is somewhere else", () => {
    editor.open(PAGE);
    setFolded(editor.view, [sectionsOf(editor.doc)[1]!.divider!], true);
    editor.caret("Last words", false);
    editor.type("The ");
    editor.caret("Intro", false);
    editor.type("Well. ");
    expect(rows()).toEqual(["▸Plan· 2 blocks"]);
  });

  it("let a jump to a heading unfold what hides it", () => {
    editor.open(PAGE);
    const second = sectionsOf(editor.doc)[1]!;
    setFolded(editor.view, [second.divider!], true);
    expect(revealPos(editor.view, findText(editor.doc, "Plan"))).toBe(true);
    expect(rows()).toEqual([]);
    expect(revealPos(editor.view, findText(editor.doc, "Plan"))).toBe(false);
  });
});

describe("folds kept for a page", () => {
  it("come back when the page is opened again, found by title", () => {
    editor.open(PAGE);
    setFolded(editor.view, [sectionsOf(editor.doc)[1]!.divider!, START], true);
    expect(JSON.parse(localStorage.getItem("kasten.folds")!)).toEqual([["note-1", [["Intro paragraph with several words in…", 0], ["Plan", 0]]]]);
    editor.open(PAGE);
    expect(rows()).toEqual(["▸Intro paragraph with several words in…· 1 block", "▸Plan· 2 blocks"]);
    // A page whose sections are not those any more keeps what still fits.
    editor.open(PAGE.replace("## Plan", "## Budget"));
    expect(rows()).toEqual(["▸Intro paragraph with several words in…· 1 block"]);
    expect(JSON.parse(localStorage.getItem("kasten.folds")!)).toEqual([["note-1", [["Intro paragraph with several words in…", 0]]]]);
  });

  it("tell sections of the same title apart by which one it is", () => {
    const twice = "A\n\n---\n\n## Notes\n\nfirst\n\n---\n\n## Notes\n\nsecond\n";
    editor.open(twice);
    const sections = sectionsOf(editor.doc);
    setFolded(editor.view, [sections[2]!.divider!], true);
    expect(JSON.parse(localStorage.getItem("kasten.folds")!)[0][1]).toEqual([["Notes", 1]]);
    editor.open(twice);
    expect(hidden().map((node) => node.textContent)).toEqual(["Notes", "second"]);
  });

  it("forget a page when nothing is folded in it", () => {
    editor.open(PAGE);
    setFolded(editor.view, [START], true);
    expect(localStorage.getItem("kasten.folds")).not.toBeNull();
    foldAll(editor.view, false);
    expect(JSON.parse(localStorage.getItem("kasten.folds")!)).toEqual([]);
  });

  it("keep at most 300 pages, dropping the one used longest ago", () => {
    for (let i = 0; i < MOST_PAGES; i++) writeFolds(`page-${i}`, [{ title: "T", nth: 0 }]);
    expect(readFolds("page-0")).toEqual([{ title: "T", nth: 0 }]);
    writeFolds("one-more", [{ title: "T", nth: 0 }]);
    const kept = (JSON.parse(localStorage.getItem("kasten.folds")!) as [string][]).map((entry) => entry[0]);
    expect(kept).toHaveLength(MOST_PAGES);
    // Reading page-0 counted as using it, so page-1 was the oldest.
    expect(kept).toContain("page-0");
    expect(kept).not.toContain("page-1");
    expect(kept.at(-1)).toBe("one-more");
  });

  it("are fine without storage", () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("blocked");
    };
    try {
      expect(readFolds("note-1")).toEqual([]);
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});

describe("on a big page", () => {
  it("finds sections, links alone on a line and folds in one quick pass over the top-level blocks", () => {
    editor.open("x\n");
    const { schema } = editor.view.state;
    const blocks = [];
    for (let i = 0; i < 6000; i++) {
      blocks.push(schema.nodes.paragraph!.create(null, schema.text(`Paragraph number ${i} with a few words in it`)));
      if (i % 30 === 29) blocks.push(schema.nodes.hr!.create());
    }
    const doc = schema.nodes.doc!.create(null, blocks);
    // The best of three, so a busy machine does not fail a test about the work itself.
    const lap = (run: () => unknown) =>
      Math.min(
        ...[1, 2, 3].map(() => {
          const started = performance.now();
          run();
          return Math.round(performance.now() - started);
        }),
      );
    let sections: ReturnType<typeof sectionsOf> = [];
    const split = lap(() => (sections = sectionsOf(doc)));
    const alone = lap(() => aloneMarks(doc));
    const first = lap(() => firstDivider(doc));
    // Ten sections folded, 300 blocks hidden: ProseMirror's own set-building cost grows with the hidden blocks times the page's.
    let folded: ReturnType<typeof foldDecorations> | null = null;
    const fold = lap(() => (folded = foldDecorations(doc, new Set(sections.slice(0, 10).map((s) => (s.divider === null ? START : s.divider))))));
    expect(sections).toHaveLength(201);
    expect(folded!.hidden).toHaveLength(10);
    // Opening a note stays under 50 ms: what a page with no fold costs is a small part of that.
    expect(split + alone + first, `split ${split}, alone ${alone}, first ${first}, fold ${fold}`).toBeLessThan(50);
    // Folding is done when a fold changes or a page opens, not as you type (see "leaves a fold as it was").
    expect(fold, `split ${split}, alone ${alone}, first ${first}, fold ${fold}`).toBeLessThan(150);
  });
});

describe("the sections of the page in front", () => {
  it("fold all and unfold all, for the palette and the page menu", () => {
    editor.open(PAGE);
    expect(foldAllSections(true)).toBe(4);
    expect(rows()).toHaveLength(4);
    expect(foldAllSections(false, "note-1")).toBe(4);
    expect(rows()).toHaveLength(0);
    expect(foldAllSections(true, "another-page")).toBe(0);
    editor.open("No dividers here.\n");
    expect(foldAllSections(true)).toBe(0);
  });
});

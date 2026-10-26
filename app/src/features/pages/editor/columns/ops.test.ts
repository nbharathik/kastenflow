// Making columns, moving blocks across them, setting the ratio, and how the
// rest of the page treats a columns block (one block, one stack below 640 px).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { splitFrontmatter } from "../../markdown/frontmatter";
import { slideOf } from "../../present/section-slides";
import { openNote } from "../session";
import { choiceCommand } from "../menus/slash";
import { slashChoices } from "../menus/catalog";
import { blockUnit } from "../menus/units";
import { sectionsOf } from "../sections/model";
import { moveBlockTo } from "../menus/move-block";
import { caretAt, columnsBlocks, findText, fixture, makeEditor, type Harness } from "./harness";
import { ratioAfterDrag } from "./drag";
import { hasNestedColumns } from "./guard";
import { setColumnsRatio } from "./ops";
import { formatRatio, openerText, parseRatio } from "./serialize";

let h: Harness;
beforeAll(async () => {
  h = await makeEditor();
});
afterAll(async () => {
  await h.destroy();
});

const altArrow = (key: "ArrowLeft" | "ArrowRight") => {
  const view = h.view();
  const event = new KeyboardEvent("keydown", { key, altKey: true, cancelable: true });
  return view.someProp("handleKeyDown", (f) => f(view, event)) === true;
};

describe("moving a block across columns", () => {
  it("Alt+Left moves the block to the column on its left and rewrites only the blocks that changed", () => {
    const text = fixture("01-two-columns.md");
    const note = openNote(h.crepe, text);
    caretAt(h.view(), "Right column text.");
    expect(altArrow("ArrowLeft")).toBe(true);
    expect(note.save()).toBe(
      [
        "# Plan",
        "",
        "<!-- columns -->",
        "",
        "Right column text.",
        "",
        "Left column text with **bold** and a [[link]].",
        "",
        "A second paragraph on the left.",
        "",
        "<!-- column -->",
        "",
        "## A heading on the right",
        "",
        "<!-- /columns -->",
        "",
        "After the columns.",
        "",
      ].join("\n"),
    );
  });

  it("Alt+Right moves it to the right, and a later Alt+Left puts it back byte for byte", () => {
    const text = fixture("01-two-columns.md");
    const note = openNote(h.crepe, text);
    caretAt(h.view(), "A second paragraph");
    expect(altArrow("ArrowRight")).toBe(true);
    // It lands at the same place in the order: second.
    expect(note.save()).toContain("<!-- column -->\n\nRight column text.\n\nA second paragraph on the left.\n\n## A heading on the right\n\n<!-- /columns -->");
    expect(altArrow("ArrowLeft")).toBe(true);
    expect(note.save()).toBe(text);
  });

  it("does nothing at the last or first column, or outside columns", () => {
    openNote(h.crepe, fixture("01-two-columns.md"));
    caretAt(h.view(), "Left column text");
    expect(altArrow("ArrowLeft")).toBe(false);
    caretAt(h.view(), "Right column text");
    expect(altArrow("ArrowRight")).toBe(false);
    caretAt(h.view(), "After the columns");
    expect(altArrow("ArrowRight")).toBe(false);
  });

  it("a block that leaves a column empties it without losing the column", () => {
    const text = fixture("06-empty-columns.md");
    const note = openNote(h.crepe, text);
    caretAt(h.view(), "Only the right has text.");
    expect(altArrow("ArrowLeft")).toBe(true);
    const saved = note.save();
    expect(saved).toContain("<!-- columns -->\n\nOnly the right has text.\n\n<!-- column -->\n\n<!-- column -->\n\n<!-- /columns -->");
    expect(columnsBlocks(h.view().state.doc)[0]!.node.childCount).toBe(3);
  });
});

describe("the ratio", () => {
  it("reads and writes the numbers after the word columns", () => {
    expect(parseRatio("40/60", 2)).toEqual([40, 60]);
    expect(parseRatio("", 3)).toEqual([1, 1, 1]);
    // A ratio for another number of columns, or with a zero, reads as equal widths.
    expect(parseRatio("40/60", 3)).toEqual([1, 1, 1]);
    expect(parseRatio("0/100", 2)).toEqual([1, 1]);
    expect(formatRatio([40, 60])).toBe("40/60");
    expect(formatRatio([1, 1])).toBe("");
    expect(openerText("")).toBe("<!-- columns -->");
    expect(openerText("40/60")).toBe("<!-- columns 40/60 -->");
  });

  it("dragging a gutter moves the cut and keeps every column at least 10%", () => {
    expect(ratioAfterDrag([50, 50], 0, 10)).toEqual([60, 40]);
    expect(ratioAfterDrag([50, 50], 0, -70)).toEqual([10, 90]);
    expect(ratioAfterDrag([20, 30, 50], 1, 15)).toEqual([20, 45, 35]);
    expect(ratioAfterDrag([1, 1, 1], 0, 10).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("rewrites only the opening marker", () => {
    const text = fixture("02-three-columns-ratio.md");
    const note = openNote(h.crepe, text);
    const [block] = columnsBlocks(h.view().state.doc);
    expect(setColumnsRatio(block!.pos, "10/40/50")(h.view().state, h.view().dispatch)).toBe(true);
    expect(note.save()).toBe(text.replace("<!-- columns 20/30/50 -->", "<!-- columns 10/40/50 -->"));
  });

  it("writes a ratio where there was none, and removes it again for equal widths", () => {
    const text = fixture("01-two-columns.md");
    const note = openNote(h.crepe, text);
    const [block] = columnsBlocks(h.view().state.doc);
    setColumnsRatio(block!.pos, "30/70")(h.view().state, h.view().dispatch);
    expect(note.save()).toBe(text.replace("<!-- columns -->", "<!-- columns 30/70 -->"));
    setColumnsRatio(block!.pos, "")(h.view().state, h.view().dispatch);
    expect(note.save()).toBe(text);
  });

  it("keeps odd spelling of a marker that did not change", () => {
    const text = fixture("07-odd-spacing.md");
    const note = openNote(h.crepe, text);
    const [block] = columnsBlocks(h.view().state.doc);
    setColumnsRatio(block!.pos, "30/70")(h.view().state, h.view().dispatch);
    expect(note.save()).toBe(text);
    setColumnsRatio(block!.pos, "40/60")(h.view().state, h.view().dispatch);
    // The block was written again, so the line under its closing marker gets the blank line it lacked.
    expect(note.save()).toBe(text.replace("<!--columns 30/70-->", "<!-- columns 40/60 -->").replace("<!--/columns-->\nStraight", "<!--/columns-->\n\nStraight"));
  });
});

describe("the gutter and the block handle", () => {
  it("arrow keys on a focused gutter move it by 5%, Home gives equal widths again", () => {
    const text = fixture("01-two-columns.md");
    const note = openNote(h.crepe, text);
    const gutter = h.view().dom.querySelector<HTMLElement>(".kasten-columns-gutter")!;
    expect(gutter.getAttribute("role")).toBe("separator");
    expect(gutter.getAttribute("aria-label")).toBe("Resize columns 1 and 2");
    gutter.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    expect(note.save()).toBe(text.replace("<!-- columns -->", "<!-- columns 55/45 -->"));
    expect(h.view().dom.querySelector<HTMLElement>(".kasten-columns-body")!.style.getPropertyValue("--kf-columns")).toBe("minmax(0, 55fr) minmax(0, 45fr)");
    h.view().dom.querySelector<HTMLElement>(".kasten-columns-gutter")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }));
    expect(note.save()).toBe(text);
  });

  it("a block dragged by its handle into another column changes only the lines that moved", () => {
    const text = fixture("01-two-columns.md");
    const note = openNote(h.crepe, text);
    const view = h.view();
    const moved = blockUnit(view.state.doc, caretAt(view, "A second paragraph"))!;
    const heading = view.state.doc.resolve(findText(view.state.doc, "A heading on the right"));
    const tr = moveBlockTo(view.state, moved, heading.after());
    expect(tr).not.toBeNull();
    view.dispatch(tr!);
    expect(note.save()).toBe(
      text.replace("A second paragraph on the left.\n\n", "").replace("## A heading on the right\n", "## A heading on the right\n\nA second paragraph on the left.\n"),
    );
  });

  it("refuses a columns block dropped into a column", () => {
    openNote(h.crepe, fixture("01-two-columns.md"));
    const view = h.view();
    const { node: outer, pos } = columnsBlocks(view.state.doc)[0]!;
    const inside = pos + 2;
    view.dispatch(view.state.tr.insert(inside, outer));
    expect(columnsBlocks(view.state.doc)).toHaveLength(1);
    expect(hasNestedColumns(view.state.doc)).toBe(false);
  });
});

describe("making columns", () => {
  const choice = (key: string) => slashChoices().find((c) => c.key === key)!;

  it("offers 2 and 3 columns in the slash menu, found by 'columns'", () => {
    expect(choice("columns-2").label).toBe("2 columns");
    expect(choice("columns-3").label).toBe("3 columns");
    expect(choice("columns-2").keywords).toContain("columns 2");
  });

  it("turns an empty line into columns with a line to type in each", () => {
    const note = openNote(h.crepe, "");
    choiceCommand(choice("columns-3"), h.crepe.editor.ctx)(h.view().state, h.view().dispatch, h.view());
    const [block] = columnsBlocks(h.view().state.doc);
    expect(block!.node.childCount).toBe(3);
    expect(h.view().state.selection.$from.node(-1).type.name).toBe("column");
    expect(note.save()).toBe("<!-- columns -->\n\n<!-- column -->\n\n<!-- column -->\n\n<!-- /columns -->\n");
  });

  it("a new columns block on a CRLF page is written with CRLF only", () => {
    const note = openNote(h.crepe, "Some text\r\n\r\nMore.\r\n");
    caretAt(h.view(), "Some text");
    choiceCommand(choice("columns-2"), h.crepe.editor.ctx)(h.view().state, h.view().dispatch, h.view());
    const out = note.save();
    expect(out).toContain("<!-- columns -->");
    expect(out.replace(/\r\n/g, "")).not.toMatch(/\n/);
  });

  it("does not offer columns inside a column", () => {
    openNote(h.crepe, fixture("01-two-columns.md"));
    caretAt(h.view(), "Right column text.");
    expect(choiceCommand(choice("columns-2"), h.crepe.editor.ctx)(h.view().state, undefined, h.view())).toBe(false);
  });

  it("puts columns below a line that has text", () => {
    openNote(h.crepe, "Some text\n");
    caretAt(h.view(), "Some text");
    choiceCommand(choice("columns-2"), h.crepe.editor.ctx)(h.view().state, h.view().dispatch, h.view());
    const names: string[] = [];
    h.view().state.doc.forEach((n) => names.push(n.type.name));
    expect(names.slice(0, 2)).toEqual(["paragraph", "columns"]);
  });
});

describe("the rest of the page", () => {
  it("a columns block is one block for sections: a divider inside a column cuts nothing", () => {
    openNote(h.crepe, splitFrontmatter(fixture("11-toggle-callout-inside.md")).body);
    const sections = sectionsOf(h.view().state.doc);
    expect(sections).toHaveLength(1);
    expect(h.view().state.doc.firstChild!.type.name).toBe("columns");
  });

  it("blocks inside a column have handles of their own; the columns block has one too", () => {
    openNote(h.crepe, fixture("01-two-columns.md"));
    const { doc } = h.view().state;
    const inner = blockUnit(doc, caretAt(h.view(), "Right column text."))!;
    expect(inner.node.type.name).toBe("paragraph");
    const [block] = columnsBlocks(doc);
    expect(blockUnit(doc, block!.pos + 1)!.node.type.name).toBe("columns");
  });

  it("a slide reads the columns in order and shows no markers", () => {
    const slide = slideOf({ title: "T", markdown: "<!-- columns 40/60 -->\n\n- a\n\n<!-- column -->\n\n- b\n\nProse in the right column.\n\n<!-- /columns -->" } as never);
    expect(slide.body).toBe("- a\n- b");
    expect(slide.notes).toBe("Prose in the right column.");
  });

  it("stacks below 640 px with design tokens only", () => {
    const css = readFileSync(join(import.meta.dirname, "columns.css"), "utf8");
    expect(css).toMatch(/@media \(max-width: 639px\)/);
    expect(css).toMatch(/@container [^{]*max-width: 639px/);
    expect(css).toMatch(/grid-template-columns: 1fr/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  });
});

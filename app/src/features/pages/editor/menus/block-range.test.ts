// Several blocks selected at once: the selection itself (modelled on the
// table's CellSelection), growing it with the keys and the mouse, and what the
// menu and the keys do to all of them in one step.

import { undo } from "@milkdown/kit/prose/history";
import type { Node } from "@milkdown/kit/prose/model";
import { NodeSelection, Selection, TextSelection } from "@milkdown/kit/prose/state";
import { describe, expect, it } from "vitest";

import { useTestEditor } from "../../../../test/editor";
import { setFolded } from "../sections/api";
import { sectionsOf } from "../sections/model";
import { BlockRangeSelection, blocksIn, blocksOfSelection, pickedBlocks, rangeBetween, selectBlocks, shiftClickBlocks } from "./block-range";
import { extendBlockSelection } from "./block-nav";
import { colorBlockRange, deleteBlocks, duplicateBlocks, groupIntoToggle } from "./range-ops";
import { moveBlocksTo } from "./move-blocks";
import { turnBlocksInto } from "./turn-blocks";
import { blockUnit } from "./units";

const editor = useTestEditor();
const BODY = "A\n\nB\n\nC\n\nD\n";

/** The first node (at any depth) that `match` accepts. */
function find(doc: Node, match: (node: Node) => boolean): { pos: number; node: Node } {
  let found: { pos: number; node: Node } | null = null;
  doc.descendants((node, pos) => {
    if (!found && match(node)) found = { pos, node };
    return !found;
  });
  if (!found) throw new Error("not found");
  return found;
}

/** The position before the block (as the handle sees it) holding the paragraph `text`. */
const unit = (text: string) => blockUnit(editor.doc, find(editor.doc, (n) => n.type.name === "paragraph" && n.textContent === text).pos)!.pos;

const select = (selection: Selection | null) => {
  editor.view.dispatch(editor.view.state.tr.setSelection(selection!));
  return editor.view.state.selection;
};

const texts = (selection: Selection) => (selection instanceof BlockRangeSelection ? selection.blocks().map((b) => b.node.textContent) : [(selection as NodeSelection).node.textContent]);
const range = () => pickedBlocks(editor.view.state.selection)!;
/** The top-level block types, leaving out the empty paragraph the editor keeps after a list at the end. */
const typesOf = () => {
  const types = editor.types();
  const last = editor.doc.lastChild;
  if (types.length > 1 && last?.type.name === "paragraph" && last.content.size === 0) types.pop();
  return types.join(",");
};

describe("a range of blocks", () => {
  it("runs from before the first block to after the last, between siblings, tinted, with the browser's selection hidden", () => {
    editor.open(BODY);
    const selection = select(rangeBetween(editor.doc, unit("A"), unit("C")));
    expect(selection).toBeInstanceOf(BlockRangeSelection);
    expect(texts(selection)).toEqual(["A", "B", "C"]);
    expect(selection.from).toBe(unit("A"));
    expect(selection.to).toBe(unit("D"));
    expect(editor.view.dom.querySelectorAll(".kasten-range-picked")).toHaveLength(3);
    expect(selection.visible).toBe(false);
    // One block is selected whole, as ProseMirror does.
    expect(select(rangeBetween(editor.doc, unit("B"), unit("B")))).toBeInstanceOf(NodeSelection);
    expect(editor.view.dom.querySelectorAll(".kasten-range-picked")).toHaveLength(0);
    expect(editor.save()).toBe(BODY);
  });

  it("takes the smallest range of siblings that holds both ends, at any depth", () => {
    editor.open("- One\n- Two\n- Three\n\nAfter\n");
    const items = rangeBetween(editor.doc, unit("One"), unit("Two"))!;
    expect(texts(items)).toEqual(["One", "Two"]);
    // From an item to a block after the list: the list and that block.
    const wide = rangeBetween(editor.doc, unit("Two"), unit("After"))!;
    expect(wide.$from.depth).toBe(0);
    expect(wide.$from.parent.type.name).toBe("doc");
    expect(blocksIn(editor.doc, pickedBlocks(wide)!).map((n) => n.type.name)).toEqual(["bullet_list", "paragraph"]);
    // Dragging back up gives the same blocks, the other way round.
    const back = rangeBetween(editor.doc, unit("After"), unit("Two")) as BlockRangeSelection;
    expect(back.anchor).toBeGreaterThan(back.head);
    expect(pickedBlocks(back)).toEqual(pickedBlocks(wide));
  });

  it("round-trips through JSON, follows edits, and falls back to the caret when its blocks go", () => {
    editor.open(BODY);
    const selection = select(rangeBetween(editor.doc, unit("B"), unit("C"))) as BlockRangeSelection;
    expect(Selection.fromJSON(editor.doc, selection.toJSON()).eq(selection)).toBe(true);
    expect(selection.toJSON()).toMatchObject({ type: "blockRange" });
    // A block added above moves it along; so does its bookmark (what undo restores).
    const { view } = editor;
    const add = view.state.tr.insert(0, view.state.schema.nodes.paragraph!.create(null, view.state.schema.text("New")));
    const bookmark = selection.getBookmark().map(add.mapping);
    view.dispatch(add);
    expect(texts(view.state.selection)).toEqual(["B", "C"]);
    expect(bookmark.resolve(view.state.doc).eq(view.state.selection)).toBe(true);
    // Delete its blocks: the selection becomes a caret near them.
    view.dispatch(view.state.tr.delete(unit("B"), unit("D")));
    expect(view.state.selection).not.toBeInstanceOf(BlockRangeSelection);
    expect(view.state.selection.empty).toBe(true);
  });
});

describe("growing it with the keys", () => {
  it("extends and shrinks one block at a time, from either end", () => {
    editor.open(BODY);
    select(NodeSelection.create(editor.doc, unit("B")));
    editor.press("ArrowDown", { shiftKey: true });
    expect(texts(editor.view.state.selection)).toEqual(["B", "C"]);
    editor.press("ArrowDown", { shiftKey: true });
    expect(texts(editor.view.state.selection)).toEqual(["B", "C", "D"]);
    editor.press("ArrowDown", { shiftKey: true });
    expect(texts(editor.view.state.selection)).toEqual(["B", "C", "D"]);
    editor.press("ArrowUp", { shiftKey: true });
    editor.press("ArrowUp", { shiftKey: true });
    expect(texts(editor.view.state.selection)).toEqual(["B"]);
    expect(editor.view.state.selection).toBeInstanceOf(NodeSelection);
    // Up from one block grows upwards, and Down shrinks it again.
    editor.press("ArrowUp", { shiftKey: true });
    expect(texts(editor.view.state.selection)).toEqual(["A", "B"]);
    editor.press("ArrowDown", { shiftKey: true });
    expect(texts(editor.view.state.selection)).toEqual(["B"]);
  });

  it("moves to the block beyond the range with a plain arrow, and leaves text selection alone", () => {
    editor.open(BODY);
    select(rangeBetween(editor.doc, unit("B"), unit("C")));
    editor.press("ArrowDown");
    expect(texts(editor.view.state.selection)).toEqual(["D"]);
    select(rangeBetween(editor.doc, unit("B"), unit("C")));
    editor.press("ArrowUp");
    expect(texts(editor.view.state.selection)).toEqual(["A"]);
    editor.caret("B");
    expect(extendBlockSelection(1)(editor.view.state)).toBe(false);
  });

  it("climbs to the list when it grows past its edge, and goes on among its siblings", () => {
    editor.open("Before\n\n- a\n- b\n- c\n\nAfter\n");
    const { view } = editor;
    const list = () => find(view.state.doc, (n) => n.type.name === "bullet_list").node;
    select(NodeSelection.create(editor.doc, unit("c")));
    editor.press("ArrowDown", { shiftKey: true });
    expect(view.state.selection).toBeInstanceOf(NodeSelection);
    expect((view.state.selection as NodeSelection).node).toBe(list());
    editor.press("ArrowDown", { shiftKey: true });
    expect(blocksIn(view.state.doc, range()).map((n) => n.type.name)).toEqual(["bullet_list", "paragraph"]);
    // The same at the top of the list.
    select(NodeSelection.create(editor.doc, unit("a")));
    editor.press("ArrowUp", { shiftKey: true });
    expect((view.state.selection as NodeSelection).node).toBe(list());
  });

  it("skips what a folded section hides when stepping", () => {
    editor.open("One\n\n---\n\nTwo\n\n---\n\nThree\n");
    setFolded(editor.view, [sectionsOf(editor.doc)[1]!.divider!], true);
    select(NodeSelection.create(editor.doc, unit("One")));
    editor.press("ArrowDown");
    // The divider is a block, and the folded section's text is not stepped on.
    expect(editor.view.state.selection).toBeInstanceOf(NodeSelection);
    expect((editor.view.state.selection as NodeSelection).node.type.name).toBe("hr");
    editor.press("ArrowDown");
    expect(texts(editor.view.state.selection)).not.toEqual(["Two"]);
  });

  it("ignores typing, edits on Enter, and leaves on Escape", () => {
    editor.open(BODY);
    select(rangeBetween(editor.doc, unit("A"), unit("B")));
    editor.press("x");
    editor.press("Shift", { shiftKey: true });
    expect(editor.save()).toBe(BODY);
    expect(editor.view.state.selection).toBeInstanceOf(BlockRangeSelection);
    editor.press("Escape");
    expect(editor.view.state.selection).toBeInstanceOf(TextSelection);
    // The caret is at the end of the last block that was selected.
    expect(editor.view.state.selection.from).toBe(unit("C") - 1);
    select(rangeBetween(editor.doc, unit("A"), unit("B")));
    editor.press("Enter");
    expect(editor.view.state.selection).toBeInstanceOf(TextSelection);
    expect(editor.save()).toBe(BODY);
  });

  it("grows with Shift+click from where it began", () => {
    editor.open(BODY);
    const { view } = editor;
    const where = (text: string) => ({ pos: find(view.state.doc, (n) => n.isText && n.text === text).pos + 1, inside: unit(text) });
    view.posAtCoords = ((coords: { top: number }) => where(["A", "B", "C", "D"][coords.top]!)) as never;
    select(NodeSelection.create(editor.doc, unit("B")));
    expect(shiftClickBlocks(view, { clientX: 0, clientY: 3 })).toBe(true);
    expect(texts(view.state.selection)).toEqual(["B", "C", "D"]);
    expect(shiftClickBlocks(view, { clientX: 0, clientY: 0 })).toBe(true);
    expect(texts(view.state.selection)).toEqual(["A", "B"]);
    // With text selected, a Shift+click is the editor's.
    editor.caret("B");
    expect(shiftClickBlocks(view, { clientX: 0, clientY: 3 })).toBe(false);
  });
});

describe("what it does to all the blocks", () => {
  it("deletes them in one step that one undo brings back, with parents it empties", () => {
    editor.open(BODY);
    const { view } = editor;
    select(rangeBetween(editor.doc, unit("B"), unit("C")));
    editor.press("Backspace");
    expect(editor.save()).toBe("A\n\nD\n");
    expect(undo(view.state, view.dispatch)).toBe(true);
    expect(editor.save()).toBe(BODY);

    editor.open("- a\n- b\n\nAfter\n");
    select(rangeBetween(editor.doc, unit("a"), unit("b")));
    editor.press("Delete");
    expect(editor.save()).toBe("After\n");
    editor.open("- a\n- b\n- c\n");
    select(rangeBetween(editor.doc, unit("a"), unit("b")));
    expect(deleteBlocks(range())(view.state, view.dispatch)).toBe(true);
    expect(editor.save()).toBe("- c\n");
  });

  it("copies them below themselves and selects the copies", () => {
    editor.open(BODY);
    select(rangeBetween(editor.doc, unit("B"), unit("C")));
    editor.press("d", { ctrlKey: true });
    expect(editor.save()).toBe("A\n\nB\n\nC\n\nB\n\nC\n\nD\n");
    const picked = range();
    expect(picked.count).toBe(2);
    expect(picked.from).toBe(editor.doc.child(0).nodeSize + editor.doc.child(1).nodeSize + editor.doc.child(2).nodeSize);
    expect(duplicateBlocks(picked)(editor.view.state)).toBe(true);
  });

  it("turns every block into the kind, and undoes as one", () => {
    const { view } = editor;
    const turn = (kind: Parameters<typeof turnBlocksInto>[2]) => {
      const tr = turnBlocksInto(view.state, range(), kind)!;
      view.dispatch(tr);
    };
    editor.open(BODY);
    select(rangeBetween(editor.doc, unit("B"), unit("D")));
    turn("h2");
    expect(editor.save()).toBe("A\n\n## B\n\n## C\n\n## D\n");
    expect(texts(view.state.selection)).toEqual(["B", "C", "D"]);
    expect(undo(view.state, view.dispatch)).toBe(true);
    expect(editor.save()).toBe(BODY);

    select(rangeBetween(editor.doc, unit("A"), unit("C")));
    turn("bullet");
    expect(typesOf()).toBe("bullet_list,paragraph");
    expect(editor.doc.firstChild!.childCount).toBe(3);
    // Back to text, then a to-do list, a quote, a callout.
    select(selectBlocks(editor.doc, 0, editor.doc.firstChild!.nodeSize));
    turn("text");
    expect(typesOf()).toBe("paragraph,paragraph,paragraph,paragraph");
    select(rangeBetween(editor.doc, unit("A"), unit("B")));
    turn("todo");
    expect(editor.save()).toMatch(/^- \[ \] A\n- \[ \] B\n/);
    select(rangeBetween(editor.doc, unit("C"), unit("D")));
    turn("quote");
    expect(typesOf()).toBe("bullet_list,blockquote");
    expect(editor.doc.child(1).childCount).toBe(2);
    select(NodeSelection.create(editor.doc, editor.doc.firstChild!.nodeSize));
    turn("callout");
    expect(typesOf()).toBe("bullet_list,callout");
    expect(editor.doc.child(1).childCount).toBe(2);
  });

  it("turns some of a list's items, splitting the list around them, or retypes them in place", () => {
    const { view } = editor;
    editor.open("- a\n- b\n- c\n- d\n");
    select(rangeBetween(editor.doc, unit("b"), unit("c")));
    view.dispatch(turnBlocksInto(view.state, range(), "h3")!);
    expect(typesOf()).toBe("bullet_list,heading,heading,bullet_list");
    expect(editor.save()).toBe("- a\n\n### b\n\n### c\n\n- d\n");
    editor.open("- a\n- b\n- c\n");
    select(rangeBetween(editor.doc, unit("a"), unit("b")));
    view.dispatch(turnBlocksInto(view.state, range(), "numbered")!);
    expect(editor.doc.firstChild!.type.name).toBe("ordered_list");
    expect(editor.save()).toBe("1. a\n2. b\n3. c\n");
    select(rangeBetween(editor.doc, unit("a"), unit("b")));
    view.dispatch(turnBlocksInto(view.state, range(), "todo")!);
    expect(editor.save()).toMatch(/\[ \] a\n.*\[ \] b\n.*3\. c/);
  });

  it("colours their text", () => {
    editor.open(BODY);
    select(rangeBetween(editor.doc, unit("B"), unit("C")));
    colorBlockRange(editor.view, range(), "text_color", "red");
    const { doc } = editor.view.state;
    expect(doc.rangeHasMark(unit("B"), unit("D"), doc.type.schema.marks.text_color!)).toBe(true);
    expect(doc.rangeHasMark(0, unit("B"), doc.type.schema.marks.text_color!)).toBe(false);
    expect(editor.view.state.selection).toBeInstanceOf(BlockRangeSelection);
  });

  it("groups them into a toggle, the first line its title, in one step", () => {
    editor.open(BODY);
    const { view } = editor;
    select(rangeBetween(editor.doc, unit("B"), unit("D")));
    editor.press("t", { ctrlKey: true, altKey: true });
    expect(editor.save()).toBe("A\n\n<details open>\n<summary>B</summary>\n\nC\n\nD\n\n</details>\n");
    expect(editor.view.state.selection).toBeInstanceOf(NodeSelection);
    expect(undo(view.state, view.dispatch)).toBe(true);
    expect(editor.save()).toBe(BODY);
    // A heading is a title too; a lone block gets an empty body to write in.
    editor.open("## Plan\n\nText\n");
    select(rangeBetween(editor.doc, unit("Text"), unit("Text")));
    expect(groupIntoToggle(range())(view.state, view.dispatch)).toBe(true);
    expect(find(view.state.doc, (n) => n.type.name === "toggle").node.attrs.summary).toBe("Text");
    // Items of a list cannot leave it to become a toggle.
    editor.open("- a\n- b\n");
    select(rangeBetween(editor.doc, unit("a"), unit("b")));
    expect(groupIntoToggle(range())(view.state)).toBe(false);
  });

  it("moves them together, fitted to where they land, and leaves the file's other blocks alone", () => {
    editor.open(BODY);
    const { view } = editor;
    select(rangeBetween(editor.doc, unit("B"), unit("C")));
    const tr = moveBlocksTo(view.state, range(), editor.doc.content.size)!;
    view.dispatch(tr);
    expect(editor.save()).toBe("A\n\nD\n\nB\n\nC\n");
    expect(texts(view.state.selection)).toEqual(["B", "C"]);
    expect(moveBlocksTo(view.state, range(), range().from + 1)).toBeNull();

    editor.open("- a\n- b\n- c\n- d\n\nEnd\n");
    select(rangeBetween(editor.doc, unit("b"), unit("c")));
    view.dispatch(moveBlocksTo(view.state, range(), unit("d") + find(view.state.doc, (n) => n.type.name === "list_item" && n.textContent === "d").node.nodeSize)!);
    expect(editor.save()).toBe("- a\n- d\n- b\n- c\n\nEnd\n");
    // Out of the list, items are a list of their own.
    select(rangeBetween(editor.doc, unit("d"), unit("b")));
    view.dispatch(moveBlocksTo(view.state, range(), editor.doc.content.size)!);
    expect(editor.save()).toBe("- a\n- c\n\nEnd\n\n- d\n- b\n");
    // Several blocks into a list become its items.
    editor.open("- x\n- y\n\nP\n\nQ\n");
    select(rangeBetween(editor.doc, unit("P"), unit("Q")));
    view.dispatch(moveBlocksTo(view.state, range(), unit("y"))!);
    expect(editor.save()).toBe("- x\n- P\n- Q\n- y\n");
  });

  it("also moves with Ctrl+Shift+arrow, as the handle does by dragging", () => {
    editor.open(BODY);
    select(rangeBetween(editor.doc, unit("B"), unit("C")));
    editor.press("ArrowDown", { ctrlKey: true, shiftKey: true });
    expect(editor.save()).toBe("A\n\nD\n\nB\n\nC\n");
    editor.press("ArrowUp", { ctrlKey: true, shiftKey: true });
    expect(editor.save()).toBe(BODY);
  });
});

describe("blocks a selection spans", () => {
  it("are the siblings holding where text starts and ends", () => {
    editor.open(BODY);
    editor.caret("B");
    expect(blocksOfSelection(editor.view.state)).toBeNull();
    const { view } = editor;
    const from = find(view.state.doc, (n) => n.isText && n.text === "A").pos;
    const to = find(view.state.doc, (n) => n.isText && n.text === "C").pos + 1;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
    expect(blocksOfSelection(view.state)).toMatchObject({ count: 3 });
    // Ctrl+Alt+digit turns them all.
    editor.press("2", { ctrlKey: true, altKey: true });
    expect(editor.save()).toBe("## A\n\n## B\n\n## C\n\nD\n");
  });
});


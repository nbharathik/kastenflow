// Clicking beside or below the text writes there: the caret goes to an empty
// paragraph at the end (which the file does not keep until something is typed),
// and a drag in the margin selects blocks.

import type { Node } from "@milkdown/kit/prose/model";
import { Selection, TextSelection } from "@milkdown/kit/prose/state";
import { describe, expect, it } from "vitest";

import { useTestEditor } from "../../../../test/editor";
import { setFolded } from "../sections/api";
import { sectionsOf } from "../sections/model";
import { BlockRangeSelection } from "./block-range";
import { focusAt, focusEnd } from "./focus";
import { gutterOf } from "./gutter";
import { blockUnit } from "./units";

const editor = useTestEditor();
const BODY = "A\n\nB\n\nC\n\nD\n";

/** The position before the block holding the paragraph `text`. */
function unit(text: string): number {
  let found = -1;
  editor.doc.descendants((node: Node, pos) => {
    if (found < 0 && node.type.name === "paragraph" && node.textContent === text) found = pos;
    return found < 0;
  });
  return blockUnit(editor.doc, found)!.pos;
}

const texts = (selection: Selection) => (selection instanceof BlockRangeSelection ? selection.blocks().map((b) => b.node.textContent) : []);

describe("clicking anywhere to write", () => {
  it("adds a paragraph at the end to write in, without changing the file until something is typed", () => {
    const body = "Intro\n\n- item\n";
    editor.open(body);
    focusEnd(editor.view);
    expect(editor.doc.lastChild!.type.name).toBe("paragraph");
    expect(editor.doc.lastChild!.content.size).toBe(0);
    expect(editor.view.state.selection.from).toBe(editor.doc.content.size - 1);
    expect(editor.save()).toBe(body);
    // Again: the empty paragraph is already there.
    const size = editor.doc.content.size;
    focusEnd(editor.view);
    expect(editor.doc.content.size).toBe(size);
    editor.type("Typed");
    expect(editor.save()).toBe("Intro\n\n- item\n\nTyped\n");
  });

  it("adds one after a table, a picture or a code block too", () => {
    for (const last of ["```\ncode\n```\n", "| a | b |\n| - | - |\n| 1 | 2 |\n"]) {
      const body = `Intro\n\n${last}`;
      editor.open(body);
      focusEnd(editor.view);
      expect(editor.doc.lastChild!.type.name).toBe("paragraph");
      expect(editor.view.state.selection.$from.parent).toBe(editor.doc.lastChild);
      expect(editor.save()).toBe(body);
    }
  });

  it("leaves a page that ends in a folded section as it is", () => {
    editor.open("One\n\n---\n\nTwo\n");
    setFolded(editor.view, [sectionsOf(editor.doc)[1]!.divider!], true);
    const size = editor.doc.content.size;
    focusEnd(editor.view);
    expect(editor.doc.content.size).toBe(size);
    expect(editor.save()).toBe("One\n\n---\n\nTwo\n");
  });

  it("goes to the nearest text beside a block, and to the end below the last one", () => {
    editor.open(BODY);
    const { view } = editor;
    const box = view.dom.getBoundingClientRect;
    const hit = view.posAtCoords;
    view.dom.getBoundingClientRect = () => ({ top: 0, bottom: 400, left: 100, right: 400, width: 300, height: 400, x: 100, y: 0, toJSON: () => ({}) });
    const asked: { left: number; top: number }[] = [];
    view.posAtCoords = ((coords: { left: number; top: number }) => {
      asked.push(coords);
      return { pos: unit("B") + 1, inside: unit("B") };
    }) as never;
    try {
      // In the left margin, level with B: x is taken into the editor's box.
      focusAt(view, 20, 150);
      expect(asked).toEqual([{ left: 101, top: 150 }]);
      expect(view.state.selection.$from.parent.textContent).toBe("B");
      // Below the last block (jsdom draws none, so its bottom is the editor's): the end.
      focusAt(view, 150, 900);
      expect(view.state.selection.$from.parent.content.size).toBe(0);
      expect(view.state.selection.$from.parent).toBe(view.state.doc.lastChild);
      expect(editor.save()).toBe(BODY);
    } finally {
      view.dom.getBoundingClientRect = box;
      view.posAtCoords = hit;
    }
  });

  it("puts the caret at the end for a short click in the gutter, and selects blocks for a drag", () => {
    editor.open(BODY);
    const { view } = editor;
    document.body.dataset.editorGutter = "";
    const press = (type: string, y: number, buttons = 1) => document.body.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, buttons, clientX: 5, clientY: y }));
    const box = view.dom.getBoundingClientRect;
    const hit = view.posAtCoords;
    // Four blocks, a hundred pixels each.
    view.dom.getBoundingClientRect = () => ({ top: 0, bottom: 400, left: 0, right: 300, width: 300, height: 400, x: 0, y: 0, toJSON: () => ({}) });
    view.posAtCoords = (({ top }: { top: number }) => {
      const text = ["A", "B", "C", "D"][Math.min(3, Math.floor(top / 100))]!;
      return { pos: unit(text) + 1, inside: unit(text) };
    }) as never;
    try {
      // A drag from beside A to beside C.
      press("pointerdown", 50);
      press("pointermove", 250);
      press("pointerup", 250, 0);
      expect(texts(view.state.selection)).toEqual(["A", "B", "C"]);
      // A click below the text.
      press("pointerdown", 450);
      press("pointerup", 450, 0);
      expect(view.state.selection).toBeInstanceOf(TextSelection);
      expect(editor.doc.lastChild!.content.size).toBe(0);
      expect(editor.save()).toBe(BODY);
    } finally {
      delete document.body.dataset.editorGutter;
      view.dom.getBoundingClientRect = box;
      view.posAtCoords = hit;
    }
  });

  it("finds the gutter only in empty space around the editor", () => {
    editor.open(BODY);
    const column = document.createElement("div");
    column.dataset.editorGutter = "";
    const editorParent = editor.view.dom.parentElement!;
    const home = editorParent.parentElement!;
    home.replaceChild(column, editorParent);
    column.append(editorParent);
    const tail = document.createElement("div");
    tail.className = "kasten-page-tail";
    column.append(tail);
    const button = document.createElement("button");
    column.append(button);
    try {
      expect(gutterOf(editor.view, column)).toBe(column);
      expect(gutterOf(editor.view, tail)).toBe(column);
      expect(gutterOf(editor.view, editorParent)).toBe(column);
      expect(gutterOf(editor.view, button)).toBeNull();
      expect(gutterOf(editor.view, editor.view.dom)).toBeNull();
      expect(gutterOf(editor.view, document.body)).toBeNull();
    } finally {
      home.replaceChild(editorParent, column);
    }
  });
});

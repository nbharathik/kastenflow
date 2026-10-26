// Shared set-up for the columns tests: a real page editor on a div, the
// golden fixtures in fixtures/roundtrip/columns, and small helpers to read
// and edit the document by the text in it.

import type { Crepe } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import type { Node } from "@milkdown/kit/prose/model";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

import { markdownFixtures } from "../../../../test/fixtures";
import { createKastenCrepe } from "../crepe";

export const columnFixtures = markdownFixtures().filter((f) => f.name.startsWith("roundtrip/columns/"));

export function fixture(name: string): string {
  const found = columnFixtures.find((f) => f.name.endsWith(`/${name}`));
  if (!found) throw new Error(`no fixture ${name}`);
  return found.text;
}

export interface Harness {
  crepe: Crepe;
  view(): EditorView;
  destroy(): Promise<void>;
}

export async function makeEditor(): Promise<Harness> {
  const root = document.createElement("div");
  document.body.append(root);
  const crepe = await createKastenCrepe(root);
  return {
    crepe,
    view: () => crepe.editor.ctx.get(editorViewCtx),
    destroy: async () => {
      await crepe.destroy();
      root.remove();
    },
  };
}

/** Every columns block of the document: its position and node. */
export function columnsBlocks(doc: Node): { pos: number; node: Node }[] {
  const found: { pos: number; node: Node }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "columns") found.push({ pos, node });
    return true;
  });
  return found;
}

/** A compact picture of a node: the names of the blocks inside each column. */
export function shapeOf(node: Node): string {
  if (node.type.name === "columns") {
    const inner: string[] = [];
    node.forEach((column) => inner.push(shapeOf(column)));
    return `columns(${String(node.attrs.ratio)})[${inner.join(" | ")}]`;
  }
  const names: string[] = [];
  node.forEach((child) => names.push(child.type.name));
  return names.join(",");
}

/** Where `needle` starts in the document's text, or -1. */
export function findText(doc: Node, needle: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.isText && node.text!.includes(needle)) found = pos + node.text!.indexOf(needle);
    return found < 0;
  });
  return found;
}

/** Puts the caret at the start of `needle`. */
export function caretAt(view: EditorView, needle: string): number {
  const pos = findText(view.state.doc, needle);
  if (pos < 0) throw new Error(`"${needle}" is not in the page`);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
  return pos;
}

/** Types `text` in front of `needle`. */
export function typeBefore(view: EditorView, needle: string, text: string): void {
  const pos = findText(view.state.doc, needle);
  if (pos < 0) throw new Error(`"${needle}" is not in the page`);
  view.dispatch(view.state.tr.insertText(text, pos));
}

export const crlf = (text: string) => text.replace(/\n/g, "\r\n");

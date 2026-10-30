// Columns, stored as HTML comments around ordinary blocks:
//
//   <!-- columns 40/60 -->
//
//   First column blocks.
//
//   <!-- column -->
//
//   Second column blocks.
//
//   <!-- /columns -->
//
// Comments are valid CommonMark and invisible in GitHub and Obsidian, where the
// columns simply read top to bottom. In the Markdown tree a columns block is
// several siblings; `findColumns` pairs them up, for the remark transform here
// and for the lossless layer's block ranges (so the whole block is one unit).
// Only the top level of a page has columns, and they do not nest: a marker pair
// inside a column stays a plain comment.

import { $remark } from "@milkdown/kit/utils";

import { eachParent, htmlBlockValue, type MdNode } from "../blocks/mdast";

// The ratio may be spelled with spaces around the slashes (`40 / 60`); it is read without them.
const OPENER = /^<!--\s*columns(?:\s+(\d+(?:\s*\/\s*\d+)*))?\s*-->$/i;
const SEPARATOR = /^<!--\s*column\s*-->$/i;
const CLOSER = /^<!--\s*\/columns\s*-->$/i;

export interface ColumnsSpan {
  /** Index of the opening comment. */
  start: number;
  /** Index of the closing comment. */
  end: number;
  /** Indices of the comments between columns. */
  separators: number[];
  /** The numbers after `columns` in the opener, as written (`40/60`), or "". */
  ratio: string;
}

/** Columns among sibling blocks, outermost only; an opener with no closer is left alone. */
export function findColumns<T>(children: readonly T[], htmlOf: (child: T) => string | null): ColumnsSpan[] {
  const value = (i: number) => {
    const child = children[i];
    const html = child === undefined ? null : htmlOf(child);
    return html === null ? null : html.trim();
  };
  const spans: ColumnsSpan[] = [];
  for (let i = 0; i < children.length; i++) {
    const opener = OPENER.exec(value(i) ?? "");
    if (!opener) continue;
    let depth = 0;
    let end = -1;
    const separators: number[] = [];
    for (let j = i + 1; j < children.length && end < 0; j++) {
      const html = value(j);
      if (html === null) continue;
      if (OPENER.test(html)) depth++;
      else if (CLOSER.test(html)) {
        if (depth === 0) end = j;
        else depth--;
      } else if (depth === 0 && SEPARATOR.test(html)) separators.push(j);
    }
    if (end < 0) continue;
    spans.push({ start: i, end, separators, ratio: (opener[1] ?? "").replace(/\s+/g, "") });
    i = end;
  }
  return spans;
}

/** Where each marker of a columns block's own source sits (opener, separators, closer, in order), or
 * null when `children` (the parse of that source alone) is not exactly one columns block. */
export function markerRanges(children: readonly MdNode[]): { start: number; end: number }[] | null {
  const spans = findColumns(children, htmlBlockValue);
  const span = spans[0];
  if (spans.length !== 1 || !span || span.start !== 0 || span.end !== children.length - 1) return null;
  const marks: { start: number; end: number }[] = [];
  for (const i of [span.start, ...span.separators, span.end]) {
    const start = children[i]?.position?.start.offset;
    const end = children[i]?.position?.end.offset;
    if (start === undefined || end === undefined) return null;
    marks.push({ start, end });
  }
  return marks;
}

let suppressed = 0;

/** Whether markers make columns right now. */
export const columnsEnabled = (): boolean => suppressed === 0;

/** Runs `fn` with the markers read as plain comments: a column's own blocks are
 * read and written that way, so a nested pair inside one stays what it is. */
export function withoutColumns<T>(fn: () => T): T {
  suppressed++;
  try {
    return fn();
  } finally {
    suppressed--;
  }
}

/** The page's link reference and footnote definitions, as written. By the time the transform below
 * runs the editor has turned references into plain links and dropped the definitions, so the
 * text is parsed again, without transforms. */
function definitionsOf(processor: { parse?: (text: string) => unknown }, src: string): string {
  try {
    const raw = processor.parse?.(src) as MdNode | undefined;
    return (raw?.children ?? [])
      .filter((c) => c.type === "definition" || c.type === "footnoteDefinition")
      .flatMap((c) => {
        const a = c.position?.start.offset;
        const b = c.position?.end.offset;
        return a === undefined || b === undefined ? [] : [src.slice(a, b)];
      })
      .join("\n\n");
  } catch {
    return "";
  }
}

export const remarkColumns = $remark("kastenColumns", () => function (this: { parse?: (text: string) => unknown }) {
  const processor = { parse: this.parse?.bind(this) };
  return (tree: unknown, file: { value?: unknown }) => {
    if (!columnsEnabled()) return;
    const src = String(file.value ?? "");
    eachParent(tree as MdNode, (parent) => {
      if (parent.type !== "root") return;
      const spans = findColumns(parent.children, htmlBlockValue);
      if (spans.length === 0) return;
      // A block in a column is read again on its own when saved, and needs the page's
      // definitions to see the same links the page did.
      const context = definitionsOf(processor, src);
      const children: MdNode[] = [];
      let k = 0;
      for (const s of spans) {
        children.push(...parent.children.slice(k, s.start));
        const first = parent.children[s.start]!;
        const last = parent.children[s.end]!;
        const from = first.position?.start.offset;
        const to = last.position?.end.offset;
        const columns: MdNode[] = [];
        let at = s.start + 1;
        for (const cut of [...s.separators, s.end]) {
          columns.push({ type: "column", children: parent.children.slice(at, cut) });
          at = cut + 1;
        }
        children.push({
          type: "columns",
          ratio: s.ratio,
          // The block's own bytes, so saving can leave what did not change alone.
          source: from !== undefined && to !== undefined ? src.slice(from, to) : "",
          context,
          children: columns,
          ...(first.position && last.position ? { position: { start: first.position.start, end: last.position.end } } : {}),
        });
        k = s.end + 1;
      }
      children.push(...parent.children.slice(k));
      parent.children = children;
    });
  };
});

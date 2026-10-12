// "Turn into" for several blocks at once: every selected block takes the new
// kind, in one transaction. Their text carries over; quotes, callouts, toggles
// and lists give up their insides to be turned, as one block's do. Blocks with
// no text of their own (a table, a divider, a picture) stay as they are.

import { Fragment, type Node, type Schema } from "@milkdown/kit/prose/model";
import { NodeSelection, type EditorState, type Selection, type Transaction } from "@milkdown/kit/prose/state";

import { blocksIn, selectBlocks, type BlocksAt } from "./block-range";
import type { BlockKind } from "./catalog";
import { titleOf } from "./transform";
import { isList } from "./units";

/** A block's text to retype, or a block to leave as it is. */
type Piece = { text: Fragment } | { keep: Node };

/** The pieces `node` turns into: its text, and its insides' text. */
function pieces(node: Node, out: Piece[]): void {
  const { schema } = node.type;
  const text = (value: string) => (value ? Fragment.from(schema.text(value)) : Fragment.empty);
  switch (node.type.name) {
    case "paragraph":
    case "heading":
      out.push({ text: node.content });
      return;
    case "code_block":
    case "math_block":
      out.push({ text: text(node.textContent) });
      return;
    case "bullet_list":
    case "ordered_list":
    case "blockquote":
      node.forEach((child) => pieces(child, out));
      return;
    case "list_item":
      node.forEach((child, _offset, index) => (index === 0 && child.type.name === "paragraph" ? out.push({ text: child.content }) : pieces(child, out)));
      return;
    case "callout":
    case "toggle": {
      const title = String(node.type.name === "callout" ? node.attrs.title : node.attrs.summary);
      if (title.trim()) out.push({ text: text(title) });
      node.forEach((child) => pieces(child, out));
      return;
    }
    default:
      out.push({ keep: node });
  }
}

const LISTS = new Set<BlockKind>(["bullet", "numbered", "todo"]);
/** Kinds that gather the blocks into one: a list, a quote, a callout. */
const GROUPED = new Set<BlockKind>([...LISTS, "quote", "callout"]);

function listOf(schema: Schema, kind: "bullet" | "numbered" | "todo", run: readonly Fragment[]): Node {
  const { bullet_list, ordered_list, list_item, paragraph } = schema.nodes;
  const ordered = kind === "numbered";
  const items = run.map((text, i) => list_item!.create({ listType: ordered ? "ordered" : "bullet", label: ordered ? `${i + 1}.` : "•", checked: kind === "todo" ? false : null }, paragraph!.create(null, text)));
  return ordered ? ordered_list!.create({ order: 1 }, items) : bullet_list!.create(null, items);
}

/** The block `kind` made of one text. */
function one(schema: Schema, kind: BlockKind, text: Fragment): Node {
  const { paragraph, heading, code_block, math_block, toggle } = schema.nodes;
  const plain = text.textBetween(0, text.size, " ");
  switch (kind) {
    case "h1":
    case "h2":
    case "h3":
      return heading!.create({ level: Number(kind[1]) }, text);
    case "code":
      return code_block!.create(null, plain ? schema.text(plain) : null);
    case "math":
      return math_block!.create(null, plain ? schema.text(plain) : null);
    case "toggle":
      return toggle!.create({ open: false, summary: titleOf(paragraph!.create(null, text)) }, paragraph!.create());
    default:
      return paragraph!.create(null, text);
  }
}

/** The nodes `items` become as `kind`: consecutive texts of a list, quote or callout in one. */
function build(schema: Schema, kind: BlockKind, items: readonly Piece[]): Node[] {
  const out: Node[] = [];
  let run: Fragment[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const { paragraph, blockquote, callout } = schema.nodes;
    if (kind === "bullet" || kind === "numbered" || kind === "todo") out.push(listOf(schema, kind, run));
    else if (kind === "quote") out.push(blockquote!.create(null, run.map((text) => paragraph!.create(null, text))));
    else out.push(callout!.create({ kind: "tip", fold: "", title: "" }, run.map((text) => paragraph!.create(null, text))));
    run = [];
  };
  for (const item of items) {
    if ("keep" in item) {
      flush();
      out.push(item.keep);
    } else if (GROUPED.has(kind)) run.push(item.text);
    else out.push(one(schema, kind, item.text));
  }
  flush();
  return out;
}

/** The items of `list` from `from` to `to`, as a list of the same kind, numbered on from `order`. */
function sliceOf(list: Node, from: number, to: number, order: number): Node {
  const ordered = list.type.name === "ordered_list";
  const items: Node[] = [];
  list.forEach((item, _offset, index) => {
    if (index < from || index >= to) return;
    items.push(ordered ? item.type.create({ ...item.attrs, label: `${order + items.length}.` }, item.content, item.marks) : item);
  });
  return list.type.create(ordered ? { ...list.attrs, order } : list.attrs, items);
}

/** Items of a list turned into another kind of list, or a to-do, in place. */
function retypeItems(state: EditorState, range: BlocksAt, kind: "bullet" | "numbered" | "todo"): Transaction | null {
  const { doc, schema } = state;
  const $from = doc.resolve(range.from);
  const list = $from.parent;
  const listPos = $from.before();
  const tr = state.tr;
  const ordered = kind === "numbered";
  // A list holds one kind of marker, so the whole list changes.
  if (kind !== "todo" && list.type !== (ordered ? schema.nodes.ordered_list : schema.nodes.bullet_list)) {
    tr.setNodeMarkup(listPos, ordered ? schema.nodes.ordered_list : schema.nodes.bullet_list, ordered ? { order: 1, spread: list.attrs.spread } : { spread: list.attrs.spread });
    list.forEach((item, offset, index) => tr.setNodeMarkup(listPos + 1 + offset, undefined, { ...item.attrs, listType: ordered ? "ordered" : "bullet", label: ordered ? `${index + 1}.` : "•" }));
  }
  const first = $from.index();
  for (let index = first; index < first + range.count; index++) {
    const at = listPos + 1 + offsetOf(list, index);
    const item = tr.doc.nodeAt(at)!;
    const checked = kind === "todo" ? (typeof item.attrs.checked === "boolean" ? item.attrs.checked : false) : null;
    if (item.attrs.checked !== checked) tr.setNodeMarkup(at, undefined, { ...item.attrs, checked });
  }
  return tr;
}

/** Where child `index` of `parent` starts, inside it. */
function offsetOf(parent: Node, index: number): number {
  let offset = 0;
  for (let i = 0; i < index; i++) offset += parent.child(i).nodeSize;
  return offset;
}

/** Items of a list turned into anything else: the list is cut, and what they become stands between the halves. */
function leaveList(state: EditorState, range: BlocksAt, kind: BlockKind): Transaction | null {
  const { doc, schema } = state;
  const $from = doc.resolve(range.from);
  const list = $from.parent;
  const listPos = $from.before();
  const start = $from.index();
  const end = start + range.count;
  const found: Piece[] = [];
  for (const item of blocksIn(doc, range)) pieces(item, found);
  const made = build(schema, kind, found);
  const order = Number(list.attrs.order ?? 1);
  const parts: Node[] = [];
  if (start > 0) parts.push(sliceOf(list, 0, start, order));
  parts.push(...made);
  if (end < list.childCount) parts.push(sliceOf(list, end, list.childCount, order + end));
  const outer = $from.node($from.depth - 1);
  if (!outer.canReplace($from.index($from.depth - 1), $from.index($from.depth - 1) + 1, Fragment.from(parts))) return null;
  const tr = state.tr.replaceWith(listPos, listPos + list.nodeSize, parts);
  const before = start > 0 ? parts[0]!.nodeSize : 0;
  const size = made.reduce((sum, node) => sum + node.nodeSize, 0);
  const selection = made.length > 0 ? selectBlocks(tr.doc, listPos + before, listPos + before + size) : null;
  return selection ? tr.setSelection(selection) : tr;
}

/** Turns the sibling blocks of `range` into `kind`, in one transaction; null when they cannot be. */
export function turnBlocksInto(state: EditorState, range: BlocksAt, kind: BlockKind): Transaction | null {
  const { doc, schema } = state;
  const $from = doc.resolve(range.from);
  const parent = $from.parent;
  if (isList(parent)) {
    if (kind === "bullet" || kind === "numbered" || kind === "todo") return retypeItems(state, range, kind);
    return leaveList(state, range, kind);
  }
  const found: Piece[] = [];
  for (const node of blocksIn(doc, range)) pieces(node, found);
  const made = build(schema, kind, found);
  if (made.length === 0 || !parent.canReplace($from.index(), $from.index() + range.count, Fragment.from(made))) return null;
  const tr = state.tr.replaceWith(range.from, range.to, made);
  const end = range.from + made.reduce((sum, node) => sum + node.nodeSize, 0);
  let selection: Selection | null = selectBlocks(tr.doc, range.from, end);
  if (!selection && NodeSelection.isSelectable(tr.doc.nodeAt(range.from)!)) selection = NodeSelection.create(tr.doc, range.from);
  return selection ? tr.setSelection(selection) : tr;
}

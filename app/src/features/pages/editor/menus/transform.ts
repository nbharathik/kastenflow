// "Turn into": changes the block at the selection into another kind, the way
// Notion does from the slash menu and the block menu. Each change is one
// transaction, so it undoes in one step.

import { lift, setBlockType, wrapIn } from "@milkdown/kit/prose/commands";
import type { Node } from "@milkdown/kit/prose/model";
import { liftListItem } from "@milkdown/kit/prose/schema-list";
import { EditorState, Selection, TextSelection, type Command, type Transaction } from "@milkdown/kit/prose/state";

import type { BlockKind } from "./catalog";

/** Runs commands one after another into a single transaction; null if one fails. */
export function chain(state: EditorState, commands: Command[], tr: Transaction = state.tr): Transaction | null {
  for (const command of commands) {
    // A plugin-free state, so no plugin appends steps the transaction lacks.
    const current = EditorState.create({ schema: state.schema, doc: tr.doc, selection: tr.selection, storedMarks: tr.storedMarks });
    let result = null as Transaction | null;
    if (!command(current, (t) => (result = t))) return null;
    if (!result) continue;
    for (const step of result.steps) tr.step(step);
    if (result.selectionSet) tr.setSelection(Selection.fromJSON(tr.doc, result.selection.toJSON()));
    if (result.storedMarksSet) tr.setStoredMarks(result.storedMarks);
  }
  return tr;
}

/** Runs a command that may have nothing to do, such as setting a type the block already has. */
const optional =
  (command: Command): Command =>
  (state, dispatch) => {
    command(state, dispatch);
    return true;
  };

/** Moves the text block at the selection out of every list around it. */
const liftOutOfList: Command = (state, dispatch) => {
  const item = state.schema.nodes.list_item!;
  let tr = state.tr;
  for (let depth = 0; depth < 32; depth++) {
    const { $from } = tr.selection;
    if ($from.depth < 2 || $from.node(-1).type !== item) break;
    const next = chain(state, [liftListItem(item)], tr);
    if (!next) break;
    tr = next;
  }
  if (!tr.docChanged) return false;
  dispatch?.(tr);
  return true;
};

const setChecked =
  (checked: boolean): Command =>
  (state, dispatch) => {
    const { $from } = state.selection;
    const item = $from.node(-1);
    if (item.type !== state.schema.nodes.list_item) return false;
    dispatch?.(state.tr.setNodeMarkup($from.before(-1), undefined, { ...item.attrs, checked }));
    return true;
  };

/** Changes the list item at the selection in place: its list's type, or its checkbox. */
function retypeListItem(kind: "bullet" | "numbered" | "todo"): Command {
  return (state, dispatch) => {
    const nodes = state.schema.nodes;
    const { $from } = state.selection;
    const itemPos = $from.before(-1);
    const list = $from.node(-2);
    const listPos = $from.before(-2);
    const tr = state.tr;
    const ordered = kind === "numbered";
    const listType = ordered ? nodes.ordered_list! : nodes.bullet_list!;
    // Markdown lists hold one kind of marker, so the whole list changes.
    if (kind !== "todo" && list.type !== listType) {
      tr.setNodeMarkup(listPos, listType, ordered ? { order: 1, spread: list.attrs.spread } : { spread: list.attrs.spread });
      list.forEach((item, offset, index) => {
        const label = ordered ? `${index + 1}.` : "•";
        tr.setNodeMarkup(listPos + 1 + offset, undefined, { ...item.attrs, listType: ordered ? "ordered" : "bullet", label });
      });
    }
    const item = tr.doc.nodeAt(itemPos)!;
    const checked = kind === "todo" ? (typeof item.attrs.checked === "boolean" ? item.attrs.checked : false) : null;
    if (item.attrs.checked !== checked) tr.setNodeMarkup(itemPos, undefined, { ...item.attrs, checked });
    dispatch?.(tr);
    return true;
  };
}

/** A block's text for a toggle's title, its links and maths written out as
 * in Markdown (`[[Plan]]`, `$x^2$`) rather than dropped. */
export function titleOf(block: Node): string {
  return block.textBetween(0, block.content.size, " ", (leaf) => {
    if (leaf.type.name === "wiki_link") return `${leaf.attrs.embed ? "!" : ""}[[${String(leaf.attrs.value)}]]`;
    if (leaf.type.name !== "math_inline") return " ";
    const dollars = "$".repeat(Number(leaf.attrs.dollars) || 1);
    return `${dollars}${String(leaf.attrs.value)}${dollars}`;
  });
}

/** Replaces the text block with a toggle titled with its text, caret in the body. */
const replaceWithToggle: Command = (state, dispatch) => {
  const nodes = state.schema.nodes;
  const { $from } = state.selection;
  const toggle = nodes.toggle!.create({ open: false, summary: titleOf($from.parent) }, nodes.paragraph!.create());
  const start = $from.before();
  const tr = state.tr.replaceWith(start, $from.after(), toggle);
  tr.setSelection(TextSelection.create(tr.doc, start + 2));
  dispatch?.(tr);
  return true;
};

/** What kind of block the text block at the selection belongs to, if it is one "Turn into" knows. */
export function blockKindAt(state: EditorState): BlockKind | null {
  const nodes = state.schema.nodes;
  const { $from } = state.selection;
  const block = $from.parent;
  if (!block.isTextblock || $from.depth < 1) return null;
  const parent = $from.node(-1);
  if (parent.type === nodes.list_item && $from.index(-1) === 0) {
    if (typeof parent.attrs.checked === "boolean") return "todo";
    return $from.node(-2).type === nodes.ordered_list ? "numbered" : "bullet";
  }
  if (parent.type === nodes.blockquote) return "quote";
  if (block.type === nodes.paragraph) return "text";
  if (block.type === nodes.code_block) return block.attrs.language === "LaTeX" ? null : "code";
  if (block.type === nodes.math_block) return "math";
  if (block.type === nodes.heading) {
    const level = Number(block.attrs.level);
    return level >= 1 && level <= 3 ? (`h${level}` as BlockKind) : null;
  }
  return null;
}

function commandsFor(state: EditorState, kind: BlockKind): Command[] | null {
  const nodes = state.schema.nodes;
  const { $from } = state.selection;
  if (!$from.parent.isTextblock || $from.depth < 1) return null;
  const parent = $from.node(-1);
  const inItem = parent.type === nodes.list_item && $from.index(-1) === 0;
  const inQuote = parent.type === nodes.blockquote;
  const isList = kind === "bullet" || kind === "numbered" || kind === "todo";
  if (isList && inItem) return [retypeListItem(kind)];
  if (kind === "quote" && inQuote) return [];

  const commands: Command[] = [];
  if (inItem) commands.push(liftOutOfList);
  else if (inQuote) commands.push(lift);
  const toParagraph = optional(setBlockType(nodes.paragraph!));
  switch (kind) {
    case "text":
      commands.push(toParagraph);
      break;
    case "h1":
    case "h2":
    case "h3":
      commands.push(optional(setBlockType(nodes.heading!, { level: Number(kind[1]) })));
      break;
    case "code":
      commands.push(optional(setBlockType(nodes.code_block!)));
      break;
    case "math":
      commands.push(optional(setBlockType(nodes.math_block!)));
      break;
    case "bullet":
      commands.push(toParagraph, wrapIn(nodes.bullet_list!));
      break;
    case "numbered":
      commands.push(toParagraph, wrapIn(nodes.ordered_list!));
      break;
    case "todo":
      commands.push(toParagraph, wrapIn(nodes.bullet_list!), setChecked(false));
      break;
    case "quote":
      commands.push(toParagraph, wrapIn(nodes.blockquote!));
      break;
    case "callout":
      commands.push(toParagraph, wrapIn(nodes.callout!, { kind: "tip", fold: "", title: "" }));
      break;
    case "toggle":
      commands.push(replaceWithToggle);
      break;
  }
  return commands;
}

/** Turns the text block at the selection into `kind`. */
export function turnInto(kind: BlockKind): Command {
  return (state, dispatch) => {
    const commands = commandsFor(state, kind);
    const tr = commands && chain(state, commands);
    if (!tr) return false;
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

/** The text a container shows above its body: a callout's title or a toggle's summary. */
function heading(node: Node): string {
  if (node.type.name === "callout") return String(node.attrs.title);
  if (node.type.name === "toggle") return String(node.attrs.summary);
  return "";
}

/** Replaces the callout, toggle or quote at `pos` with its body, keeping a
 * non-empty title as the first paragraph; the caret goes to the first block. */
export function unwrapContainer(pos: number): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (!node || !["callout", "toggle", "blockquote"].includes(node.type.name)) return false;
    const blocks: Node[] = [];
    const title = heading(node);
    if (title !== "") blocks.push(state.schema.nodes.paragraph!.create(null, state.schema.text(title)));
    node.forEach((child) => void blocks.push(child));
    const tr = state.tr.replaceWith(pos, pos + node.nodeSize, blocks);
    tr.setSelection(Selection.near(tr.doc.resolve(pos + 1)));
    dispatch?.(tr);
    return true;
  };
}

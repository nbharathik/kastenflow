// The block menu Notion opens from a block's grip: Turn into, Colour,
// Duplicate and Delete.

import type { Node } from "@milkdown/kit/prose/model";
import { Selection, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

import { NOTION_COLORS, type NotionColor } from "../blocks/color";
import type { Rect } from "../ui/dom";
import { Popover, type MenuItem, type MenuSection } from "../ui/popover";
import { closesWith } from "../ui/close-with-editor";
import { colorBlocks, deleteBlock, duplicateBlock, kindOfNode } from "./block-ops";
import { blocksIn, type BlocksAt } from "./block-range";
import { BLOCK_CHOICES, TURN_INTO, type BlockKind } from "./catalog";
import { canGroup, colorBlockRange, deleteBlocks, duplicateBlocks, groupIntoToggle } from "./range-ops";
import { chain, turnInto, unwrapContainer } from "./transform";
import { turnBlocksInto } from "./turn-blocks";

const CONTAINERS = new Set(["callout", "toggle", "blockquote"]);
const colourName = (color: string) => color[0]!.toUpperCase() + color.slice(1);

/** Turns the whole block at `pos` into `kind`; containers give up their body first. */
export function turnBlockInto(view: EditorView, pos: number, kind: BlockKind): boolean {
  const { state } = view;
  const node = state.doc.nodeAt(pos);
  if (!node) return false;
  const current = kindOfNode(node, state.doc.resolve(pos).parent);
  if (current === kind) return true;
  const tr = state.tr;
  const steps = CONTAINERS.has(node.type.name) ? [unwrapContainer(pos)] : [];
  tr.setSelection(Selection.near(tr.doc.resolve(pos + 1)));
  const done = chain(state, [...steps, turnInto(kind)], tr);
  if (!done) return false;
  view.dispatch(done.scrollIntoView());
  return true;
}

/** Colours every text in the block at `pos`, keeping the block selected. */
function colorBlock(view: EditorView, pos: number, mark: "text_color" | "bg_color", color: NotionColor | null): void {
  const { state } = view;
  const node = state.doc.nodeAt(pos);
  if (!node) return;
  const start = Selection.findFrom(state.doc.resolve(pos), 1, true);
  const end = Selection.findFrom(state.doc.resolve(pos + node.nodeSize), -1, true);
  if (!start || !end || end.to < start.from || end.to > pos + node.nodeSize) return;
  const tr = chain(state, [colorBlocks(mark, color)], state.tr.setSelection(TextSelection.between(start.$from, end.$to)));
  if (tr) view.dispatch(tr.setSelection(state.selection.map(tr.doc, tr.mapping)));
}

const hasText = (node: Node) => {
  let found = node.isTextblock;
  node.descendants((child) => !(found ||= child.isTextblock));
  return found;
};

export function colorSections(apply: (mark: "text_color" | "bg_color", color: NotionColor | null) => void): MenuSection[] {
  const rows = (mark: "text_color" | "bg_color", suffix: string): MenuItem[] =>
    [null, ...NOTION_COLORS].map((color) => ({
      key: `${mark}-${color ?? "default"}`,
      label: `${color ? colourName(color) : "Default"}${suffix}`,
      icon: "A",
      iconClass: `kasten-swatch kasten-${mark}-${color ?? "default"}`,
      onPick: () => apply(mark, color),
    }));
  return [
    { title: "Text colour", items: rows("text_color", "") },
    { title: "Background colour", items: rows("bg_color", " background") },
  ];
}

/** Turns every block of `range` into `kind`, in one step. */
export function turnBlocks(view: EditorView, range: BlocksAt, kind: BlockKind): boolean {
  const tr = turnBlocksInto(view.state, range, kind);
  if (!tr) return false;
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** The menu for several selected blocks: turn them all into something, colour
 * them, group them into a toggle, duplicate or delete them. */
function rangeSections(view: EditorView, range: BlocksAt): MenuSection[] {
  const { state } = view;
  const turnItems = TURN_INTO.map((kind) => {
    const choice = BLOCK_CHOICES.find((c) => c.key === kind)!;
    return { key: kind, label: choice.label, icon: choice.icon, boxed: true, onPick: () => turnBlocks(view, range, kind) };
  });
  const first: MenuItem[] = [{ key: "turn-into", label: "Turn into", icon: "icon:refresh", submenu: () => [{ items: turnItems }] }];
  if (blocksIn(state.doc, range).some(hasText)) {
    first.push({ key: "color", label: "Colour", icon: "icon:palette", submenu: () => colorSections((mark, color) => colorBlockRange(view, range, mark, color)) });
  }
  if (canGroup(state, range)) first.push({ key: "group", label: "Group into toggle", icon: "icon:toggle", hint: "Ctrl+Alt+T", keys: ["Mod-Alt-t"], onPick: () => groupIntoToggle(range)(view.state, view.dispatch) });
  return [
    { items: first },
    {
      items: [
        { key: "duplicate", label: "Duplicate", icon: "icon:copy", hint: "Ctrl+D", keys: ["Mod-d"], onPick: () => duplicateBlocks(range)(view.state, view.dispatch) },
        { key: "delete", label: "Delete", icon: "icon:trash", hint: "Del", keys: ["Delete", "Backspace"], danger: true, onPick: () => deleteBlocks(range)(view.state, view.dispatch) },
      ],
    },
  ];
}

/** The menu for the block at `pos`, or for the several blocks of `range`. */
export function blockMenuSections(view: EditorView, pos: number, range?: BlocksAt): MenuSection[] {
  if (range && range.count > 1) return rangeSections(view, range);
  const node = view.state.doc.nodeAt(pos);
  if (!node) return [];
  const current = kindOfNode(node, view.state.doc.resolve(pos).parent);
  const turnItems = TURN_INTO.map((kind) => {
    const choice = BLOCK_CHOICES.find((c) => c.key === kind)!;
    return { key: kind, label: choice.label, icon: choice.icon, boxed: true, active: kind === current, onPick: () => turnBlockInto(view, pos, kind) };
  });
  const first: MenuItem[] = [];
  if (current !== null) first.push({ key: "turn-into", label: "Turn into", icon: "icon:refresh", submenu: () => [{ items: turnItems }] });
  if (hasText(node)) {
    first.push({
      key: "color",
      label: "Colour",
      icon: "icon:palette",
      submenu: () => colorSections((mark, color) => colorBlock(view, pos, mark, color)),
    });
  }
  return [
    { items: first },
    {
      items: [
        {
          key: "duplicate",
          label: "Duplicate",
          icon: "icon:copy",
          hint: "Ctrl+D",
          keys: ["Mod-d"],
          onPick: () => duplicateBlock(pos)(view.state, view.dispatch),
        },
        {
          key: "delete",
          label: "Delete",
          icon: "icon:trash",
          hint: "Del",
          keys: ["Delete", "Backspace"],
          danger: true,
          onPick: () => deleteBlock(pos)(view.state, view.dispatch),
        },
      ],
    },
  ];
}

/** Opens the block menu for the block at `pos` (or the blocks of `range`), under `anchor`. */
export function openBlockMenu(view: EditorView, pos: number, anchor: () => Rect, range?: BlocksAt): Popover {
  const menu = new Popover(blockMenuSections(view, pos, range), {
    anchor,
    ownKeys: true,
    label: "Block menu",
    onClose: () => view.isDestroyed || view.focus(),
  });
  return closesWith(view, menu);
}

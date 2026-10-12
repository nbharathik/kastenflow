// Notion's keyboard shortcuts for the page editor. They run on DOM keydown,
// before Milkdown's keymaps, so Notion's meaning wins where the two differ:
// Ctrl+Alt+4 makes a to-do here, not a level-4 heading. Keys the page itself
// handles (Ctrl+K without a selection opens search) fall through.

import { toggleLinkCommand } from "@milkdown/kit/component/link-tooltip";
import { commandsCtx, type CmdKey } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";
import { toggleMark } from "@milkdown/kit/prose/commands";
import { keydownHandler } from "@milkdown/kit/prose/keymap";
import { NodeSelection, Plugin, PluginKey, type Command } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

import { applyColor, lastColor } from "../blocks/color";
import { backspaceInToggle, enterInToggle } from "../blocks/toggle-keys";
import { flipToggleAt } from "../blocks/toggle-view";
import { openBlockMenu } from "./block-menu";
import { currentBlock, editSelectedBlock, extendBlockSelection, moveBlock, selectCurrentBlock, stepBlockSelection } from "./block-nav";
import { pickedBlocks } from "./block-range";
import type { BlockKind } from "./catalog";
import { deleteRange, duplicateSelected, groupSelected, leaveRange, turnSelected } from "./range-keys";

/** Ctrl+Alt+digit turns the block into Notion's kind for that digit. */
const DIGITS: Record<string, BlockKind> = {
  "0": "text",
  "1": "h1",
  "2": "h2",
  "3": "h3",
  "4": "todo",
  "5": "bullet",
  "6": "numbered",
  "7": "toggle",
  "8": "code",
};

const underline: Command = (state, dispatch) => {
  const type = state.schema.marks.underline;
  return type ? toggleMark(type)(state, dispatch) : false;
};

/** Ctrl+Shift+H: the last colour picked, on the selection or what is typed next. */
const highlight: Command = (state, dispatch) => {
  const { mark, color } = lastColor();
  const type = state.schema.marks[mark];
  if (!type) return false;
  const { from, to, empty } = state.selection;
  const already = !empty && state.doc.rangeHasMark(from, to, type);
  dispatch?.(applyColor(state, type, already ? null : color));
  return true;
};

/** Ctrl+Enter: ticks the to-do around the caret, or folds its toggle. */
const flip: Command = (state, dispatch) => {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === "list_item" && typeof node.attrs.checked === "boolean") {
      dispatch?.(state.tr.setNodeMarkup($from.before(depth), undefined, { ...node.attrs, checked: !node.attrs.checked }));
      return true;
    }
    if (node.type.name === "toggle") return flipToggleAt($from.before(depth));
  }
  return false;
};

/** Keys typed while a whole block, or several, are selected: Enter edits
 * them, letters are ignored rather than replacing the blocks. */
function guardSelectedBlock(view: EditorView, event: KeyboardEvent): boolean {
  if (!pickedBlocks(view.state.selection)) return false;
  if (event.key === "Enter" && !event.ctrlKey && !event.metaKey) return editSelectedBlock(view.state, view.dispatch);
  return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
}

function bindings(ctx: Ctx): Record<string, Command> {
  const run =
    (key: CmdKey<unknown>): Command =>
    () =>
      ctx.get(commandsCtx).call(key);
  const map: Record<string, Command> = {
    "Mod-u": underline,
    "Mod-Shift-s": run(toggleStrikethroughCommand.key),
    "Mod-Shift-x": run(toggleStrikethroughCommand.key),
    "Mod-k": (state) => !state.selection.empty && !(state.selection instanceof NodeSelection) && ctx.get(commandsCtx).call(toggleLinkCommand.key),
    "Mod-Shift-h": highlight,
    "Mod-d": duplicateSelected,
    "Mod-Alt-t": groupSelected,
    "Mod-Shift-ArrowUp": moveBlock(-1),
    "Mod-Shift-ArrowDown": moveBlock(1),
    "Alt-Shift-ArrowUp": moveBlock(-1),
    "Alt-Shift-ArrowDown": moveBlock(1),
    ArrowUp: stepBlockSelection(-1),
    ArrowDown: stepBlockSelection(1),
    // With blocks selected, Shift and an arrow grow the selection; in text they select text as usual.
    "Shift-ArrowUp": extendBlockSelection(-1),
    "Shift-ArrowDown": extendBlockSelection(1),
    Escape: (state, dispatch, view) => leaveRange(state, dispatch, view) || selectCurrentBlock(state, dispatch, view),
    "Mod-Enter": flip,
    Enter: enterInToggle,
    Backspace: (state, dispatch, view) => deleteRange(state, dispatch, view) || backspaceInToggle(state, dispatch, view),
    Delete: deleteRange,
  };
  for (const [digit, kind] of Object.entries(DIGITS)) map[`Mod-Alt-${digit}`] = turnSelected(kind);
  return map;
}

/** Ctrl+/ opens the block menu for the block around the caret, or for the blocks selected. */
function openMenuHere(view: EditorView): boolean {
  const picked = pickedBlocks(view.state.selection);
  const block = currentBlock(view.state);
  if (!block) return false;
  const caret = (() => {
    try {
      return view.coordsAtPos(view.state.selection.from);
    } catch {
      return view.dom.getBoundingClientRect();
    }
  })();
  openBlockMenu(view, picked?.from ?? block.pos, () => caret, picked && picked.count > 1 ? picked : undefined);
  return true;
}

export const notionKeymap = $prose((ctx) => {
  let handle: ((view: EditorView, event: KeyboardEvent) => boolean) | null = null;
  return new Plugin({
    key: new PluginKey("KASTEN_NOTION_KEYMAP"),
    props: {
      handleDOMEvents: {
        keydown: (view, event) => {
          handle ??= keydownHandler({ ...bindings(ctx), "Mod-/": (_s, _d, v) => (v ? openMenuHere(v) : false) });
          const used = guardSelectedBlock(view, event) || handle(view, event);
          // Returning true only stops ProseMirror; the browser's own action must stop too.
          if (used) event.preventDefault();
          return used;
        },
      },
    },
  });
});

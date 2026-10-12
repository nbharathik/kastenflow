// The keyboard of the editor: Google Slides' shortcuts for formatting, lists
// and indent, plus what the arrow, delete and select-all keys do already.

import { baseKeymap, chainCommands, deleteSelection, joinBackward, selectNodeBackward } from "prosemirror-commands";
import { redo, undo } from "prosemirror-history";
import { keydownHandler } from "prosemirror-keymap";
import { Plugin } from "prosemirror-state";

import { backspaceStart, enter, indent, moveParagraphs, setAlign, softBreak, toggleList } from "./block-commands.ts";
import { linkAtSelection } from "./format-state.ts";
import { type Command, clearFormatting, toggleFlag, toggleScript } from "./mark-commands.ts";
import { type EditorContext, wholeText } from "./selection-info.ts";

/** What the editor's keys ask of whoever hosts it. */
export interface KeyHooks {
  /** Escape: leave the text. */
  escape(): void;
  /** Mod-k: the host asks for an address and calls back with it. `current` is the link the selection is in. */
  linkRequest(current: string | null): void;
  /** Whether an address typed before Enter becomes a link. */
  autoLinks?(): boolean;
}

/**
 * The key bindings. Shifted keys arrive in upper case (or as a symbol, for
 * digits), so those are bound in both forms.
 */
export function keyBindings(ctx: EditorContext, hooks: KeyHooks): Record<string, Command> {
  const custom: Record<string, Command> = {};
  const bind = (keys: string[], command: Command): void => {
    for (const key of keys) custom[key] = command;
  };
  const letter = (key: string, command: Command): void => bind([`Mod-${key}`, `Mod-${key.toUpperCase()}`], command);
  const shifted = (key: string, command: Command): void => bind([`Mod-Shift-${key}`, `Mod-Shift-${key.toUpperCase()}`], command);

  letter("b", toggleFlag("bold", ctx));
  letter("i", toggleFlag("italic", ctx));
  letter("u", toggleFlag("underline", ctx));
  shifted("x", toggleFlag("strike", ctx));
  shifted("e", setAlign("center"));
  shifted("l", setAlign("left"));
  shifted("r", setAlign("right"));
  shifted("j", setAlign("justify"));
  bind(["Mod-.", "Mod->"], toggleScript("super", ctx));
  bind(["Mod-,", "Mod-<"], toggleScript("sub", ctx));
  bind(["Mod-Shift-7", "Mod-Shift-&"], toggleList("number", ctx));
  bind(["Mod-Shift-8", "Mod-Shift-*"], toggleList("bullet", ctx));
  letter("k", (state) => {
    hooks.linkRequest(linkAtSelection(state));
    return true;
  });
  bind(["Tab", "Alt-Shift-ArrowRight"], indent(1));
  bind(["Shift-Tab", "Alt-Shift-ArrowLeft"], indent(-1));
  bind(["Alt-Shift-ArrowUp"], moveParagraphs(-1));
  bind(["Alt-Shift-ArrowDown"], moveParagraphs(1));
  bind(["Enter"], enter(ctx, hooks.autoLinks));
  bind(["Shift-Enter"], softBreak);
  bind(["Backspace"], chainCommands(deleteSelection, backspaceStart(ctx), joinBackward, selectNodeBackward));
  // Local history: while the box is being edited, undo is the box's own, even when it has nothing left to undo,
  // so the host's undo never acts on the deck under the words being typed.
  bind(["Mod-z"], (state, dispatch) => undo(state, dispatch) || true);
  bind(["Mod-y", "Mod-Shift-z", "Mod-Shift-Z"], (state, dispatch) => redo(state, dispatch) || true);
  letter("a", (state, dispatch) => {
    dispatch?.(state.tr.setSelection(wholeText(state)));
    return true;
  });
  bind(["Escape"], () => {
    hooks.escape();
    return true;
  });
  bind(["Mod-\\"], clearFormatting);
  return { ...baseKeymap, ...custom };
}

/**
 * Handles the keys. A key the editor takes goes no further, so that the
 * host's own shortcuts (its undo, above all) do not act on it as well.
 */
export function keysPlugin(bindings: Record<string, Command>): Plugin {
  const handle = keydownHandler(bindings);
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        const handled = handle(view, event);
        if (handled) event.stopPropagation();
        return handled;
      },
    },
  });
}

import { canCopyHere, copyHere, pasteHere } from "../clipboard/commands.ts";
import { placeFor } from "../clipboard/place.ts";
import { askInPlace } from "../clipboard/store.ts";
import { selectAllHere } from "../select-all/select-all.ts";
import type { Command } from "./types.ts";

/**
 * Undo, redo and the clipboard. The keys of cut, copy and paste are the browser's own (`native`): the copy, cut and paste events it
 * makes do the work wherever the focus is in the editor (`clipboard/events.ts`); running one of these is what a menu or a button does,
 * and it asks the browser for the clipboard. What they act on is where the person was: the slides of the filmstrip or the grid, the
 * blocks of the slide otherwise.
 */
export const editCommands: Command[] = [
  {
    id: "edit.undo",
    label: "Undo",
    icon: "undo-2",
    keys: ["Mod+Z"],
    scope: "global",
    enabled: (s) => s.canUndo,
    run: ({ session }) => session.undo(),
  },
  {
    id: "edit.redo",
    label: "Redo",
    icon: "redo-2",
    keys: ["Mod+Shift+Z", "Mod+Y"],
    scope: "global",
    enabled: (s) => s.canRedo,
    run: ({ session }) => session.redo(),
  },
  {
    id: "edit.cut",
    label: "Cut",
    icon: "scissors",
    keys: ["Mod+X"],
    scope: "canvas",
    native: true,
    enabled: (s, _ui, _host, context) => canCopyHere(context, s.selection),
    run: (context) => copyHere(context, true),
  },
  {
    id: "edit.copy",
    label: "Copy",
    icon: "copy",
    keys: ["Mod+C"],
    scope: "canvas",
    native: true,
    enabled: (s, _ui, _host, context) => canCopyHere(context, s.selection),
    run: (context) => copyHere(context),
  },
  {
    id: "edit.paste",
    label: "Paste",
    icon: "clipboard-paste",
    keys: ["Mod+V"],
    scope: "canvas",
    native: true,
    run: (context) => pasteHere(context),
  },
  {
    id: "edit.paste-in-place",
    label: "Paste in place",
    icon: "clipboard-paste",
    keys: ["Mod+Shift+V"],
    scope: "canvas",
    // The browser pastes for this key too: say that it is the one that keeps the place.
    native: () => askInPlace(),
    run: (context) => pasteHere(context, true),
  },
  {
    id: "edit.duplicate",
    label: "Duplicate",
    icon: "copy-plus",
    keys: ["Mod+D"],
    scope: "canvas",
    enabled: (s, _ui, _host, context) => canCopyHere(context, s.selection),
    run: (context) => (placeFor(context) === "slides" ? void context.session.slides.duplicate() : context.session.elements.duplicate()),
  },
  {
    id: "edit.delete",
    label: "Delete",
    icon: "trash",
    keys: ["Delete", "Backspace"],
    scope: "canvas",
    enabled: (s, _ui, _host, context) => canCopyHere(context, s.selection),
    // With cells picked in a table, Delete empties the cells: the table goes only when it is the frame that is selected.
    run: (context) => {
      const place = placeFor(context);
      if (place === "slides") context.session.slides.remove();
      else if (place === "cells") context.session.tables.clear();
      else context.session.elements.remove();
    },
  },
  {
    id: "edit.select-all",
    label: "Select all",
    keys: ["Mod+A"],
    scope: "canvas",
    // Where the person is decides what it takes: the words of an open text box, the elements of the slide, the slides of the
    // filmstrip or the grid, the text of the outline or of a panel.
    run: (context) => selectAllHere(context),
  },
  {
    id: "edit.find",
    label: "Find and replace",
    icon: "replace",
    keys: ["Mod+F", "Mod+H"],
    scope: "global",
    run: ({ ui }) => ui.openDialog("find"),
  },
];

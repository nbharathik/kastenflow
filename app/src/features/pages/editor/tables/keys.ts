// Tab and Shift+Tab move between cells (the table keymap of the editor does
// that); Tab in the very last cell adds a row, so a table can be filled in
// without leaving the keyboard.

import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";

import { tabPastEnd } from "./ops";

export const tableKeys = $prose(
  () =>
    new Plugin({
      key: new PluginKey("KASTEN_TABLE_KEYS"),
      props: {
        handleKeyDown(view, event) {
          if (event.key !== "Tab" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
          return tabPastEnd(view.state, view.dispatch);
        },
      },
    }),
);

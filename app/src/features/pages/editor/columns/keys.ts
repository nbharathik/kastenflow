// Alt+Left and Alt+Right move the block around the caret into the column on
// that side: the keyboard way of dragging a block across. On a Mac the same
// keys move by word in text, so there they act on a selected block only.

import { keydownHandler } from "@milkdown/kit/prose/keymap";
import { NodeSelection, Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";

import { moveAcross } from "./ops";

const mac = () => typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

export const columnsKeys = $prose(() => {
  const handle = keydownHandler({
    "Alt-ArrowLeft": moveAcross(-1),
    "Alt-ArrowRight": moveAcross(1),
    "Mod-Alt-ArrowLeft": moveAcross(-1),
    "Mod-Alt-ArrowRight": moveAcross(1),
  });
  return new Plugin({
    key: new PluginKey("KASTEN_COLUMNS_KEYS"),
    props: {
      handleKeyDown(view, event) {
        // Option+Arrow is a word jump on a Mac; Cmd+Option+Arrow always moves the block.
        if (mac() && event.altKey && !event.metaKey && !(view.state.selection instanceof NodeSelection)) return false;
        return handle(view, event);
      },
    },
  });
});

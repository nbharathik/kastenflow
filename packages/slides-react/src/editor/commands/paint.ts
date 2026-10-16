import { applyPaint, capturePaint } from "../toolbar/paint.ts";
import type { Command } from "./types.ts";

/** Whether there is anything to pick a format up from: something selected, a text box open, or a brush already in hand. */
const canTake: Command["enabled"] = (state, ui) => ui.paint !== null || ui.text !== null || state.selection.length > 0;

/**
 * Paint format. The brush: pick the format up and lay it on the next thing picked (or let it go). Copy format and Paste format do it in two
 * steps with the keys: the format is held until another is picked up, and laid on whatever is selected, as often as is wanted. The two with
 * keys are `text.` commands, so the list of shortcuts shows them with the text ones, as Google Slides names them.
 */
export const paintCommands: Command[] = [
  {
    id: "format.paint",
    label: "Paint format",
    icon: "paintbrush",
    enabled: canTake,
    checked: (_state, ui) => ui.paint !== null,
    run: (context) => {
      if (context.ui.state.paint) return context.ui.setPaint(null);
      const taken = capturePaint(context);
      if (taken) context.ui.setPaint(taken);
    },
  },
  {
    id: "text.paint-copy",
    label: "Copy format",
    icon: "paintbrush",
    keys: ["Mod+Alt+C"],
    scope: "global",
    enabled: canTake,
    run: (context) => {
      const taken = capturePaint(context);
      if (taken) context.ui.setHeldFormat(taken);
    },
  },
  {
    id: "text.paint-paste",
    label: "Paste format",
    icon: "paintbrush",
    keys: ["Mod+Alt+V"],
    scope: "global",
    // On a box being written in the words selected would be the target; the format goes on whole boxes, so it waits for the box to be left.
    enabled: (state, ui) => ui.heldFormat !== null && ui.text === null && state.selection.length > 0,
    run: ({ session, ui }) => {
      const held = ui.state.heldFormat;
      if (held) applyPaint(session, held, session.state.selection);
    },
  },
];

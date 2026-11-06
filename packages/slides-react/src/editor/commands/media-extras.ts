// Sound, Mermaid text, the deck's fonts and its spelling check: each opens a dialog of its own. The dialogs do the work through
// slides-core operations (`add_elements`, `add_mermaid`, `update_mermaid`, `set_deck_fonts`, `set_dictionary`).

import { mermaidOf } from "../media/mermaid.ts";
import type { Command } from "./types.ts";

export const mediaExtrasCommands: Command[] = [
  { id: "insert.audio", label: "Audio…", icon: "volume-2", run: ({ ui }) => ui.openDialog("audio") },
  { id: "insert.mermaid", label: "Mermaid diagram…", icon: "route", run: ({ ui }) => ui.openDialog("mermaid") },
  {
    id: "insert.mermaid-edit",
    label: "Edit Mermaid text…",
    icon: "route",
    enabled: (state, _ui, _host, context) => state.selection.length === 1 && context !== undefined && mermaidOf(context.session.elements.find()[0]) !== null,
    run: ({ ui }) => ui.openDialog("mermaid"),
  },
  { id: "deck.fonts", label: "Fonts…", icon: "type", run: ({ ui }) => ui.openDialog("fonts") },
  { id: "deck.spelling", label: "Check spelling…", icon: "case-sensitive", run: ({ ui }) => ui.openDialog("spelling") },
];

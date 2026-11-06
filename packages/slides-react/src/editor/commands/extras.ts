// Commands for the Design ideas panel and its blocks, the undo history panel, and the icon picker.

import { insertBlock } from "../ideas/apply.ts";
import { BLOCKS } from "../ideas/blocks.ts";
import type { Command } from "./types.ts";

export const extraCommands: Command[] = [
  {
    id: "view.ideas-panel",
    label: "Design ideas",
    icon: "layout-template",
    checked: (_, ui) => ui.panel === "ideas",
    run: ({ ui }) => ui.togglePanel("ideas"),
  },
  {
    id: "view.history-panel",
    label: "Undo history",
    icon: "clock",
    checked: (_, ui) => ui.panel === "history",
    run: ({ ui }) => ui.togglePanel("history"),
  },
  {
    id: "insert.icon",
    label: "Icon…",
    icon: "sparkles",
    run: ({ ui }) => ui.openDialog("icons"),
  },
  ...BLOCKS.map(
    (block): Command => ({
      id: `insert.block.${block.kind}`,
      label: `${block.label} block`,
      icon: "layout-dashboard",
      run: ({ session }) => void insertBlock(session, block.kind),
    }),
  ),
];

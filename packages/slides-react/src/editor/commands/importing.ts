// Commands for importing: slides from a PowerPoint file, and from Markdown or a note.

import type { Command } from "./types.ts";

export const importingCommands: Command[] = [
  {
    id: "file.import-pptx",
    label: "Import slides from PowerPoint…",
    icon: "file-plus",
    run: ({ ui }) => ui.openDialog("import"),
  },
  {
    // Markdown that is pasted or opened from a file, or (where the host has notes) a note: cut at its headings into a slide each.
    id: "file.import-markdown",
    label: "Import Markdown or a note…",
    icon: "file-text",
    run: ({ ui }) => ui.openDialog("import-markdown"),
  },
];

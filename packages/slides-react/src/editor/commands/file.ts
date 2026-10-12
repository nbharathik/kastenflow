import type { Command } from "./types.ts";

type Format = "pptx" | "pdf" | "png" | "markdown" | "html";

const download = (format: Format, label: string): Command => ({
  id: `file.export-${format}`,
  label,
  icon: "file-down",
  // A PDF is made by printing and a picture has a size, so both have choices to make first.
  run: ({ ui }) => (format === "pdf" ? ui.openDialog("export") : format === "png" ? ui.openDialog("png") : ui.actions.exportAs?.(format)),
});

/** File: what leaves the editor. */
export const fileCommands: Command[] = [
  {
    id: "file.page-setup",
    label: "Page setup…",
    icon: "rectangle-horizontal",
    run: ({ ui }) => ui.openDialog("page"),
  },
  download("pptx", "Microsoft PowerPoint (.pptx)"),
  download("pdf", "PDF document (.pdf)"),
  download("png", "PNG images (.png)"),
  download("markdown", "Markdown outline (.md)"),
  download("html", "Web page (.html)"),
  {
    id: "file.print",
    label: "Print…",
    icon: "printer",
    keys: ["Mod+P"],
    scope: "global",
    run: ({ ui }) => ui.openDialog("export"),
  },
];

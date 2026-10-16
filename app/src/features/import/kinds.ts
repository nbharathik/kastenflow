// The tools notes come from, and how to get a folder out of each: what the
// Import view shows beside the folder field.

import type { ImportKind } from "../../lib/vault/types";
import { lineIcon } from "../../ui/glyph";

export interface KindInfo {
  id: ImportKind;
  name: string;
  icon: string;
  /** What comes across. */
  brings: string;
  /** Getting the folder to import, step by step. */
  steps: string[];
  /** What the folder looks like, as the field's example. */
  example: string;
}

export const KINDS: readonly KindInfo[] = [
  {
    id: "obsidian",
    name: "Obsidian",
    icon: lineIcon("gem"),
    brings: "Notes and their folders, daily notes, canvases, attachments and PDFs.",
    steps: ["Use the vault's own folder: the one with the hidden .obsidian folder in it.", "Nothing in it is changed; KastenFlow copies what it needs."],
    example: "~/Documents/My Vault",
  },
  {
    id: "notion",
    name: "Notion",
    icon: lineIcon("notebook"),
    brings: "Pages and sub-pages, callouts, images, and databases as tags with their columns.",
    steps: [
      "In Notion, open Settings, then Export all workspace content (or a page's ··· menu, then Export).",
      "Choose Markdown & CSV, and include sub-pages.",
      "Unzip the file Notion sends, and use the unzipped folder.",
    ],
    example: "~/Downloads/Export-2b5fd8a1",
  },
  {
    id: "heptabase",
    name: "Heptabase",
    icon: lineIcon("map"),
    brings: "Cards, whiteboards with everything where it was, and journal days.",
    steps: ["In Heptabase, open Settings, then Backup, and make a backup.", "Unzip it if it is a zip, and use the folder with All-Data.json in it."],
    example: "~/Documents/Heptabase-Backup",
  },
  {
    id: "bundle",
    name: "KastenFlow bundle",
    icon: lineIcon("project"),
    brings: "A project exported from KastenFlow: its pages, whiteboards, decks, pictures, PDFs, tags and the works it cites.",
    steps: [
      "Use the folder an export made: the one with kastenflow-bundle.json in it.",
      "Nothing already in this vault is overwritten: a project, picture or tag that clashes is renamed or kept, and the preview says which.",
    ],
    example: "~/Documents/seaside-trip-bundle",
  },
  {
    id: "markdown",
    name: "Markdown folder",
    icon: lineIcon("folder"),
    brings: "Any folder of .md files: from Bear, Logseq, Typora or your own. Subfolders come too.",
    steps: ["Use the folder that holds the notes."],
    example: "~/Documents/Notes",
  },
];

/** How to copy a folder's path on this computer. */
export function pathTip(): string {
  const platform = typeof navigator === "undefined" ? "" : navigator.platform;
  if (/Mac/i.test(platform)) return "In Finder, select the folder and press ⌥⌘C to copy its path.";
  if (/Win/i.test(platform)) return "In Explorer, hold Shift, right-click the folder and choose Copy as path.";
  return "Paste the folder's full path, or start it with ~/ for your home folder.";
}

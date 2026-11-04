// What Insert offers, as one list: the Insert menu (two levels: a group, then its items) and the Insert gallery (a box to type in and
// the same items under it) both read it, so a thing is named, described, found and enabled in one place. An item is a command; what
// the host does not have (pages, diagrams) is left out because its command cannot be done there.

import { type CommandContext, commandOf, isEnabled, keysOf, runCommand } from "../commands/index.ts";
import { BLOCKS } from "../ideas/blocks.ts";
import type { IconName } from "../ui/icons.ts";

export type InsertGroupId = "text" | "media" | "shapes" | "data" | "pages" | "smart";

export interface InsertGroup {
  id: InsertGroupId;
  label: string;
  icon: IconName;
}

/** The groups, in the order of the menu and the gallery. */
export const INSERT_GROUPS: readonly InsertGroup[] = [
  { id: "text", label: "Text & content", icon: "type" },
  { id: "media", label: "Media", icon: "image" },
  { id: "shapes", label: "Shapes & lines", icon: "shapes" },
  { id: "data", label: "Data", icon: "table" },
  { id: "pages", label: "Pages & links", icon: "link" },
  { id: "smart", label: "Smart parts", icon: "layout-dashboard" },
];

export interface InsertEntry {
  /** The command that does it. */
  command: string;
  group: InsertGroupId;
  /** Says what it makes, in a line. */
  description: string;
  /** Other words it may be looked for by. */
  keywords: readonly string[];
  /** It needs something of the host (pages, diagrams): where the host has none, it is not listed at all. */
  hostOnly?: true;
  /** Menu groups, besides its own, that list it too (the gallery lists it once, under its own group). */
  alsoIn?: readonly InsertGroupId[];
}

/** Every item that is a command (shapes and lines are listed apart, from their own tables). */
export const INSERT_ENTRIES: readonly InsertEntry[] = [
  { command: "insert.text-box", group: "text", description: "Type words anywhere on the slide", keywords: ["words", "paragraph", "write", "label"] },
  { command: "insert.math", group: "text", description: "An equation, written in LaTeX", keywords: ["equation", "latex", "katex", "maths"] },
  { command: "insert.code", group: "text", description: "Source code with its colours", keywords: ["source", "program", "syntax", "snippet"] },
  { command: "insert.citation", group: "text", description: "A reference from your bibliography", keywords: ["reference", "bibliography", "cite", "bibtex", "paper"] },
  { command: "insert.emoji", group: "text", description: "A face, a hand or a symbol, found by name", keywords: ["smiley", "face", "icon", "symbol", "reaction", "emoticon"] },

  { command: "insert.image", group: "media", description: "A picture from this computer", keywords: ["picture", "photo", "upload", "file"] },
  { command: "insert.gallery", group: "media", description: "A picture you already have in the vault", keywords: ["picture", "photo", "images", "drawer"] },
  { command: "insert.diagram", group: "media", description: "A diagram you drew, as a picture you can edit again", keywords: ["flowchart", "drawio", "architecture"], hostOnly: true },
  { command: "insert.code-picture", group: "media", description: "A chart or drawing made by a small program, kept in the picture so you can edit and run it again", keywords: ["chart", "graph", "svg", "generate", "script", "javascript", "timeline", "funnel", "matrix", "org chart", "icons"], hostOnly: true },
  { command: "insert.audio", group: "media", description: "A sound that plays while presenting, by itself or on a click", keywords: ["music", "sound", "mp3", "narration", "voice"] },
  { command: "insert.video", group: "media", description: "A video file or a link to one", keywords: ["movie", "clip", "mp4"] },
  { command: "insert.icon", group: "media", description: "A small line icon, found by name, in the colour and size you pick", keywords: ["symbol", "glyph", "pictogram", "lucide", "svg", "arrow", "check"] },

  { command: "insert.table", group: "data", description: "Rows and columns; pick the size on a grid", keywords: ["grid", "rows", "columns", "cells", "spreadsheet"] },
  { command: "insert.chart", group: "data", description: "Bars of a small table of numbers; change the numbers and the type in the format options", keywords: ["graph", "bar", "column", "plot", "data", "numbers", "statistics"] },
  { command: "insert.chart.line", group: "data", description: "A line through the numbers of each series", keywords: ["graph", "plot", "trend", "data", "numbers", "chart"] },
  { command: "insert.chart.pie", group: "data", description: "Slices of a circle, one for each share", keywords: ["graph", "doughnut", "share", "percent", "data", "chart"] },
  { command: "insert.token-probs", group: "data", description: "The next-word odds of a language model, as bars", keywords: ["tokens", "next word", "logits", "llm", "bars", "chart"] },

  { command: "insert.page", group: "pages", description: "A page of the vault: embedded, as text, a section, or a link", keywords: ["note", "vault", "embed", "section", "kasten", "kastenflow"], hostOnly: true },
  { command: "insert.embed", group: "pages", description: "A live web page, scaled to fit its box", keywords: ["web page", "website", "iframe", "url", "live", "browser"], alsoIn: ["media"] },
  { command: "text.link", group: "pages", description: "Make the selected words or boxes open a page, slide or address", keywords: ["hyperlink", "url", "address", "anchor"] },
  { command: "insert.qr", group: "pages", description: "A code a phone can scan, from the slide's link or any words", keywords: ["barcode", "scan", "link", "url", "phone"] },

  { command: "insert.chat", group: "smart", description: "A conversation between a person and an assistant", keywords: ["chat", "messages", "dialogue", "prompt", "llm"] },
  { command: "insert.card-grid", group: "smart", description: "Cards in a row, each with a title and words", keywords: ["cards", "tiles", "boxes"] },
  { command: "insert.step-label", group: "smart", description: "Names the step of the slide being shown", keywords: ["step", "counter", "progress"] },
  { command: "insert.timer", group: "smart", description: "A countdown that runs while presenting", keywords: ["countdown", "clock", "stopwatch", "minutes", "time"] },
  { command: "insert.mermaid", group: "smart", description: "A flowchart written as text, drawn as shapes you can restyle", keywords: ["flowchart", "diagram", "graph", "text", "markdown", "chart"] },
  // Ready-made blocks (the Design ideas panel lists them too): groups of shapes and text in the theme's colours.
  ...BLOCKS.map((block): InsertEntry => ({ command: `insert.block.${block.kind}`, group: "smart", description: block.description, keywords: [...block.keywords, "block", "template", "ready-made"] })),
];

/** The group an entry is in, as the gallery heads it. */
export const groupLabel = (id: InsertGroupId): string => INSERT_GROUPS.find((group) => group.id === id)?.label ?? id;

/** An item that can be done now, ready to be listed. */
export interface InsertItem extends InsertEntry {
  label: string;
  icon?: IconName;
  /** How its keys read on this system. */
  keys?: string;
  /** Whether the host or the state lets it be done. */
  enabled: boolean;
}

/** The items of a group (all of them when none is named), each with what its command says of it. Items whose command does not exist are left out. */
export function insertItems(ctx: CommandContext, group?: InsertGroupId): InsertItem[] {
  return INSERT_ENTRIES.filter((entry) => group === undefined || entry.group === group || entry.alsoIn?.includes(group)).flatMap((entry) => {
    let command;
    try {
      command = commandOf(entry.command);
    } catch {
      return [];
    }
    const keys = keysOf(entry.command);
    const enabled = isEnabled(command, ctx);
    if (entry.hostOnly && !enabled) return [];
    return [{ ...entry, label: command.label, ...(command.icon ? { icon: command.icon } : {}), ...(keys ? { keys } : {}), enabled }];
  });
}

/** Does an item. */
export const runInsert = (item: Pick<InsertEntry, "command">, ctx: CommandContext): Promise<void> => runCommand(item.command, ctx);

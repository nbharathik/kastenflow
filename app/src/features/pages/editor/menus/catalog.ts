// What the slash menu and "Turn into" offer, in Notion's order and words, and
// how a typed query finds them. Pure data: slash.ts and block-menu.ts run them.

import type { TagViewKind } from "../../../../lib/vault/types";
import type { WriteAction } from "../../../chat/types";
import { NOTION_COLORS, type NotionColor } from "../blocks/color";

/** Blocks a text block can turn into. */
export type BlockKind = "text" | "h1" | "h2" | "h3" | "bullet" | "numbered" | "todo" | "toggle" | "quote" | "callout" | "code" | "math";
/** Blocks that are inserted rather than turned into. */
export type InsertKind = "divider" | "image" | "table" | "inline-equation";

export type ChoiceAction =
  | { type: "turn"; kind: BlockKind }
  | { type: "insert"; kind: InsertKind }
  | { type: "color"; mark: "text_color" | "bg_color"; color: NotionColor | null }
  /** Opens the link menu: to name a new sub-page, pick a page, pick a
   * whiteboard to embed, or pick or make a database (on a `view` of a kind). */
  | { type: "link"; mode: "page" | "link" | "embed" | "board" | "database"; view?: TagViewKind }
  /** Picks files from the computer and attaches them, as a paste does. */
  | { type: "files" }
  /** Opens the AI panel for this in the page. */
  | { type: "ai"; action: WriteAction }
  /** Opens the template gallery to fill the empty page. */
  | { type: "template" }
  /** Opens the menu of slide decks to show in the page, and a new one. */
  | { type: "deck" }
  /** Opens the menu of diagrams to show in the page, and a new one (its editor opens at once). */
  | { type: "diagram" }
  /** Starts two sections and draws the page as slide-like cards (`layout: sections`). */
  | { type: "smart" };

export interface Choice {
  key: string;
  label: string;
  icon: string;
  iconClass?: string;
  /** The Markdown shortcut, shown on the right as in Notion. */
  hint?: string;
  description: string;
  keywords: string[];
  section: string;
  action: ChoiceAction;
}

const turn = (kind: BlockKind) => ({ type: "turn", kind }) as const;
const insert = (kind: InsertKind) => ({ type: "insert", kind }) as const;

const BASIC = "Basic blocks";
const MEDIA = "Media";
const ADVANCED = "Advanced";
const DATABASE = "Database";
const COLOUR = "Colour";
const AI = "AI";
const TEMPLATES = "Templates";

/** A database view in the page: pick a tag's, or make a new database. */
const dbView = (view: TagViewKind, label: string, icon: string, description: string, keywords: string[]): Choice => ({
  key: `${view}-view`,
  label,
  icon,
  description,
  keywords: [...keywords, "database", "view", "inline", "notes"],
  section: DATABASE,
  action: { type: "link", mode: "database", view },
});

export const BLOCK_CHOICES: Choice[] = [
  { key: "text", label: "Text", icon: "icon:text", description: "Just start writing with plain text.", keywords: ["paragraph", "plain", "p"], section: BASIC, action: turn("text") },
  { key: "h1", label: "Heading 1", icon: "icon:heading-1", hint: "#", description: "Big section heading.", keywords: ["h1", "title", "#"], section: BASIC, action: turn("h1") },
  { key: "h2", label: "Heading 2", icon: "icon:heading-2", hint: "##", description: "Medium section heading.", keywords: ["h2", "subtitle", "##"], section: BASIC, action: turn("h2") },
  { key: "h3", label: "Heading 3", icon: "icon:heading-3", hint: "###", description: "Small section heading.", keywords: ["h3", "###"], section: BASIC, action: turn("h3") },
  { key: "bullet", label: "Bulleted list", icon: "icon:list", hint: "-", description: "Create a simple bulleted list.", keywords: ["ul", "unordered", "bullets", "-"], section: BASIC, action: turn("bullet") },
  { key: "numbered", label: "Numbered list", icon: "icon:list-ordered", hint: "1.", description: "Create a list with numbering.", keywords: ["ol", "ordered", "numbers", "1."], section: BASIC, action: turn("numbered") },
  { key: "todo", label: "To-do list", icon: "icon:todo", hint: "[]", description: "Track tasks with a to-do list.", keywords: ["todo", "task", "checkbox", "check", "[]"], section: BASIC, action: turn("todo") },
  { key: "toggle", label: "Toggle list", icon: "icon:toggle", description: "Toggles can hide and show content inside.", keywords: ["toggle", "collapse", "details", "fold", "expand"], section: BASIC, action: turn("toggle") },
  { key: "page", label: "Page", icon: "icon:page", description: "Add a sub-page inside this page.", keywords: ["subpage", "sub-page", "new page", "child", "nest"], section: BASIC, action: { type: "link", mode: "page" } },
  { key: "quote", label: "Quote", icon: "icon:quote", hint: ">", description: "Capture a quote.", keywords: ["blockquote", "citation", ">"], section: BASIC, action: turn("quote") },
  { key: "divider", label: "Divider", icon: "icon:divider", hint: "---", description: "Visually divide blocks.", keywords: ["hr", "rule", "line", "separator", "---"], section: BASIC, action: insert("divider") },
  { key: "callout", label: "Callout", icon: "icon:bulb", description: "Make writing stand out.", keywords: ["note", "tip", "warning", "info", "admonition", "aside"], section: BASIC, action: turn("callout") },
  { key: "link", label: "Link to page", icon: "icon:link", hint: "[[", description: "Link to an existing page.", keywords: ["mention", "reference", "wiki", "[["], section: BASIC, action: { type: "link", mode: "link" } },
  { key: "image", label: "Image", icon: "icon:image", description: "Upload an image or embed one from a link.", keywords: ["picture", "photo", "img", "media"], section: MEDIA, action: insert("image") },
  { key: "embed", label: "Embed a page", icon: "icon:layers", hint: "![[", description: "Show another page's text here, kept up to date.", keywords: ["embed", "transclude", "include", "show", "page", "![["], section: MEDIA, action: { type: "link", mode: "embed" } },
  { key: "file", label: "File", icon: "icon:attach", description: "Attach a file from your computer.", keywords: ["attachment", "attach", "upload", "pdf", "document", "spreadsheet"], section: MEDIA, action: { type: "files" } },
  { key: "code", label: "Code", icon: "icon:code", hint: "```", description: "Capture a code snippet.", keywords: ["codeblock", "snippet", "pre", "```"], section: MEDIA, action: turn("code") },
  { key: "table", label: "Table", icon: "icon:table", description: "Add a simple table.", keywords: ["grid", "rows", "columns"], section: ADVANCED, action: insert("table") },
  { key: "math", label: "Block equation", icon: "icon:sigma", hint: "$$", description: "Display a standalone equation.", keywords: ["math", "equation", "latex", "tex", "katex", "formula", "$$"], section: ADVANCED, action: turn("math") },
  { key: "inline-equation", label: "Inline equation", icon: "icon:radical", hint: "$", description: "Write an equation inside a line of text.", keywords: ["math", "equation", "inline", "latex", "tex", "katex", "formula", "$"], section: ADVANCED, action: insert("inline-equation") },
  dbView("table", "Table view", "icon:table", "A database of notes as a table, with properties as columns.", ["table", "spreadsheet", "rows", "columns"]),
  dbView("kanban", "Board view", "icon:kanban", "A database of notes as a board, by status.", ["board", "kanban", "status", "columns"]),
  dbView("list", "List view", "icon:list", "A database of notes as a simple list.", ["list"]),
  dbView("gallery", "Gallery view", "icon:gallery", "A database of notes as cards with their covers.", ["gallery", "cards", "grid", "images"]),
  dbView("calendar", "Calendar view", "icon:calendar", "A database of notes on a calendar, by date.", ["calendar", "dates", "schedule", "month"]),
  { key: "database", label: "Database", icon: "icon:database", description: "Show an existing tag database in the page.", keywords: ["table", "gallery", "database", "kanban", "board", "list", "inline", "tag", "view", "existing"], section: DATABASE, action: { type: "link", mode: "database" } },
  { key: "ask-ai", label: "Ask AI…", icon: "icon:sparkle", description: "Ask AI to write or change something here.", keywords: ["ai", "write", "draft", "assistant", "generate"], section: AI, action: { type: "ai", action: "ask" } },
  { key: "continue-ai", label: "Continue writing", icon: "icon:sparkle", description: "AI carries on from where you are.", keywords: ["ai", "continue", "more", "next", "write"], section: AI, action: { type: "ai", action: "continue" } },
  { key: "summarize-ai", label: "Summarize page", icon: "icon:sparkle", description: "AI sums up the page in a few points.", keywords: ["ai", "summary", "summarise", "tldr", "points"], section: AI, action: { type: "ai", action: "summarize" } },
  // Offered only while the page is empty (slash.ts).
  { key: "template", label: "Template…", icon: "icon:template", description: "Start this empty page from a template.", keywords: ["template", "start", "use"], section: TEMPLATES, action: { type: "template" } },
  // Before the whiteboard, which also answers to "diagram" and "draw": typing either finds the diagram first.
  { key: "diagram", label: "Diagram", icon: "icon:diagram", description: "Show a diagram in the page, or draw a new one.", keywords: ["diagram", "drawio", "flowchart", "flow", "chart", "architecture", "uml", "sketch", "draw"], section: ADVANCED, action: { type: "diagram" } },
  { key: "board", label: "Whiteboard", icon: "icon:board", description: "Embed a whiteboard to work on in the page.", keywords: ["board", "canvas", "whiteboard", "embed", "diagram", "draw"], section: ADVANCED, action: { type: "link", mode: "board" } },
  { key: "deck", label: "Deck", icon: "icon:present", description: "Show a slide deck in the page, slide by slide.", keywords: ["deck", "slides", "slideshow", "presentation", "powerpoint", "talk"], section: ADVANCED, action: { type: "deck" } },
  { key: "smart-page", label: "Smart page", icon: "icon:layout", description: "Cut the page into sections you can present, one slide each.", keywords: ["smart", "sections", "cards", "frames", "layout", "present", "slides", "talk"], section: ADVANCED, action: { type: "smart" } },
];

const colourName = (color: string) => color[0]!.toUpperCase() + color.slice(1);

/** Notion's colour rows: text colours, then backgrounds, each led by "Default". */
export function colorChoices(): Choice[] {
  const text = [null, ...NOTION_COLORS].map<Choice>((color) => ({
    key: `color-${color ?? "default"}`,
    label: color ? colourName(color) : "Default",
    icon: "A",
    iconClass: `kasten-swatch kasten-text_color-${color ?? "default"}`,
    description: color ? `Colour the text ${color}.` : "Remove the text colour.",
    keywords: color ? ["color", "colour", "text"] : ["color", "colour", "text", "clear"],
    section: COLOUR,
    action: { type: "color", mark: "text_color", color },
  }));
  const background = [null, ...NOTION_COLORS].map<Choice>((color) => ({
    key: `background-${color ?? "default"}`,
    label: `${color ? colourName(color) : "Default"} background`,
    icon: "A",
    iconClass: `kasten-swatch kasten-bg_color-${color ?? "default"}`,
    description: color ? `Highlight the text in ${color}.` : "Remove the background colour.",
    keywords: ["color", "colour", "highlight", "bg"],
    section: COLOUR,
    action: { type: "color", mark: "bg_color", color },
  }));
  return [...text, ...background];
}

/** Everything the slash menu offers, in order. */
export const SLASH_CHOICES: Choice[] = [...BLOCK_CHOICES, ...colorChoices()];

/** The kinds "Turn into" offers, in Notion's order. */
export const TURN_INTO: BlockKind[] = ["text", "h1", "h2", "h3", "bullet", "numbered", "todo", "toggle", "code", "quote", "callout", "math"];

const compact = (s: string) => s.toLowerCase().replace(/[\s-]+/g, "");

function score(choice: Choice, query: string): number {
  const label = choice.label.toLowerCase();
  const keywords = choice.keywords.map((k) => k.toLowerCase());
  if (label === query || keywords.includes(query)) return 4;
  if (label.startsWith(query)) return 3;
  if ([...label.split(/[\s-]+/), ...keywords].some((w) => w.startsWith(query))) return 2;
  return compact(label).startsWith(compact(query)) ? 1 : 0;
}

/** The choices matching what was typed after "/", best first; all of them for an empty query. */
export function matchChoices(choices: readonly Choice[], query: string): Choice[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...choices];
  return choices
    .map((choice, index) => ({ choice, index, score: score(choice, q) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((m) => m.choice);
}

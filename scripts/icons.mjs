// Writes the app's icon set (app/src/ui/icons.ts) from Lucide's drawings
// (ISC, https://lucide.dev). Only the icons the app names are
// copied, under the app's own names, so the bundle carries no icon library.
//
//   npm pack lucide-static && tar xzf lucide-static-*.tgz
//   node scripts/icons.mjs package
//
// The Lucide licence goes beside the set (app/src/ui/LICENSE-lucide.txt) and
// into the third-party notices (scripts/notices.mjs).

import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const from = process.argv[2];
if (!from) throw new Error("usage: node scripts/icons.mjs <lucide-static package folder>");
const version = JSON.parse(readFileSync(join(from, "package.json"), "utf8")).version;

// The app's name for each icon, and the Lucide drawing it uses.
const NAMES = {
  // Places
  home: "house",
  search: "search",
  inbox: "inbox",
  journal: "notebook-pen",
  board: "workflow",
  library: "library-big",
  tag: "tag",
  highlight: "highlighter",
  chat: "message-circle",
  tasks: "list-todo",
  calendar: "calendar",
  "calendar-days": "calendar-days",
  history: "history",
  trash: "trash-2",
  import: "import",
  settings: "settings",
  page: "file-text",
  "page-plus": "file-plus",
  folder: "folder",
  "folder-open": "folder-open",
  template: "layout-template",
  review: "list-checks",
  // Window and panes
  sidebar: "panel-left",
  panel: "panel-right",
  "peek-side": "panel-right-open",
  "peek-center": "square-square",
  "peek-close": "panel-right-close",
  expand: "maximize-2",
  shrink: "minimize-2",
  split: "columns-2",
  stack: "layers",
  glance: "panels-right-bottom",
  // Actions
  plus: "plus",
  minus: "minus",
  check: "check",
  close: "x",
  compose: "square-pen",
  edit: "pencil",
  copy: "copy",
  link: "link",
  external: "external-link",
  star: "star",
  pin: "pin",
  archive: "archive",
  restore: "archive-restore",
  undo: "undo-2",
  redo: "redo-2",
  refresh: "refresh-cw",
  download: "download",
  upload: "upload",
  send: "arrow-up",
  stop: "square",
  attach: "paperclip",
  filter: "list-filter",
  sort: "arrow-up-down",
  group: "group",
  grip: "grip-vertical",
  more: "ellipsis",
  "more-vertical": "ellipsis-vertical",
  // Arrows
  chevron: "chevron-right",
  "chevron-left": "chevron-left",
  "chevron-down": "chevron-down",
  "chevron-up": "chevron-up",
  "chevrons-up-down": "chevrons-up-down",
  back: "arrow-left",
  forward: "arrow-right",
  // Views
  table: "table-2",
  kanban: "square-kanban",
  gallery: "layout-grid",
  list: "list",
  timeline: "gantt-chart",
  // Things
  help: "circle-help",
  info: "info",
  alert: "triangle-alert",
  moon: "moon",
  sun: "sun",
  monitor: "monitor",
  agent: "sparkle",
  sparkle: "sparkles",
  wand: "wand-sparkles",
  bot: "bot",
  palette: "palette",
  image: "image",
  smile: "smile",
  clock: "clock",
  hash: "hash",
  eye: "eye",
  keyboard: "keyboard",
  pointer: "mouse-pointer-2",
  hand: "hand",
  "zoom-in": "zoom-in",
  "zoom-out": "zoom-out",
  at: "at-sign",
  globe: "globe",
  plug: "plug",
  bulb: "lightbulb",
  bookmark: "bookmark",
  circle: "circle",
  "circle-check": "circle-check",
  "circle-dot": "circle-dot",
  loader: "loader-circle",
  text: "type",
  quote: "text-quote",
  code: "code-xml",
  user: "user",
  layers: "layers",
  cube: "box",
  // Whiteboard tools
  card: "square-text",
  sticky: "sticky-note",
  section: "square-dashed",
  note: "file-plus",
  layout: "layout-grid",
  fit: "scan",
  map: "map",
  present: "presentation",
  wrap: "group",
  remove: "square-x",
  open: "panel-right-open",
  size: "scaling",
  spark: "sparkles",
  fold: "chevron-down",
  // Dashboards and tabs
  dashboard: "layout-dashboard",
  sliders: "sliders-horizontal",
  gauge: "gauge",
  cards: "gallery-vertical-end",
  "eye-off": "eye-off",
  "pin-off": "pin-off",
  "list-plus": "list-plus",
  "arrow-up-right": "arrow-up-right",
  project: "folder-kanban",
  "calendar-check": "calendar-check",
  zap: "zap",
  move: "move",
  frame: "frame",
  // Blocks in the slash menu
  "heading-1": "heading-1",
  "heading-2": "heading-2",
  "heading-3": "heading-3",
  "list-ordered": "list-ordered",
  todo: "square-check",
  toggle: "list-collapse",
  divider: "minus",
  sigma: "sigma",
  radical: "radical",
  database: "database",
  // Notes, sources and moves
  book: "book-open",
  "move-to": "folder-input",
  gem: "gem",
  notebook: "notebook",
  party: "party-popper",
  print: "printer",
  // Views that arrive later in the sidebar's list
  diagram: "network",
  graph: "share-2",
};

const svgChild = /<(path|circle|rect|line|polyline|polygon|ellipse)\s+([^>]*?)\s*\/>/g;
const attribute = /([a-zA-Z][a-zA-Z0-9-]*)="([^"]*)"/g;

const lines = [];
for (const [name, lucide] of Object.entries(NAMES)) {
  const svg = readFileSync(join(from, "icons", `${lucide}.svg`), "utf8");
  const parts = [...svg.matchAll(svgChild)].map(([, tag, attrs]) => {
    const props = [...attrs.matchAll(attribute)].map(([, key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`);
    return `[${JSON.stringify(tag)}, { ${props.join(", ")} }]`;
  });
  if (parts.length === 0) throw new Error(`no drawing in ${lucide}.svg`);
  lines.push(`  ${JSON.stringify(name)}: [${parts.join(", ")}],`);
}

const out = `// The app's icons: Lucide ${version} drawings (ISC licence, LICENSE-lucide.txt
// beside this file; https://lucide.dev) under the app's own names.
// Written by scripts/icons.mjs; edit the names there, not here.

export type IconPart = readonly [tag: string, attributes: Readonly<Record<string, string>>];

export const ICONS = {
${lines.join("\n")}
} as const satisfies Record<string, readonly IconPart[]>;

export type IconName = keyof typeof ICONS;
`;
writeFileSync("app/src/ui/icons.ts", out);
copyFileSync(join(from, "LICENSE"), "app/src/ui/LICENSE-lucide.txt");
console.log(`${Object.keys(NAMES).length} icons from Lucide ${version}`);

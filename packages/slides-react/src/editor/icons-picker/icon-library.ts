// The icons a person can put on a slide: the Lucide icons the editor already bundles (ISC licence, kept beside `ui/icons.ts`), less the
// ones that only make sense on a toolbar (undo, bold, align ...). Each is found by its name and by the words people use for it. An icon is
// put on a slide as a small SVG picture in the colour and size chosen, so it needs nothing from the editor to be shown or exported.

import { ICONS, type IconName } from "../ui/icons.ts";

/** Icons that name a command of the editor, not a thing: left out of the picker. */
const TOOLBAR_ONLY = /^(align-|text-align|chevron-|list-indent|panel-|arrow-(up|down)-to|undo|redo|zoom-|bold$|italic$|underline$|strikethrough$|baseline$|highlighter$|remove-formatting|clipboard|scissors$|group$|ungroup$|bring-|send-|grip-|square-dashed|case-|whole-|link-2$|unlink$|expand$|shrink$|list-chevrons|between-|text-cursor|ellipsis$|x$|image-off|scan-text|rotate-|replace$|settings$|sliders-|captions$|pilcrow$|subscript$|superscript$|mouse-pointer|printer$|pen-line|square-pen)/;

/** Other words for an icon, besides its name. */
const SYNONYMS: Readonly<Record<string, string>> = {
  star: "favourite favorite rating",
  check: "tick done yes",
  "circle-check": "tick done yes ok",
  "circle-x": "cross no error wrong",
  "triangle-alert": "warning caution danger",
  info: "information help",
  users: "people team group",
  house: "home",
  "chart-line": "graph trend growth",
  "chart-pie": "graph share percent",
  "chart-column": "graph bars statistics",
  "chart-no-axes-column": "graph bars statistics",
  clock: "time history watch",
  timer: "time countdown stopwatch",
  calendar: "date schedule",
  globe: "world web internet",
  bot: "robot ai assistant",
  sparkles: "magic ai new shine",
  "wand-sparkles": "magic ai wizard",
  lock: "secure private closed",
  "lock-open": "unlocked open",
  eye: "view visible look",
  film: "video movie",
  search: "find magnifier",
  download: "save get",
  share: "send export",
  "message-square": "comment chat speech",
  palette: "colour color art paint",
  layers: "stack levels",
  link: "chain url connect",
  play: "start run",
  trash: "delete bin remove",
  "book-open": "read learn docs",
  quote: "citation saying",
  "file-text": "document page paper",
  "qr-code": "scan barcode",
  cloud: "storage online",
  cylinder: "database storage",
  "layout-dashboard": "dashboard panels",
  "layout-template": "template layout",
  route: "path journey way",
  "volume-2": "sound audio speaker",
  smile: "happy face emoji",
  hand: "stop wave",
  pipette: "eyedropper colour",
  droplet: "water drop liquid",
  ruler: "measure size",
  hexagon: "shape polygon",
  diamond: "shape rhombus",
  presentation: "slides talk board",
  "monitor-play": "screen show video",
  code: "programming source",
  table: "grid spreadsheet",
  copy: "duplicate",
  plus: "add new",
  minus: "remove less",
  "arrow-right": "next forward",
  "arrow-left": "back previous",
  "arrow-up": "increase rise",
  "arrow-down": "decrease fall",
  "arrow-up-right": "growth external",
  "external-link": "open link",
  "refresh-cw": "reload sync",
  "notebook-pen": "notes write journal",
  keyboard: "typing keys",
  "paint-bucket": "fill colour",
  paintbrush: "paint brush art",
  "image-plus": "add picture",
  image: "picture photo",
  files: "documents copies",
  frame: "picture border",
};

export interface LibraryIcon {
  name: IconName;
  /** What a person calls it: "Chart pie". */
  label: string;
  /** Lower-case words it is found by. */
  words: string;
}

const titled = (name: string): string => {
  const spaced = name.replaceAll("-", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

/** Every icon of the picker, in the order of the bundled set. */
export const ICON_LIBRARY: readonly LibraryIcon[] = (Object.keys(ICONS) as IconName[])
  .filter((name) => !TOOLBAR_ONLY.test(name))
  .map((name) => ({ name, label: titled(name), words: `${name.replaceAll("-", " ")} ${SYNONYMS[name] ?? ""}`.trim().toLowerCase() }));

/** The icons whose name or synonyms hold every word of `query`; all of them for an empty query. */
export function findIcons(query: string): LibraryIcon[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return ICON_LIBRARY.filter((icon) => terms.every((term) => icon.words.includes(term)));
}

const attribute = (value: string): string => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

export interface IconLook {
  /** `#rrggbb`: an SVG picture cannot use a theme colour name. */
  color: string;
  /** The line width on the 24-unit grid; the editor's own is 1.75. */
  strokeWidth?: number;
}

/**
 * The icon as an SVG picture: a 24 by 24 grid drawn with round strokes in `color`, no fixed size (the picture is scaled to its box on the
 * slide). The text is the picture's whole content, so the picture can be opened in any editor of SVG files.
 */
export function iconSvg(name: IconName, { color, strokeWidth = 1.75 }: IconLook): string {
  const parts = ICONS[name]
    .map(([tag, attributes]) => `<${tag} ${Object.entries(attributes).map(([key, value]) => `${key}="${attribute(value)}"`).join(" ")}/>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${attribute(color)}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${parts}</svg>`;
}

/** The sizes the picker offers, as a width on a 960-wide slide. */
export const ICON_SIZES = [
  { id: "small", label: "Small", units: 48 },
  { id: "medium", label: "Medium", units: 96 },
  { id: "large", label: "Large", units: 160 },
] as const;
export type IconSizeId = (typeof ICON_SIZES)[number]["id"];

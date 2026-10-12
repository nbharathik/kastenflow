// The Settings index: the groups the window is made of, in the order the
// navigation lists them, and every setting in them (entries.ts). The page, the
// navigation, the search and the palette all read this one list, so they stay
// in step: a row on the page names its entry by id and takes its label and
// explanation from it.

import type { IconName } from "../../../../ui/Icon";
import { ENTRIES } from "./entries";
import { hasWords, wordsOf } from "./search";

export type GroupId =
  | "appearance"
  | "pages"
  | "sidebar"
  | "home"
  | "boards"
  | "ai"
  | "agents"
  | "calendar"
  | "browser"
  | "extension"
  | "vault"
  | "history"
  | "search"
  | "diagrams"
  | "templates"
  | "desktop"
  | "shortcuts"
  | "about";

export type NavHeading = "General" | "Connect" | "Data" | "System";
export const HEADINGS: readonly NavHeading[] = ["General", "Connect", "Data", "System"];

export interface GroupInfo {
  id: GroupId;
  /** The name the group had on the old single page; the palette and links use it. */
  title: string;
  heading: NavHeading;
  icon: IconName;
  /** One line under the title. */
  blurb: string;
  /** The longer explanation, behind the title's ? icon. */
  about?: string;
  /** Other names that open this group. */
  aliases?: readonly string[];
}

export const GROUPS: readonly GroupInfo[] = [
  { id: "appearance", title: "Appearance", heading: "General", icon: "palette", blurb: "Theme, accent colour and sizes", aliases: ["theme", "zoom"] },
  { id: "pages", title: "Pages", heading: "General", icon: "page", blurb: "How pages read, and where they open" },
  { id: "sidebar", title: "Sidebar", heading: "General", icon: "sidebar", blurb: "What the sidebar lists" },
  { id: "home", title: "Home", heading: "General", icon: "home", blurb: "The sections on your Home page" },
  { id: "boards", title: "Whiteboards", heading: "General", icon: "board", blurb: "How a board's tools behave", aliases: ["boards", "whiteboard"] },
  {
    id: "ai",
    title: "AI providers",
    heading: "Connect",
    icon: "sparkle",
    blurb: "What chat and AI writing talk to",
    about: "Chat talks to these: the Anthropic API, any OpenAI-compatible server such as a local vLLM server, or your ChatGPT plan. Keys are kept in your system keychain, never in the vault.",
    aliases: ["ai", "chatgpt", "providers"],
  },
  {
    id: "agents",
    title: "AI agents",
    heading: "Connect",
    icon: "bot",
    blurb: "Connect an agent, and set its limits",
    about: "Agents such as Claude Code work on your notes through KastenFlow's MCP server. Changes are recorded in history. Changes that meet a review rule wait for your decision.",
    aliases: ["agents", "mcp"],
  },
  {
    id: "calendar",
    title: "Calendar",
    heading: "Connect",
    icon: "calendar",
    blurb: "Weeks, what days show, subscribed calendars",
    about: "What each day shows. A click on a day opens its journal; its + adds a to-do, a task, a note or a page on it.",
    aliases: ["subscribed calendars"],
  },
  {
    id: "browser",
    title: "Browser",
    heading: "Connect",
    icon: "globe",
    blurb: "A web page in a tab beside your notes",
    about: "A web page in a tab of its own, beside your notes, with a bar to capture the page or what you selected. It is off until you turn it on. Its cookies and history are its own, kept apart from KastenFlow's, and no page in it can reach your notes.",
  },
  {
    id: "extension",
    title: "Browser extension",
    heading: "Connect",
    icon: "plug",
    blurb: "Send pages from Chrome or Edge",
    about: "Send a page, a selection, a link or a picture from Chrome or Edge into KastenFlow. KastenFlow listens only on this computer's own address, only while it is running and this is on. The extension can add captures and nothing else: it cannot read, change or delete your notes.",
    aliases: ["extension"],
  },
  { id: "vault", title: "Vault", heading: "Data", icon: "folder", blurb: "Where your notes live", about: "Every page is a Markdown file in your vault folder. Nothing here changes your notes." },
  {
    id: "history",
    title: "History and backup",
    heading: "Data",
    icon: "history",
    blurb: "Versions, backup and the vault check",
    about: "KastenFlow is desktop-first: backup keeps your notes safe and moves them to a new computer. It isn't live sync.",
    aliases: ["backup", "history"],
  },
  {
    id: "search",
    title: "Search by meaning",
    heading: "Data",
    icon: "search",
    blurb: "Find notes by what they mean",
    about: "Finds notes about what you ask, not just the words you type: Ctrl+K, then “by meaning”. Each note's text goes to the provider below to make its vector; the vectors stay on this computer. Notes written later get theirs when you next search.",
    aliases: ["meaning"],
  },
  {
    id: "diagrams",
    title: "Diagrams",
    heading: "Data",
    icon: "diagram",
    blurb: "The optional diagram editor",
    about: "Diagrams are plain files in your vault with a picture beside them, so pages, slides and whiteboards show them without any editor. The editor is a separate download, only for drawing and changing them.",
  },
  { id: "templates", title: "Templates", heading: "Data", icon: "template", blurb: "Templates and starter kits" },
  { id: "desktop", title: "Desktop", heading: "System", icon: "monitor", blurb: "The tray, quick capture and notifications", about: "How KastenFlow behaves on this computer beside its window." },
  { id: "shortcuts", title: "Keyboard shortcuts", heading: "System", icon: "keyboard", blurb: "Keys for every command", about: "Click a key to change it. Keys need Ctrl, ⌘ or Alt, so typing never runs a command.", aliases: ["keys", "shortcuts"] },
  { id: "about", title: "About", heading: "System", icon: "info", blurb: "Version, updates and licences" },
];

export const groupById = (id: GroupId): GroupInfo => GROUPS.find((g) => g.id === id)!;

/** One setting, or one complex block, in a group. */
export interface SettingEntry {
  /** `group.name`: what a row on the page names it by. */
  id: string;
  group: GroupId;
  label: string;
  /** The longer explanation, behind the row's ? icon; searched too. */
  help?: string;
  /** More words that find it. */
  words?: string;
  /** The card on the group's page it sits in, when not the group's own. */
  card?: string;
  /** A complex component: search shows a line that jumps to it, not the block. */
  jump?: boolean;
  /** Only drawn in the desktop app, or only in the browser preview. */
  only?: "desktop" | "preview";
  /** Drawn only when something makes it relevant (a remote is set, an update
   * is possible): shown on the page, but search does not count it. */
  quiet?: boolean;
}

export { ENTRIES };

const BY_ID = new Map<string, SettingEntry>(ENTRIES.map((e) => [e.id, e]));

export const entryById = (id: string): SettingEntry | undefined => BY_ID.get(id);

/** The entry ids drawn in one card of a group's page. */
export function cardIds(group: GroupId, card: string): string[] {
  const own = groupById(group).title;
  return ENTRIES.filter((e) => e.group === group && (e.card ?? own) === card).map((e) => e.id);
}

/** Everything that is searched in an entry. */
function haystack(entry: SettingEntry): string {
  const group = groupById(entry.group);
  return [entry.label, entry.help, entry.words, group.title, entry.card].filter(Boolean).join(" ");
}

export interface Found {
  /** The entries that match. */
  ids: ReadonlySet<string>;
  /** How many match in each group. */
  byGroup: ReadonlyMap<GroupId, number>;
  total: number;
}

/** Whether a search counts the entry: it is drawn in this app (desktop or
 * browser preview) and not only when something makes it relevant. */
export function isOffered(entry: SettingEntry, desktop: boolean): boolean {
  if (entry.quiet) return false;
  return entry.only === undefined || (entry.only === "desktop") === desktop;
}

/** The entries every word of `query` finds, for the desktop app or the browser preview. */
export function searchSettings(query: string, desktop: boolean): Found {
  const words = wordsOf(query);
  const ids = new Set<string>();
  const byGroup = new Map<GroupId, number>();
  for (const entry of ENTRIES) {
    if (!isOffered(entry, desktop) || !hasWords(words, haystack(entry))) continue;
    ids.add(entry.id);
    byGroup.set(entry.group, (byGroup.get(entry.group) ?? 0) + 1);
  }
  return { ids, byGroup, total: ids.size };
}

/** Where to open Settings: a group, a row in it, words to search for. */
export interface SettingsTarget {
  group?: GroupId;
  /** An entry id: scrolled to and marked for a moment. */
  row?: string;
  /** Words to search for. */
  search?: string;
  /** Put the cursor in the search box. */
  focusSearch?: boolean;
}

const norm = (text: string) => text.trim().toLowerCase();

/** The group a name, an id or an alias means. */
export function resolveGroup(text: string): GroupId | null {
  const wanted = norm(text);
  if (wanted === "") return null;
  const found = GROUPS.find((g) => g.id === wanted || norm(g.title) === wanted || g.aliases?.some((a) => norm(a) === wanted));
  return found?.id ?? null;
}

/** A target from `settings/<group>` or `settings/<group>/<row>` (with or
 * without a `kasten:` in front), from a group's name, or from an entry id. */
export function settingsTarget(text: string): SettingsTarget | null {
  const path = text.trim().replace(/^kasten:/i, "");
  const parts = path.split("/").filter(Boolean);
  if (parts[0]?.toLowerCase() === "settings") parts.shift();
  const [first, second] = parts;
  if (!first) return null;
  const entry = entryById(first);
  if (entry) return { group: entry.group, row: entry.id };
  const group = resolveGroup(first);
  if (!group) return null;
  const row = second && entryById(second)?.group === group ? second : undefined;
  return row ? { group, row } : { group };
}

/** The element id of a group's card, from its title. */
export function sectionId(title: string): string {
  return `settings-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

/** The element id of a row, from its entry id. */
export const rowDomId = (id: string): string => `setting-${id.replace(/[^a-z0-9]+/gi, "-")}`;

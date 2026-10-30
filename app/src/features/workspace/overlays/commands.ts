// Everything the palette can run. Keys for them live in the person's keymap
// (features/shortcuts); the page editor's own keys are listed here for the
// shortcut sheet.

import { useShell } from "../../../lib/store";
import { addDays, isoDay } from "../../../lib/dates";
import { zoomBy } from "../../../lib/zoom";
import { dayOfPath } from "../../journal/feed";
import { pickDay } from "../../journal/JournalBar";
import { commands as pluginCommands } from "../../../plugins/contributions";
import { pluginManageCommands } from "../../../plugins/manage-commands";
import { AGENT_MODE_COMMANDS } from "../../agents/commands";
import { BOARD_COMMANDS } from "../../boards/commands";
import { startNewBoard } from "../../boards/store";
import { useSlideNumbers } from "../../slides/slide-numbers-state";
import { goToSlides } from "../../slides/return-to-slides";
import { startNewDeck } from "../../slides/store";
import { onBrowserTab, openWebTab } from "../../browser/commands";
import { chatShortcut } from "../../chat/focus";
import { newCollection } from "../../collections/requests";
import { capturesPlace } from "../../extension/captures";
import { searchLibrary } from "../../library/request";
import { pickPdfs } from "../../sources/import";
import { openCompare } from "../../sources/compare/compare-state";
import { openAddPaper } from "../../references/add-state";
import { insertCitation } from "../../pages/editor/cite/registry";
import { openHistory } from "../../panel/panel-store";
import { flipTheme } from "../theme";
import { usePrefs } from "../prefs";
import { flushOpenPage } from "../page/open-page";
import { moveStep } from "../reorder";
import { useWorkspace } from "../store";
import type { Place } from "../tabs";
import { movable, noteAt } from "../tree";
import { foldAllSections } from "../../pages/editor/sections/registry";
import { exportCurrentProject } from "../../projects/export/request";
import { openCurrentOverview } from "../../projects/overview/open";
import { saveCurrentProjectAsSetup } from "../../projects/setups/request";
import { openSettingsAt } from "../views/settings/jump";
import { openBackupWizard } from "../../backup/wizard";
import { useVaultStatus } from "../status";
import { SMART_AUTHOR_COMMANDS } from "../../smart/author/commands";
import { databaseCommands } from "../../tags/commands";
import { PAGE_COMMANDS } from "./page-commands";
import { useRunningChats } from "../../../shell/running-chats";
import { firstVisible } from "../../../shell/visible-dom";

export interface Command {
  id: string;
  label: string;
  /** Extra words the palette matches. */
  words?: string;
  /** Whether it applies here; without it, always. */
  when?(): boolean;
  run(): void;
}

const workspace = () => useWorkspace.getState();
const shell = () => useShell.getState();

export const COMMANDS: Command[] = [
  { id: "new-page", label: "New page", words: "create add", run: () => newPageHere() },
  { id: "templates", label: "New page from a template…", words: "template gallery travel trip meeting recipe budget plan spec", run: () => shell().openGallery({}) },
  { id: "kits", label: "Add a starter kit…", words: "kit daily planner second brain para zettelkasten gtd getting things done", run: () => shell().openGallery({ kits: true }) },
  { id: "new-card", label: "Quick note in the Inbox", words: "capture card create", run: () => captureCard() },
  { id: "journal", label: "Journal", words: "daily day today diary", run: () => workspace().go({ view: "journal" }) },
  { id: "prev-day", label: "Journal: previous day", words: "yesterday back earlier day before", run: () => stepDay(-1) },
  { id: "next-day", label: "Journal: next day", words: "tomorrow forward later day after", run: () => stepDay(1) },
  { id: "journal-page", label: "Open today's journal page", words: "daily day today diary", run: () => void workspace().openJournal() },
  { id: "home", label: "Go to Home", words: "start", run: () => workspace().go({ view: "home" }) },
  { id: "inbox", label: "Go to Inbox", run: () => workspace().go({ view: "inbox" }) },
  { id: "captures", label: "Go to Captures", words: "capture clip web pages links saved browser extension table database", run: () => workspace().go(capturesPlace) },
  { id: "library", label: "Go to Card Library", words: "all pages", run: () => workspace().go({ view: "library" }) },
  { id: "search", label: "Search everything", words: "find full text filter tag project", run: () => searchLibrary() },
  { id: "tasks", label: "Go to Tasks", words: "todo to-do checklist", run: () => workspace().go({ view: "tasks" }) },
  { id: "tags", label: "Go to Tag Database", words: "tags database kanban board table properties schema", run: () => workspace().go({ view: "tags" }) },
  { id: "collections", label: "Go to Collections", words: "saved searches queries filters smart lists", run: () => workspace().go({ view: "collections" }) },
  { id: "new-collection", label: "New collection…", words: "save search saved filter smart list query create", run: () => newCollection() },
  { id: "calendar", label: "Go to Calendar", words: "month week dates due schedule", run: () => workspace().go({ view: "calendar" }) },
  { id: "boards", label: "Go to Whiteboards", words: "board canvas map spatial heptabase", run: () => workspace().go({ view: "boards" }) },
  { id: "new-board", label: "New whiteboard", words: "board canvas map brainstorm create", run: () => startNewBoard() },
  { id: "slides", label: "Go to Slides", words: "decks presentation talk powerpoint continue back return", run: () => goToSlides() },
  { id: "new-deck", label: "New deck", words: "slides presentation talk powerpoint create", run: () => startNewDeck() },
  { id: "slide-numbers-off", label: "Turn off slide numbers in every deck…", words: "slides decks presentation page numbers footer remove hide all", run: () => useSlideNumbers.getState().show() },
  { id: "highlights", label: "Go to Highlights", words: "pdf reader sources papers annotations quotes", run: () => workspace().go({ view: "highlights" }) },
  { id: "references", label: "Go to References", words: "bibliography citations bibtex papers zotero doi arxiv cite sources library", run: () => workspace().go({ view: "references" }) },
  { id: "add-paper", label: "Add a paper…", words: "reference bibtex doi arxiv citation cite paste bibliography new", run: () => openAddPaper() },
  { id: "insert-citation", label: "Insert citation…", words: "insert cite reference bibliography pandoc [@ paper source", run: () => void insertCitation() },
  { id: "compare-papers", label: "Compare papers…", words: "comparison table synthesis literature review sources outline evidence", run: () => openCompare() },
  { id: "graph", label: "Open graph", words: "go to links network map connections backlinks orphans ghosts missing pages", run: () => workspace().go({ view: "graph" }) },
  { id: "graph-page", label: "Graph around this page", words: "local links neighbours network connections", run: () => onOpenPlace((place) => workspace().openRight({ view: "graph", path: place.path })) },
  // The browser's own commands ("Open browser", capture the page…) come from the browser plugin (plugins/browser).
  { id: "extension-pair", label: "Browser extension: pair with Chrome or Edge…", words: "connect code settings capture clip web send", run: () => openSettingsAt({ group: "extension", row: "extension.pair" }) },
  { id: "projects", label: "Go to Projects", words: "all projects gallery hub status health overdue stale review archive pin organise", run: () => workspace().go({ view: "projects" }) },
  { id: "triage", label: "Triage captures", words: "inbox captures clip sort process keys later archive defer reading one at a time", run: () => workspace().go({ view: "inbox", path: "triage" }) },
  { id: "review-daily", label: "Daily review", words: "today day overdue due captures routine check in", run: () => workspace().go({ view: "reviews", path: "daily" }) },
  { id: "review-weekly", label: "Weekly review", words: "week routine decisions completed projects reminder look back", run: () => workspace().go({ view: "reviews", path: "weekly" }) },
  { id: "calendar-subscribe", label: "Subscribe to a calendar…", words: "calendar ics ical google outlook icloud webcal feed url add events", run: () => openSettingsAt({ group: "calendar", row: "calendar.subscribe" }) },
  { id: "project-overview", label: "Open project overview", words: "project expand full screen tabs tables captures tasks board dashboard", run: () => openCurrentOverview() },
  { id: "import-pdf", label: "Import a PDF…", words: "open file paper source reader highlight", run: () => pickPdfs() },
  { id: "import-notes", label: "Import notes…", words: "obsidian notion heptabase markdown vault export migrate move bring", run: () => workspace().go({ view: "import" }) },
  { id: "save-project-setup", label: "Save project as a setup…", words: "template kit start new project copy structure pages tags reuse save as setup", run: () => saveCurrentProjectAsSetup() },
  { id: "export-project", label: "Export a project…", words: "bundle share copy folder send give project export backup package", run: () => exportCurrentProject() },
  { id: "chat-dock", label: "Chat about the pages open", words: "ai ask assistant chat dock side panel claude message box focus", run: () => chatShortcut() },
  { id: "chat-add-selection", label: "Add selection to chat", words: "ai snippet quote context selected text keep ask", run: () => void import("../../chat/selection/add").then((m) => m.addSelectionToChat()) },
  { id: "running-chats", label: "Show running chats", words: "agents working background paused progress chats busy", run: () => useRunningChats.getState().show(true) },
  { id: "chat", label: "Go to Chat", words: "ai assistant ask claude model llm conversation", run: () => workspace().go({ view: "chat" }) },
  { id: "trash", label: "Go to Trash", words: "deleted restore", run: () => workspace().go({ view: "trash" }) },
  { id: "history", label: "Go to History", words: "changes versions agents sessions undo", run: () => workspace().go({ view: "history" }) },
  { id: "agents-today", label: "What agents did today", words: "agents routines digest changes today claude codex undo history", run: () => workspace().go({ view: "history", path: "today-by-agents" }) },
  { id: "review", label: "Go to Review", words: "agents proposals accept reject", run: () => workspace().go({ view: "review" }) },
  { id: "backup-setup", label: "Set up backup", words: "keep notes safe github git folder drive sync copy protect restore", run: () => openBackupWizard() },
  { id: "backup-now", label: "Back up now", words: "backup push save copy github sync send", run: () => void import("../../backup/back-up-now").then((m) => m.runBackUpNow()) },
  { id: "backup-latest", label: "Get latest", words: "backup pull fetch sync another computer bring in changes", run: () => void import("../../backup/latest").then((m) => m.runGetLatest()) },
  { id: "backup-github", label: "Open backup on GitHub", words: "backup repository web page browser", run: () => void import("../../backup/back-up-now").then((m) => m.openBackupOnGitHub(useVaultStatus.getState().status?.remote ?? null)) },
  { id: "settings", label: "Settings", words: "preferences options search", run: () => openSettingsAt({ focusSearch: true }) },
  { id: "theme", label: "Switch light / dark", words: "theme dark mode night", run: () => toggleTheme() },
  { id: "sidebar", label: "Show or hide the sidebar", run: () => shell().toggleSidebar() },
  { id: "panel", label: "Show or hide the right panel", words: "outline properties tags links backlinks details word count", run: () => shell().togglePanel(workspace().layout.focus) },
  { id: "page-history", label: "Page history", words: "versions restore time machine undo", run: () => openHistory() },
  { id: "focus", label: "Focus mode", words: "zen distraction free", run: () => shell().toggleFocus() },
  { id: "markdown", label: "Show the Markdown file", words: "source raw", run: () => shell().toggleSource() },
  { id: "fold-sections", label: "Fold all sections", words: "collapse close divider hide ---", run: () => foldSectionsOfPage(true) },
  { id: "unfold-sections", label: "Unfold all sections", words: "expand open divider show ---", run: () => foldSectionsOfPage(false) },
  { id: "move", label: "Move this page to…", words: "project relocate file", run: () => moveOpenPage() },
  { id: "duplicate", label: "Duplicate this page", words: "copy clone", run: () => onOpenPage((path) => void workspace().duplicate(path)) },
  { id: "move-up", label: "Move this page up", words: "order sub-page earlier higher reorder sidebar", run: () => onOpenPage((path) => void moveStep(path, -1)) },
  { id: "move-down", label: "Move this page down", words: "order sub-page later lower reorder sidebar", run: () => onOpenPage((path) => void moveStep(path, 1)) },
  { id: "full-width", label: "Full width pages", words: "wide", run: () => usePrefs.getState().set({ pageWidth: usePrefs.getState().pageWidth === "full" ? "normal" : "full" }) },
  { id: "wide-pages", label: "Wide pages", words: "width column mid", run: () => usePrefs.getState().set({ pageWidth: usePrefs.getState().pageWidth === "wide" ? "normal" : "wide" }) },
  { id: "print", label: "Print or save as PDF", words: "export pdf paper", run: () => window.print() },
  { id: "save", label: "Save now", run: () => void flushOpenPage() },
  { id: "new-tab", label: "New tab", words: "open", run: () => newTab() },
  { id: "close-tab", label: "Close tab", run: () => workspace().closeTab() },
  { id: "reopen-tab", label: "Reopen closed tab", words: "undo close", run: () => workspace().reopenTab() },
  { id: "split", label: "Open in split view", words: "side by side pane", run: () => workspace().splitRight() },
  { id: "open-right", label: "Open this page to the right", words: "beside next pane side by side", run: () => onOpenPlace((place) => workspace().openRight(place)) },
  { id: "pin-page", label: "Pin or unpin this page in the sidebar", words: "top project favourite keep", run: () => onOpenPage((path) => usePrefs.getState().togglePinnedPage(path)) },
  { id: "sidebar-cards", label: "Show or hide quick notes under projects in the sidebar", words: "cards captures inbox notes list short", run: () => usePrefs.getState().set({ sidebarShowCards: !usePrefs.getState().sidebarShowCards }) },
  { id: "stack", label: "Show or hide the side stack", words: "heptabase cards side panel beside", run: () => workspace().toggleStack() },
  { id: "stack-page", label: "Open this page in the side stack", words: "beside heptabase", run: () => onOpenPage((path) => workspace().openInStack(path)) },
  { id: "shortcuts", label: "Keyboard shortcuts", words: "help keys", run: () => shell().setShortcuts(true) },
  ...PAGE_COMMANDS,
  ...SMART_AUTHOR_COMMANDS,
  ...BOARD_COMMANDS,
  ...AGENT_MODE_COMMANDS,
  { id: "zoom-in", label: "Zoom in", words: "bigger larger scale magnify", run: () => void zoomBy(1).then(sayZoom) },
  { id: "zoom-out", label: "Zoom out", words: "smaller scale", run: () => void zoomBy(-1).then(sayZoom) },
  { id: "zoom-reset", label: "Actual size", words: "zoom reset 100", run: () => void zoomBy(0).then(sayZoom) },
];

/** The app's own commands, then those of the plugins that are on. */
export const allCommands = (): Command[] => [...COMMANDS, ...databaseCommands(), ...pluginManageCommands(), ...pluginCommands()];

const sayZoom = (level: number) => workspace().toast(`Zoom ${Math.round(level * 100)}%`);

/** A new tab like the one in front: another browser tab beside a browser tab (Ctrl+T in a browser), else Home. */
export function newTab(): void {
  if (onBrowserTab()) openWebTab();
  else workspace().openTab({ view: "home" });
}

/** Folds or unfolds every section of the page in front, saying how to make some when it has none. */
function foldSectionsOfPage(folded: boolean): void {
  if (foldAllSections(folded) === 0) workspace().toast("This page has no sections yet: a line of --- starts one.");
}

/** Runs `action` on the place in the focused tab when it is something to open (a page, whiteboard or deck). */
function onOpenPlace(action: (place: Place) => void): void {
  const { place } = workspace();
  if (place.path) action(place);
}

/** Runs `action` on the open page when it is a page or card. */
function onOpenPage(action: (path: string) => void): void {
  const { place, notes } = workspace();
  const note = place.view === "page" && place.path ? noteAt(notes, place.path) : undefined;
  if (note && movable(note)) action(note.path);
}

/** The journal a day before or after the one shown, or today's neighbour. */
function stepDay(by: number): void {
  const { place } = workspace();
  const today = isoDay(new Date());
  pickDay(addDays(place.view === "journal" ? dayOfPath(place.path, today) : today, by));
}

function moveOpenPage(): void {
  onOpenPage((path) => shell().setMoving(path));
}

export function toggleTheme(): void {
  const prefs = usePrefs.getState();
  prefs.setTheme(flipTheme(prefs.theme));
}

/** A new page where you are: in the project of the page open, else the library. */
export function newPageHere(): void {
  const { place, notes, newPage } = workspace();
  const here = place.view === "page" ? notes.find((n) => n.path === place.path) : undefined;
  newPage({ project: here?.project ?? null });
}

/** A quick note: into the capture box when one is on screen (the focused
 * pane's first), else a new card as a draft, which makes no file until
 * written in. */
export function captureCard(): void {
  const box = firstVisible<HTMLTextAreaElement>(".kasten-pane.is-focused [data-capture-box]") ?? firstVisible<HTMLTextAreaElement>("[data-capture-box]");
  if (box && !box.disabled) return box.focus();
  const { place, notes, newPage } = workspace();
  const here = place.view === "page" ? notes.find((n) => n.path === place.path) : undefined;
  newPage({ kind: "card", project: here?.project ?? null });
}

/** The page editor's keys for the shortcut sheet, by section. They are the
 * editor's own and not configurable. */
export const EDITOR_SHORTCUTS: { title: string; rows: [string, string][] }[] = [
  {
    title: "Writing",
    rows: [
      ["Ctrl+B / I / U", "Bold, italic, underline"],
      ["Ctrl+Shift+S", "Strikethrough"],
      ["Ctrl+E", "Inline code"],
      ["Ctrl+K (text selected)", "Link"],
      ["Ctrl+Shift+H", "Highlight with the last colour"],
      ["[[ or @", "Link a page or a day"],
      ["/", "Insert any block"],
      ["Ctrl+F", "Find in the page"],
      ["Ctrl+Alt+F", "Find and replace"],
    ],
  },
  {
    title: "Blocks",
    rows: [
      ["Ctrl+Alt+0", "Text"],
      ["Ctrl+Alt+1 / 2 / 3", "Headings"],
      ["Ctrl+Alt+4", "To-do"],
      ["Ctrl+Alt+5 / 6", "Bulleted / numbered list"],
      ["Ctrl+Alt+7", "Toggle"],
      ["Ctrl+Alt+8", "Code"],
      ["Ctrl+D", "Duplicate"],
      ["Ctrl+Shift+↑ / ↓", "Move up / down"],
      ["Ctrl+Enter", "Tick a to-do, open a toggle"],
      ["Esc, then ↑ / ↓", "Select blocks"],
      ["Esc, then Shift+↑ / ↓", "Select several blocks"],
      ["Ctrl+Alt+T", "Group blocks into a toggle"],
      ["Ctrl+/", "Turn into, colour, delete"],
    ],
  },
  {
    title: "Typing",
    rows: [
      ["# ## ### + space", "Headings"],
      ["- or 1. + space", "Lists"],
      ["[] + space", "To-do"],
      ["> + space", "Toggle"],
      ['" + space', "Quote"],
      ["---", "Divider"],
      ["```", "Code block"],
      ["-> <- =>", "→ ← ⇒"],
    ],
  },
];

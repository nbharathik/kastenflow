// The page menu ("Page options" in the top bar): what it offers, in order. Icon
// rows first, then Page, then the submenus View, Present & export and Project,
// then Ask AI and Move to Trash. The style controls (font, size, width) sit
// between the icon rows and Page. Every row has a palette command (PALETTE_IDS).

import { findOrMakeMap } from "../features/boards/page-map";
import { askAboutPage } from "../features/chat/actions";
import { foldAllSections } from "../features/pages/editor/sections/registry";
import { presentThisPage, sectionsToDeck, showSmartSide, toggleSmartLayout, toggleSmartPage } from "../features/pages/present/actions";
import { homeItem, saveSetupItem, templateItems } from "../features/projects/home-menu";
import { keyHint } from "../features/shortcuts/store";
import { saveAsTemplate } from "../features/templates/kits";
import { linkFor } from "../features/workspace/links";
import { titleOf } from "../features/workspace/names";
import { copyAsMarkdown, showInFolder } from "../features/workspace/page/page-file";
import { setLocked } from "../features/workspace/page/page-lock";
import { foldKey, foldProperties, isFolded, propertyCount } from "../features/workspace/page/properties-fold";
import { usePrefs } from "../features/workspace/prefs";
import { reloadLists } from "../features/workspace/reload";
import { useWorkspace } from "../features/workspace/store";
import { movable } from "../features/workspace/tree";
import { inTauri } from "../lib/api";
import { useShell } from "../lib/store";
import type { NoteMeta } from "../lib/vault/types";
import { pageMenuItems } from "../plugins/contributions";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/icons";
import type { MenuEntry, MenuItem } from "./menu-types";
import { PageStyle } from "./PageStyle";

const icon = (name: IconName) => <Icon name={name} className="size-4" />;

export interface PageMenuState {
  note: NoteMeta;
  /** The page draws its sections as cards (`layout: sections`). */
  smart: boolean;
  /** The page is a smart page (`layout: smart`). */
  smartPage?: boolean;
  hasMap: boolean;
  sourceOpen: boolean;
  /** Opens "Open links from this page in…". */
  chooseOpens: () => void;
  /** Whether the page can be folded into sections (arrives with the fold feature; today always true). */
  foldable?: boolean;
}

/** The palette command each row has, by the row's label. */
export const PALETTE_IDS: Record<string, string> = {
  "Copy link": "copy-link",
  "Open links from this page in…": "page-opens",
  "Open in new tab": "new-tab",
  "Open in split view": "split",
  "Open in side peek": "peek-page",
  Duplicate: "duplicate",
  "Move to…": "move",
  "Save as template": "save-template",
  "Lock for agents": "lock-page",
  "Unlock for agents": "lock-page",
  "Show Markdown file": "markdown",
  "Hide Markdown file": "markdown",
  // The sections layout keeps its old command id, so keys a person set for it still work.
  "Sections layout": "smart-layout",
  "Smart layout": "smart-page-layout",
  "Turn into smart page…": "smart-turn-into",
  "Edit code": "smart-edit-code",
  "Back to a normal page": "smart-back",
  "Save as smart template": "smart-save-template",
  "Export as HTML file": "smart-export-html",
  "Focus mode": "focus",
  "Fold all sections": "fold-sections",
  "Unfold all sections": "unfold-sections",
  "Fold properties": "fold-properties",
  "Unfold properties": "unfold-properties",
  "Mind map from this page": "page-mind-map",
  "Open mind map": "page-mind-map",
  "Present this page": "present-page",
  "Turn sections into a deck": "sections-deck",
  "Copy as Markdown": "copy-markdown",
  "Print or save as PDF": "print",
  "Show in folder": "reveal-page",
  "Template for new pages…": "project-template",
  "Change the template for new pages…": "project-template",
  "New pages start blank": "project-template",
  "Save as a setup…": "save-project-setup",
  "Hide project home": "project-home",
  "Show project home": "project-home",
  "Ask AI about this page": "ask-page",
  "Move to Trash": "trash-page",
};

const smartFlows = () => import("../features/smart/author/flows");

/** The rows that make or change a smart page, loaded when used: start one from a starter, or edit, keep and go back. */
function smartRows(note: NoteMeta, smartPage: boolean): MenuItem[] {
  if (!smartPage) {
    return [{ label: "Turn into smart page…", icon: icon("code"), onSelect: () => void import("../features/smart/author/starter-picker").then((m) => m.chooseStarter({ turnInto: note.path })) }];
  }
  return [
    { label: "Edit code", icon: icon("code"), onSelect: () => showSmartSide(note, "code") },
    { label: "Back to a normal page", icon: icon("undo"), onSelect: () => toggleSmartPage(note) },
    { label: "Save as smart template", icon: icon("template"), onSelect: () => void smartFlows().then((m) => m.saveSmartTemplate(note.path, note.title)) },
  ];
}

/** Folds or unfolds every section of `note`, saying how to make some when it has none. */
export function foldSections(folded: boolean, note: NoteMeta): void {
  if (foldAllSections(folded, note.id || note.path) === 0) useWorkspace.getState().toast("This page has no sections yet: a line of --- starts one.");
}

/** Opens the page's mind map, making it only when it has none. */
export async function mapPage(note: NoteMeta): Promise<void> {
  const { client, openPath, toast } = useWorkspace.getState();
  if (!client) return;
  try {
    const { path, created } = await findOrMakeMap(client, note);
    await reloadLists();
    openPath(path);
    if (created) toast(`Made “${note.title} map”: Tab on a branch grows it`);
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err));
  }
}

/** The page menu's rows for `state`. */
export function pageMenuEntries(state: PageMenuState): MenuEntry[] {
  const { note, smart, smartPage = false, hasMap, sourceOpen, chooseOpens, foldable = true } = state;
  const ws = () => useWorkspace.getState();
  const shell = useShell.getState();
  const own = movable(note);
  const { propsFold, propsFolded: chosen } = usePrefs.getState();
  const propsFolded = isFolded(propsFold, chosen[foldKey(note)], propertyCount(note));

  const view: MenuEntry[] = [
    { label: sourceOpen ? "Hide Markdown file" : "Show Markdown file", icon: icon("code"), onSelect: shell.toggleSource },
    { label: "Sections layout", checked: smart, onSelect: () => toggleSmartLayout(note) },
    { label: "Smart layout", checked: smartPage, onSelect: () => toggleSmartPage(note) },
    ...smartRows(note, smartPage),
    { label: "Focus mode", icon: icon("expand"), hint: keyHint("focus"), onSelect: shell.toggleFocus },
    ...(foldable
      ? [
          { label: "Fold all sections", icon: icon("fold"), onSelect: () => foldSections(true, note) },
          { label: "Unfold all sections", icon: icon("chevrons-up-down"), onSelect: () => foldSections(false, note) },
        ]
      : []),
    ...(note.tags.length > 0 || propertyCount(note) > 0
      ? [
          propsFolded
            ? { label: "Unfold properties", icon: icon("chevrons-up-down"), hint: keyHint("toggle-properties"), onSelect: () => foldProperties(note, false) }
            : { label: "Fold properties", icon: icon("fold"), hint: keyHint("toggle-properties"), onSelect: () => foldProperties(note, true) },
        ]
      : []),
    { label: hasMap ? "Open mind map" : "Mind map from this page", icon: icon("board"), onSelect: () => void mapPage(note) },
  ];

  const present: MenuEntry[] = [
    { label: "Present this page", icon: icon("present"), onSelect: () => presentThisPage(note) },
    { label: "Turn sections into a deck", icon: icon("template"), onSelect: () => sectionsToDeck(note) },
    // Plugins (Send to LaTeX, ...) add their rows here when they are on.
    ...pageMenuItems(),
    { label: "Copy as Markdown", icon: icon("copy"), onSelect: () => void copyAsMarkdown(note) },
    { label: "Print or save as PDF", icon: icon("print"), onSelect: () => window.print() },
    ...(smartPage ? [{ label: "Export as HTML file", icon: icon("download"), onSelect: () => void smartFlows().then((m) => m.exportSmartHtml(note.path, note.title)) }] : []),
    ...(inTauri() ? [{ label: "Show in folder", icon: icon("folder"), onSelect: () => void showInFolder(note.path) }] : []),
  ];

  const pageRows: MenuItem[] = [
    ...(own
      ? [
          { label: "Duplicate", icon: icon("copy"), onSelect: () => void ws().duplicate(note.path) },
          { label: "Move to…", icon: icon("move-to"), onSelect: () => shell.setMoving(note.path) },
          { label: "Save as template", icon: icon("template"), onSelect: () => void saveAsTemplate(note.path, titleOf(note)).then((name) => name && shell.openGallery({ select: name })) },
        ]
      : []),
    { label: note.locked ? "Unlock for agents" : "Lock for agents", icon: icon("agent"), onSelect: () => void setLocked(note, !note.locked) },
  ];

  return [
    { label: "Copy link", icon: icon("link"), hint: "[[ ]]", onSelect: () => void navigator.clipboard?.writeText(linkFor(note, ws().notes)) },
    { label: "Open in new tab", icon: icon("external"), hint: "Ctrl+click", onSelect: () => ws().openPath(note.path, "tab") },
    { label: "Open in split view", icon: icon("split"), hint: keyHint("split"), onSelect: () => ws().splitRight() },
    { label: "Open in side peek", icon: icon("peek-side"), onSelect: () => ws().openPath(note.path, "peek-side") },
    { label: "Open links from this page in…", icon: icon("open"), onSelect: chooseOpens },
    "divider",
    { id: "style", custom: <PageStyle path={note.path} /> },
    { heading: "Page" },
    ...pageRows,
    "divider",
    { label: "View", icon: icon("code"), submenu: view },
    { label: "Present & export", icon: icon("present"), submenu: present },
    ...(note.kind === "project" ? [{ label: "Project", icon: icon("folder"), submenu: [homeItem(note), ...templateItems(note), saveSetupItem(note.project)] as MenuEntry[] }] : []),
    "divider",
    { label: "Ask AI about this page", icon: icon("sparkle"), hint: keyHint("chat-dock"), onSelect: () => askAboutPage(note) },
    "divider",
    { label: "Move to Trash", icon: icon("trash"), danger: true, onSelect: () => void ws().trash(note.path) },
  ];
}

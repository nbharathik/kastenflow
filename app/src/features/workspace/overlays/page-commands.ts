// Palette commands for the page open in the focused pane, so every page
// action the menus offer is a keystroke away too: trash, rename, lock for
// agents, favourite, copy its link or its Markdown, show its file, pin its
// tab, and a new project.

import { inTauri } from "../../../lib/api";
import { useShell } from "../../../lib/store";
import type { NoteMeta } from "../../../lib/vault/types";
import { mapPage } from "../../../shell/page-menu";
import { askPageOpens } from "../../../shell/PageOpens";
import { askAboutPage } from "../../chat/ask-page";
import { homeItem, templateItems } from "../../projects/home-menu";
import { saveAsTemplate } from "../../templates/kits";
import { titleOf } from "../names";
import { highlightSelection } from "../../annotations/highlight-registry";
import { openComments } from "../../panel/panel-store";
import { pageKeyOf, presentThisPage, sectionsToDeck, showSmartSide, toggleSmartLayout, toggleSmartPage } from "../../pages/present/actions";
import { setProjectSmart, smartAvailable } from "../../smart/availability";
import { smartSideOf } from "../../smart/use-smart-side";
import { linkFor } from "../links";
import { copyAsMarkdown, showInFolder } from "../page/page-file";
import { setLocked } from "../page/page-lock";
import { foldEveryPage, foldProperties } from "../page/properties-fold";
import { usePrefs } from "../prefs";
import { useWorkspace } from "../store";
import { focusedPane, activeTab } from "../tabs";
import { movable, noteAt } from "../tree";
import { firstVisible } from "../../../shell/visible-dom";
import type { Command } from "./commands";

const workspace = () => useWorkspace.getState();

/** A project's own choice for smart pages, as the palette offers it for the project page that is open. */
const PROJECT_SMART = [
  ["vault", "Smart pages in this project: use the vault's choice"],
  ["on", "Smart pages in this project: on"],
  ["off", "Smart pages in this project: off"],
] as const;

/** The page open in the focused pane, if one is. */
export function openNote(): NoteMeta | undefined {
  const { place, notes } = workspace();
  return place.view === "page" && place.path ? noteAt(notes, place.path) : undefined;
}

/** Puts the caret in the focused page's title, selected, to type a new one. */
function renameOpenPage(): void {
  const field = firstVisible<HTMLTextAreaElement>(".kasten-pane.is-focused .kasten-page-title") ?? firstVisible<HTMLTextAreaElement>(".kasten-page-title");
  if (!field || field.readOnly) return;
  field.focus();
  field.select();
}

export const PAGE_COMMANDS: Command[] = [
  {
    id: "trash-page",
    label: "Move this page to Trash",
    words: "delete remove bin",
    run: () => {
      const note = openNote();
      if (note && movable(note)) void workspace().trash(note.path);
    },
  },
  { id: "rename-page", label: "Rename this page", words: "title name", run: renameOpenPage },
  {
    id: "lock-page",
    label: "Lock or unlock this page for agents",
    words: "read-only protect ai agent guard",
    run: () => {
      const note = openNote();
      if (note) void setLocked(note, !note.locked);
    },
  },
  {
    id: "favourite-page",
    label: "Add to or remove from Favourites",
    words: "star favorite bookmark pin",
    run: () => {
      const note = openNote();
      if (note) usePrefs.getState().toggleFavourite(note.path);
    },
  },
  {
    id: "copy-link",
    label: "Copy link to this page",
    words: "wiki link [[ reference",
    run: () => {
      const note = openNote();
      if (!note) return;
      void navigator.clipboard?.writeText(linkFor(note, workspace().notes)).then(() => workspace().toast("Copied the link"));
    },
  },
  {
    id: "copy-markdown",
    label: "Copy this page as Markdown",
    words: "export clipboard text md",
    run: () => {
      const note = openNote();
      if (note) void copyAsMarkdown(note);
    },
  },
  {
    id: "reveal-page",
    label: "Show this page's file in its folder",
    words: "reveal finder explorer file manager open folder",
    when: inTauri,
    run: () => {
      const note = openNote();
      void showInFolder(note?.path);
    },
  },
  {
    id: "pin-tab",
    label: "Pin or unpin this tab",
    words: "keep tab",
    run: () => {
      const pane = focusedPane(workspace().layout);
      workspace().togglePin(pane.id, activeTab(pane).id);
    },
  },
  { id: "new-project", label: "New project…", words: "create add project", run: () => useShell.getState().nameProject(true) },
  {
    id: "present-page",
    label: "Present this page",
    words: "slides talk fullscreen sections show slideshow",
    run: () => {
      const note = openNote();
      if (note) presentThisPage(note);
    },
  },
  {
    // Keeps its id (keys set for it still work); the words "Smart layout" now belong to smart pages.
    id: "smart-layout",
    label: "Sections layout for this page",
    words: "sections cards slides frames outline strip toggle on off",
    run: () => {
      const note = openNote();
      if (note) toggleSmartLayout(note);
    },
  },
  {
    id: "smart-page-layout",
    label: "Smart layout for this page",
    words: "smart page interactive live view app tracker dashboard toggle on off",
    when: () => smartAvailable(openNote()?.project),
    run: () => {
      const note = openNote();
      if (note) toggleSmartPage(note);
    },
  },
  {
    id: "smart-page-flip",
    label: "Smart page: switch between the smart view and the notes",
    words: "smart page notes markdown view flip",
    when: () => smartAvailable(openNote()?.project),
    run: () => {
      const note = openNote();
      if (note) showSmartSide(note, smartSideOf(pageKeyOf(note)) === "notes" ? "smart" : "notes");
    },
  },
  {
    id: "smart-page-history",
    label: "Smart page: history of its code",
    words: "smart page versions restore earlier code diff changes",
    when: () => smartAvailable(openNote()?.project),
    run: () => {
      const note = openNote();
      if (note) showSmartSide(note, "history");
    },
  },
  {
    id: "sections-deck",
    label: "Turn this page's sections into a deck",
    words: "slides presentation talk make create from page",
    run: () => {
      const note = openNote();
      if (note) sectionsToDeck(note);
    },
  },
  {
    id: "peek-page",
    label: "Open this page in a side peek",
    words: "preview beside glance",
    run: () => {
      const note = openNote();
      if (note) workspace().openPath(note.path, "peek-side");
    },
  },
  {
    id: "save-template",
    label: "Save this page as a template",
    words: "gallery reuse starter",
    run: () => {
      const note = openNote();
      if (note && movable(note)) void saveAsTemplate(note.path, titleOf(note)).then((name) => name && useShell.getState().openGallery({ select: name }));
    },
  },
  {
    id: "page-mind-map",
    label: "Mind map from this page",
    words: "board outline branches open",
    run: () => {
      const note = openNote();
      if (note) void mapPage(note);
    },
  },
  {
    id: "ask-page",
    label: "Ask AI about this page",
    words: "chat assistant claude question",
    run: () => {
      const note = openNote();
      if (note) void askAboutPage(note);
    },
  },
  {
    id: "page-opens",
    label: "Open links from this page in…",
    words: "links sub-pages click new tab side peek stack right same tab where",
    run: () => {
      const note = openNote();
      if (note) askPageOpens(note.path);
    },
  },
  {
    id: "project-home",
    label: "Show or hide this project's home",
    words: "project dashboard overview",
    run: () => {
      const note = openNote();
      if (note?.kind === "project") homeItem(note).onSelect();
    },
  },
  {
    id: "project-template",
    label: "Template for this project's new pages…",
    words: "project starter blank",
    run: () => {
      const note = openNote();
      if (note?.kind === "project") templateItems(note)[0]!.onSelect();
    },
  },
  ...PROJECT_SMART.map(([setting, label]): Command => ({
    id: `project-smart-${setting}`,
    label,
    words: "project smart pages plugin apps on off vault choice",
    when: () => openNote()?.kind === "project" && inTauri(),
    run: () => {
      const note = openNote();
      if (note?.project) void setProjectSmart(note.project, setting);
    },
  })),
  {
    id: "fold-properties",
    label: "Fold properties",
    words: "collapse hide tags properties page",
    run: () => {
      const note = openNote();
      if (note) foldProperties(note, true);
    },
  },
  {
    id: "unfold-properties",
    label: "Unfold properties",
    words: "expand show tags properties page",
    run: () => {
      const note = openNote();
      if (note) foldProperties(note, false);
    },
  },
  { id: "fold-properties-all", label: "Fold properties on every page", words: "collapse hide tags properties all pages", run: foldEveryPage },
  {
    id: "agent-tint",
    label: "Tint or untint what agents wrote today",
    words: "agent colour color highlight changed keep undo wash",
    run: () => usePrefs.getState().set({ agentTint: !usePrefs.getState().agentTint }),
  },
  {
    id: "page-comments",
    label: "Comments on this page",
    words: "comment review note feedback discuss resolve panel",
    run: () => {
      if (openNote()) openComments();
    },
  },
  {
    id: "highlight-selection",
    label: "Highlight the selected words",
    words: "mark web clip article quote colour color yellow green blue pink purple",
    run: () => {
      if (openNote()) void highlightSelection();
    },
  },
];

// Palette commands for the page open in the focused pane, so every page
// action the menus offer is a keystroke away too: trash, rename, lock for
// agents, favourite, copy its link or its Markdown, show its file, pin its
// tab, and a new project.

import { inTauri } from "../../../lib/api";
import { useShell } from "../../../lib/store";
import type { NoteMeta } from "../../../lib/vault/types";
import { presentThisPage, sectionsToDeck, toggleSmartLayout } from "../../pages/present/actions";
import { linkFor } from "../links";
import { copyAsMarkdown, showInFolder } from "../page/page-file";
import { setLocked } from "../page/page-lock";
import { usePrefs } from "../prefs";
import { useWorkspace } from "../store";
import { focusedPane, activeTab } from "../tabs";
import { movable, noteAt } from "../tree";
import type { Command } from "./commands";

const workspace = () => useWorkspace.getState();

/** The page open in the focused pane, if one is. */
export function openNote(): NoteMeta | undefined {
  const { place, notes } = workspace();
  return place.view === "page" && place.path ? noteAt(notes, place.path) : undefined;
}

/** Puts the caret in the focused page's title, selected, to type a new one. */
function renameOpenPage(): void {
  const field = document.querySelector<HTMLTextAreaElement>(".kasten-pane.is-focused .kasten-page-title") ?? document.querySelector<HTMLTextAreaElement>(".kasten-page-title");
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
    id: "smart-layout",
    label: "Smart layout for this page",
    words: "sections cards slides frames outline strip toggle on off",
    run: () => {
      const note = openNote();
      if (note) toggleSmartLayout(note);
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
];

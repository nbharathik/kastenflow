// The window's title names what the focused pane shows, as "Trip plan ·
// Kasten", so the taskbar, window switchers and screen readers tell
// windows and pages apart.

import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { useBoards } from "../features/boards/store";
import { useWebTitles, webTitle } from "../features/browser/titles";
import { isDraft } from "../features/workspace/drafts";
import { titleOf } from "../features/workspace/names";
import { useWorkspace, type Place } from "../features/workspace/store";
import { noteAt } from "../features/workspace/tree";
import { inTauri } from "../lib/api";
import type { BoardInfo, NoteMeta } from "../lib/vault/types";
import { findNav } from "./nav";

const APP = "KastenFlow";

/** What the title says for `place`. */
export function titleFor(place: Place, notes: readonly NoteMeta[], boards: readonly BoardInfo[]): string {
  let what: string;
  if (place.view === "page" && place.path) {
    const note = noteAt(notes, place.path);
    what = note ? titleOf(note) : isDraft(place.path) ? "New page" : "";
  } else if (place.view === "boards" && place.path) {
    what = boards.find((b) => b.path === place.path)?.title ?? "";
  } else if (place.view === "home") {
    what = "Home";
  } else if (place.view === "web") {
    what = webTitle(place.url);
  } else if (place.view === "overview") {
    const project = place.path ? noteAt(notes, place.path) : undefined;
    what = project ? `${titleOf(project)} overview` : "Project overview";
  } else {
    what = findNav(place.view as never)?.label ?? "";
  }
  return what ? `${what} · ${APP}` : APP;
}

/** Keeps the window's title on the focused pane's page or view. */
export function useWindowTitle(): void {
  const place = useWorkspace((s) => s.place);
  const notes = useWorkspace((s) => s.notes);
  const boards = useBoards((s) => s.list);
  // A browser tab is named by its page, which arrives as the page loads.
  useWebTitles((s) => s.titles);
  const title = titleFor(place, notes, boards);
  useEffect(() => {
    document.title = title;
    // The title bar only; the page itself shows the same name.
    if (inTauri()) void getCurrentWindow().setTitle(title).catch(() => {});
  }, [title]);
}

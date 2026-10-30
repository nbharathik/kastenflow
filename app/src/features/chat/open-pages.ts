// What is open in the window, for the chat's context: the page of every
// pane, the side stack's pages and a peek, each once; and the one page being
// worked on, the active tab of the focused pane.

import { useMemo } from "react";

import type { NoteMeta } from "../../lib/vault/types";
import { usePeek } from "../peek/store";
import { useWorkspace } from "../workspace/store";
import { activeTab, type Place } from "../workspace/tabs";
import { noteAt } from "../workspace/tree";

/** The paths of the notes open, focused pane first. */
export function openPaths(state: ReturnType<typeof useWorkspace.getState>, peek: string | null): string[] {
  const { layout, stack, stackOpen } = state;
  const panes = [...layout.panes].sort((a, b) => Number(b.id === layout.focus) - Number(a.id === layout.focus));
  const paths = panes.map((pane) => activeTab(pane).place).filter((place) => (place.view === "page" || place.view === "journal") && place.path).map((place) => place.path!);
  return [...new Set([...(peek ? [peek] : []), ...paths, ...(stackOpen ? stack : [])])].filter((path) => path.endsWith(".md"));
}

/** The path of the page (or LaTeX file) in the focused pane's active tab: the
 * thing being worked on, not a peek or a page in the side stack. None when that
 * tab shows something else. */
export function activePath(state: ReturnType<typeof useWorkspace.getState> = useWorkspace.getState()): string | null {
  const { layout } = state;
  const pane = layout.panes.find((p) => p.id === layout.focus) ?? layout.panes[0];
  if (!pane) return null;
  const { place } = activeTab(pane);
  if ((place.view === "page" || place.view === "journal") && place.path?.endsWith(".md")) return place.path;
  return targetOf(place)?.kind === "latex" ? (place.path ?? null) : null;
}

/** What the focused pane's active tab shows, as far as a chat can follow or be tied to it. */
export interface ActiveTarget {
  kind: "page" | "deck" | "board" | "diagram" | "latex";
  path: string;
}

/** A file of a LaTeX document: what the LaTeX plugin's view shows. */
const LATEX_FILE = /\.(tex|sty|cls|bst|bib)$/;

/** The kind of thing a place is for the chat, by the view and the file's name. A LaTeX document opens in a plugin's view; the chat knows it by the file it shows. */
export function targetOf(place: Place): ActiveTarget | null {
  const { view, path } = place;
  if (!path) return null;
  if ((view === "page" || view === "journal") && path.endsWith(".md")) return { kind: "page", path };
  if (view === "slides" && path.endsWith(".deck")) return { kind: "deck", path };
  if (view === "boards" && path.endsWith(".canvas")) return { kind: "board", path };
  if (view.startsWith("plugin:")) {
    if (path.endsWith(".drawio")) return { kind: "diagram", path };
    if (LATEX_FILE.test(path)) return { kind: "latex", path };
  }
  return null;
}

/** What the focused pane's active tab shows: a page, deck, whiteboard, diagram or LaTeX document; none for any other view. */
export function activeTarget(state: ReturnType<typeof useWorkspace.getState> = useWorkspace.getState()): ActiveTarget | null {
  const { layout } = state;
  const pane = layout.panes.find((p) => p.id === layout.focus) ?? layout.panes[0];
  return pane ? targetOf(activeTab(pane).place) : null;
}

/** The place the focused pane's active tab shows. */
export function activePlace(state: ReturnType<typeof useWorkspace.getState> = useWorkspace.getState()): Place | null {
  const { layout } = state;
  const pane = layout.panes.find((p) => p.id === layout.focus) ?? layout.panes[0];
  return pane ? activeTab(pane).place : null;
}

/** The target in front, as a hook: the kind and the path, each alone so a change draws once. */
export function useActiveTarget(): ActiveTarget | null {
  const kind = useWorkspace((s) => activeTarget(s)?.kind ?? null);
  const path = useWorkspace((s) => activeTarget(s)?.path ?? null);
  return useMemo(() => (kind && path ? { kind, path } : null), [kind, path]);
}

/** The note `activePath` names, as the list has it. */
export function useActivePage(): NoteMeta | null {
  const path = useWorkspace((s) => activePath(s));
  const notes = useWorkspace((s) => s.notes);
  return useMemo(() => (path ? (noteAt(notes, path) ?? null) : null), [path, notes]);
}

/** The notes open, as the list has them, focused first. */
export function useOpenNotes(): NoteMeta[] {
  const peek = usePeek((s) => s.peek?.path ?? null);
  const key = useWorkspace((s) => openPaths(s, peek).join("\\n"));
  const notes = useWorkspace((s) => s.notes);
  return useMemo(
    () =>
      key
        .split("\\n")
        .filter(Boolean)
        .map((path) => noteAt(notes, path))
        .filter((note): note is NoteMeta => Boolean(note)),
    [key, notes],
  );
}

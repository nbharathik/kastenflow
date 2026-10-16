// What is open in the window, for the chat's context: the page of every
// pane, the side stack's pages and a peek, each once; and the one page being
// worked on, the active tab of the focused pane.

import { useMemo } from "react";

import type { NoteMeta } from "../../lib/vault/types";
import { usePeek } from "../peek/store";
import { useWorkspace } from "../workspace/store";
import { activeTab } from "../workspace/tabs";
import { noteAt } from "../workspace/tree";

/** The paths of the notes open, focused pane first. */
export function openPaths(state: ReturnType<typeof useWorkspace.getState>, peek: string | null): string[] {
  const { layout, stack, stackOpen } = state;
  const panes = [...layout.panes].sort((a, b) => Number(b.id === layout.focus) - Number(a.id === layout.focus));
  const paths = panes.map((pane) => activeTab(pane).place).filter((place) => (place.view === "page" || place.view === "journal") && place.path).map((place) => place.path!);
  return [...new Set([...(peek ? [peek] : []), ...paths, ...(stackOpen ? stack : [])])].filter((path) => path.endsWith(".md"));
}

/** The path of the page in the focused pane's active tab: the page being
 * worked on, not a peek or a page in the side stack. None when that tab shows
 * something that is not a page. */
export function activePath(state: ReturnType<typeof useWorkspace.getState> = useWorkspace.getState()): string | null {
  const { layout } = state;
  const pane = layout.panes.find((p) => p.id === layout.focus) ?? layout.panes[0];
  if (!pane) return null;
  const { place } = activeTab(pane);
  return (place.view === "page" || place.view === "journal") && place.path?.endsWith(".md") ? place.path : null;
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

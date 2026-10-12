// What Home can start: the "+ New" menu and the actions the capture field
// lists when it begins with "/". One list, so they never disagree.

import { useShell } from "../../lib/store";
import type { IconName } from "../../ui/Icon";
import { startNewBoard } from "../boards/store";
import { newDiagram } from "../diagrams/actions";
import { keyLabel, useKeys } from "../shortcuts/store";
import { startNewDeck } from "../slides/store";
import { captureCard } from "../workspace/overlays/commands";
import { useWorkspace } from "../workspace/store";

export interface HomeAction {
  id: string;
  label: string;
  icon: IconName;
  /** Words besides the label that find it in the capture field's list. */
  words?: string;
  /** The shortcut shown beside it, if it has one. */
  keys?: string;
  run(): void;
}

/** The ways to start something new, as the "+ New" menu lists them. */
export function newActions(): HomeAction[] {
  const keymap = useKeys.getState().keymap;
  const ws = useWorkspace.getState();
  return [
    { id: "page", label: "New page", icon: "compose", words: "write document", keys: keyLabel(keymap, "new-page"), run: () => ws.newPage() },
    { id: "note", label: "Quick note", icon: "inbox", words: "capture card thought", keys: keyLabel(keymap, "new-card"), run: () => captureCard() },
    { id: "journal", label: "Today's journal", icon: "journal", words: "diary day", keys: keyLabel(keymap, "journal"), run: () => void ws.openJournal() },
    { id: "template", label: "From a template", icon: "template", words: "gallery start", run: () => useShell.getState().openGallery({}) },
    { id: "deck", label: "New deck", icon: "present", words: "slides presentation", run: () => startNewDeck() },
    { id: "board", label: "New whiteboard", icon: "board", words: "canvas map sketch", run: () => startNewBoard() },
    { id: "diagram", label: "New diagram", icon: "diagram", words: "draw flowchart drawio", run: () => void newDiagram() },
  ];
}

/** What the capture field offers after "/": the new things, and search. */
export function slashActions(): HomeAction[] {
  const keymap = useKeys.getState().keymap;
  return [...newActions(), { id: "search", label: "Search", icon: "search", words: "find palette", keys: keyLabel(keymap, "palette"), run: () => useShell.getState().setPalette(true) }];
}

/** The actions whose label or words hold `typed`, in their order. */
export function matchingActions(actions: readonly HomeAction[], typed: string): HomeAction[] {
  const q = typed.trim().toLowerCase();
  if (!q) return [...actions];
  return actions.filter((a) => a.label.toLowerCase().includes(q) || (a.words ?? "").includes(q));
}

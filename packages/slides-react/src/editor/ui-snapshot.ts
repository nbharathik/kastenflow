// What a host keeps of the editor's window state between two uses of the same deck: the panel, the slide and the picks on it, the
// filmstrip's width and place. It is plain data, so a host can hold it for as long as it likes (a tab that was put away, a window
// that was closed) and hand it back as `initialUi`. Nothing in it is about the deck's content.

import type { EditorSession } from "./session/session.ts";
import { type EditorUi, type PanelName, type ViewMode } from "./ui-state.ts";

export interface UiSnapshot {
  panel: PanelName | null;
  view: ViewMode;
  /** The slide shown, and the slides picked in the filmstrip (it is among them). */
  slideId: string;
  slideSelection: string[];
  /** The elements selected on the slide shown. */
  selection: string[];
  filmstripOpen: boolean;
  /** The width the person made the filmstrip, none while it is the usual. */
  filmstripWidth: number | null;
  /** How far the filmstrip is scrolled. */
  filmstripScroll: number;
}

const VIEWS: readonly ViewMode[] = ["edit", "outline", "grid"];
const PANELS: readonly PanelName[] = ["format", "themes", "transitions", "steps", "ai", "comments"];

/** What the editor shows now. */
export function snapshotOf(session: EditorSession, ui: EditorUi): UiSnapshot {
  const { panel, view, filmstripOpen } = ui.state;
  const { slideId, slideSelection, selection } = session.state;
  return { panel, view, slideId, slideSelection: [...slideSelection], selection: [...selection], filmstripOpen, filmstripWidth: ui.memory.filmstripWidth, filmstripScroll: ui.memory.filmstripScroll };
}

/** A key that is the same for two snapshots that say the same thing, so a host is told only of a change. */
export const snapshotKey = (snapshot: UiSnapshot): string => JSON.stringify(snapshot);

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

/** Reads a snapshot a host kept, which may be from an older run or damaged: what cannot be used is left out. */
export function readSnapshot(value: unknown): Partial<UiSnapshot> {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  const out: Partial<UiSnapshot> = {};
  if (raw.panel === null || PANELS.includes(raw.panel as PanelName)) out.panel = raw.panel as PanelName | null;
  if (VIEWS.includes(raw.view as ViewMode)) out.view = raw.view as ViewMode;
  if (typeof raw.slideId === "string") out.slideId = raw.slideId;
  out.slideSelection = strings(raw.slideSelection);
  out.selection = strings(raw.selection);
  if (typeof raw.filmstripOpen === "boolean") out.filmstripOpen = raw.filmstripOpen;
  if (typeof raw.filmstripWidth === "number" && Number.isFinite(raw.filmstripWidth)) out.filmstripWidth = raw.filmstripWidth;
  if (typeof raw.filmstripScroll === "number" && Number.isFinite(raw.filmstripScroll) && raw.filmstripScroll >= 0) out.filmstripScroll = raw.filmstripScroll;
  return out;
}

/**
 * Puts the editor back as the snapshot says. A slide or an element that is gone from the deck (it changed while the editor was away) is
 * skipped, and the rest still applies.
 */
export function applySnapshot(session: EditorSession, ui: EditorUi, given: unknown): void {
  const snapshot = readSnapshot(given);
  if (snapshot.panel !== undefined) ui.openPanel(snapshot.panel);
  if (snapshot.view !== undefined) ui.setView(snapshot.view);
  if (snapshot.filmstripOpen !== undefined && snapshot.filmstripOpen !== ui.state.filmstripOpen) ui.toggleFilmstrip();
  ui.remember({
    ...(snapshot.filmstripWidth !== undefined ? { filmstripWidth: snapshot.filmstripWidth } : {}),
    ...(snapshot.filmstripScroll !== undefined ? { filmstripScroll: snapshot.filmstripScroll } : {}),
  });
  const alive = new Set(session.deck.slides.map((s) => s.id));
  const picked = (snapshot.slideSelection ?? []).filter((id) => alive.has(id));
  const shown = snapshot.slideId !== undefined && alive.has(snapshot.slideId) ? snapshot.slideId : undefined;
  if (picked.length > 1) session.selectSlides(picked, shown && picked.includes(shown) ? shown : undefined);
  else if (shown) session.goTo(shown);
  if (snapshot.selection && snapshot.selection.length > 0) session.select(snapshot.selection);
}

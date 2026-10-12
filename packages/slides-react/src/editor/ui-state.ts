// The editor's own state, the part that is about the window and not the deck:
// which view is shown, which panel is open, the zoom, dialogs, and the paint
// format in hand. Commands change it through these methods, so a menu, a key
// and a button all do the same thing.

import type { TransitionKind } from "@kasten-slides/wasm";

import type { PngOptions } from "../export/png.ts";
import type { PrintOptions } from "../export/print.tsx";
import { Areas } from "./select-all/areas.ts";
import type { TextHandle } from "./text-handle.ts";
import { LINT_BADGES_KEY, NEW_SLIDES_KEY, NEW_SLIDES_MODE_KEY, readChoice, readFlag, writeChoice, writeFlag } from "./ui-prefs.ts";

export type ViewMode = "edit" | "outline" | "grid";
/** What a new slide starts from: nothing on it, the layout of the slide shown, or the deck's own default layout. */
export type NewSlides = "blank" | "same" | "mine";
const NEW_SLIDES_CHOICES = ["blank", "same", "mine"] as const;
export type PanelName = "format" | "themes" | "transitions" | "steps" | "ai" | "comments";
/** A menu opened by a right click, where it was pressed. */
export interface ContextMenuState {
  kind: "element" | "canvas" | "slide";
  x: number;
  y: number;
}

export type DialogName =
  | "find"
  | "layouts"
  | "theme"
  | "background"
  | "shortcuts"
  | "insert"
  | "embed"
  | "video"
  | "table"
  | "link"
  | "export"
  | "png"
  | "about"
  | "import"
  | "lint"
  | "citation"
  | "page"
  // Insert → Page…: a page of the host on the slide, four ways.
  | "insert-page"
  | "insert-gallery"
  // The layouts and templates a person keeps (editor/layouts): saving a slide as a layout, managing the layouts, designing one, saving the deck's look and putting a template on it.
  | "layout-save"
  | "layouts-manage"
  | "layout-design"
  | "template-save"
  | "template-apply";

/** A transition to play once on the canvas, as a preview. `id` counts them, so the same transition asked for again plays again. */
export interface TransitionPreview {
  id: number;
  kind: TransitionKind;
  /** Seconds. */
  duration: number;
}

/** Formatting picked up with the paint-format tool, to lay on the next thing clicked. */
export interface PaintFormat {
  run: {
    b?: boolean;
    i?: boolean;
    u?: boolean;
    s?: boolean;
    color?: string;
    size?: number;
    font?: string;
    /** Raised or lowered words; null puts them level. */
    script?: "super" | "sub" | null;
    smallCaps?: boolean;
    allCaps?: boolean;
    /** Extra space between letters in points; null takes it off. */
    spacing?: number | null;
  };
  /** How the paragraphs are set: what the source's paragraphs agree on. A null takes the setting off (the text style's own, or no list). */
  paragraph?: {
    align?: "left" | "center" | "right" | "justify";
    lineSpacing?: number | null;
    spaceBefore?: number | null;
    spaceAfter?: number | null;
    list?: "bullet" | "number" | null;
    listStyle?: string | null;
    bulletColor?: string | null;
    bulletSize?: number | null;
  };
  style?: Record<string, unknown>;
}

export interface UiState {
  readonly view: ViewMode;
  readonly panel: PanelName | null;
  readonly dialog: DialogName | null;
  /** "fit" follows the size of the window; a number is a fixed zoom (1 is 100%). */
  readonly zoom: "fit" | number;
  /** The zoom "fit" comes to at the size of the stage now, reported by the canvas. */
  readonly fitZoom: number;
  readonly notesOpen: boolean;
  readonly snap: boolean;
  readonly filmstripOpen: boolean;
  /** The images drawer, beside the filmstrip. */
  readonly galleryOpen: boolean;
  readonly paint: PaintFormat | null;
  /** The text editor with the caret, while a box is being edited. */
  readonly text: TextHandle | null;
  readonly contextMenu: ContextMenuState | null;
  /** The step of the slide shown on the canvas by the Steps panel or the step keys; null shows the slide as it is styled. */
  readonly previewStep: number | null;
  /** Counts the times the host's actions were replaced, so a region that shows them draws again. */
  readonly actionsRevision: number;
  /** The editor covers the whole window of the app, and nothing of the host's own chrome shows around it. Not part of the deck or the session. */
  readonly fullScreen: boolean;
  /** The filmstrip flags slides that have problems (View, Lint badges). Off unless the person turned it on; kept in this browser. */
  readonly lintBadges: boolean;
  /** What New slide makes: a blank slide, one on the layout of the slide shown, or one on the deck's own default layout. Kept in this browser. */
  readonly newSlides: NewSlides;
  /** The layout the designer is open on (dialog `layout-design`); null when none is. */
  readonly layoutDesign: string | null;
  /** The transition being previewed on the canvas, from the Transitions panel; null when none is. */
  readonly transitionPreview: TransitionPreview | null;
}

const INITIAL: UiState = {
  view: "edit",
  panel: null,
  dialog: null,
  zoom: "fit",
  fitZoom: 1,
  notesOpen: true,
  snap: true,
  filmstripOpen: true,
  galleryOpen: false,
  paint: null,
  text: null,
  contextMenu: null,
  previewStep: null,
  actionsRevision: 0,
  fullScreen: false,
  lintBadges: false,
  newSlides: "blank",
  layoutDesign: null,
  transitionPreview: null,
};

export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

/** What a zoom asks of the canvas besides the number: which place in the window stays where it is, and whether it glides. */
export interface ZoomIntent {
  about?: { x: number; y: number } | undefined;
  /** Where that place goes in the window, when it is carried as well as zoomed (the fingers of a pinch); `about` when left out. */
  to?: { x: number; y: number } | undefined;
  instant?: boolean;
}

/** What the host application gives the editor to call: present, export, and leaving. */
export interface EditorActions {
  /** Presents the deck from its first slide or the one shown; `view: "scroll"` is the whole deck as a page with its notes, `presenter` also opens the presenter's window. */
  present?(from: "start" | "current", options?: { view?: "slides" | "scroll"; presenter?: boolean }): void;
  exportAs?(format: "pptx" | "pdf" | "png" | "markdown" | "html"): void;
  /** Prints the deck (the browser's print dialog, where "Save as PDF" is a destination). */
  print?(options?: PrintOptions): void;
  /** Saves slides as PNG pictures: one file, or a zip file of them. */
  png?(options: PngOptions): void;
  close?(): void;
  /**
   * The editor went into full screen (`on`) or came out: it covers the whole window of the app, with or without this. A host that
   * has more to do (a desktop shell taking its own window full screen) does it here. The browser's Fullscreen API is not used. A host
   * that sees the person leave full screen some other way calls `ui.setFullScreen(false)`.
   */
  fullScreen?(on: boolean): void | Promise<void>;
}

export class EditorUi {
  private current: UiState = {
    ...INITIAL,
    lintBadges: readFlag(LINT_BADGES_KEY, false),
    newSlides: readChoice(NEW_SLIDES_MODE_KEY, NEW_SLIDES_CHOICES, readFlag(NEW_SLIDES_KEY, false) ? "same" : "blank"),
  };
  private readonly listeners = new Set<() => void>();
  private hostActions: EditorActions = {};
  private zoomIntent: ZoomIntent = {};
  /** The zoom a wheel or a pinch last asked for, and what it was shown as (Fit and 100% are settled on): where the next step goes on from. */
  private asked: { zoom: number; shown: "fit" | number } | null = null;
  /** Where the focus last was in the editor, and the regions that select all of what they hold: what select all reads. */
  readonly areas = new Areas();
  /**
   * True for the editor inside the layout designer, whose slide is a layout being drawn: what belongs to a slide of the deck (its own
   * layout, the theme, the transition) is not offered there. Set once, when the designer opens; it never changes while the editor lives.
   */
  designing = false;

  /** What the host lets the editor do: present, export, print, leave. Set by the editor component; regions read it with `useUiState`. */
  get actions(): EditorActions {
    return this.hostActions;
  }

  set actions(actions: EditorActions) {
    this.hostActions = actions;
    this.patch({ actionsRevision: this.current.actionsRevision + 1 });
  }

  get state(): UiState {
    return this.current;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): UiState => this.current;

  private patch(changes: Partial<UiState>): void {
    this.current = { ...this.current, ...changes };
    for (const listener of [...this.listeners]) listener();
  }

  setView(view: ViewMode): void {
    this.patch({ view });
  }

  /** Opens a panel, or closes it if it is the one open. */
  togglePanel(panel: PanelName): void {
    this.patch({ panel: this.current.panel === panel ? null : panel });
  }

  openPanel(panel: PanelName | null): void {
    this.patch({ panel });
  }

  openDialog(dialog: DialogName | null): void {
    this.patch({ dialog });
  }

  /**
   * Zooms to `zoom`. The canvas keeps the point of the slide under `how.about` (a place in the window; the middle of the stage
   * when none is given) where it is, and glides there unless `how.instant` says the zoom is following a wheel or a pinch,
   * which is its own motion.
   */
  setZoom(zoom: "fit" | number, how: ZoomIntent = {}): void {
    this.zoomIntent = how;
    this.patch({ zoom: zoom === "fit" ? zoom : Math.min(Math.max(zoom, 0.1), 8) });
  }

  /** What the last zoom was asked to do besides change the number; read once by the canvas that draws it. */
  takeZoomIntent(): ZoomIntent {
    const how = this.zoomIntent;
    this.zoomIntent = {};
    return how;
  }

  /**
   * Zooms by a factor about a place in the window (a wheel or a pinch), at once. Near "fit" and 100% it settles on them, and
   * keeps the zoom that was asked for behind them, so a slow wheel or pinch goes on through them rather than sticking.
   * `to` is where the place goes in the window, when it is carried (the fingers of a pinch travel): it stays under `about` otherwise.
   */
  zoomBy(factor: number, about?: { x: number; y: number }, to?: { x: number; y: number }): void {
    const shown = this.current.zoom === "fit" ? this.current.fitZoom : this.current.zoom;
    const base = this.asked && this.asked.shown === this.current.zoom ? this.asked.zoom : shown;
    const next = Math.min(Math.max(base * factor, 0.1), 8);
    const near = (target: number) => Math.abs(next / target - 1) < 0.02;
    const landed: "fit" | number = near(this.current.fitZoom) ? "fit" : near(1) ? 1 : next;
    this.asked = { zoom: next, shown: landed };
    this.setZoom(landed, { about, to, instant: true });
  }

  /** Records what "fit" comes to, so the zoom shown and the steps from it are right. */
  setFitZoom(fit: number): void {
    if (Math.abs(fit - this.current.fitZoom) > 0.0005) this.patch({ fitZoom: fit });
  }

  /** The next zoom step above or below the one now. */
  stepZoom(direction: 1 | -1, basis = this.current.fitZoom): void {
    const now = this.current.zoom === "fit" ? basis : this.current.zoom;
    const next = direction > 0 ? ZOOM_STEPS.find((z) => z > now + 0.001) : [...ZOOM_STEPS].reverse().find((z) => z < now - 0.001);
    if (next) this.setZoom(next);
  }

  toggleNotes(): void {
    this.patch({ notesOpen: !this.current.notesOpen });
  }

  toggleSnap(): void {
    this.patch({ snap: !this.current.snap });
  }

  toggleFilmstrip(): void {
    this.patch({ filmstripOpen: !this.current.filmstripOpen });
  }

  /** Opens or closes the images drawer; `open` says which, without it the drawer is switched. */
  toggleGallery(open?: boolean): void {
    this.patch({ galleryOpen: open ?? !this.current.galleryOpen });
  }

  setPaint(paint: PaintFormat | null): void {
    this.patch({ paint });
  }

  openContextMenu(menu: ContextMenuState | null): void {
    this.patch({ contextMenu: menu });
  }

  /** Shows the slide on the canvas as it stands at a step (0 is how it appears); null shows it as it is styled again. */
  setPreviewStep(step: number | null): void {
    if (step !== this.current.previewStep) this.patch({ previewStep: step });
  }

  /** Records the text editor that has the caret (null when none has). */
  setText(text: TextHandle | null): void {
    if (text !== this.current.text) this.patch({ text });
  }

  /** Puts the editor over the whole window of the app, or back in its place. The workspace keeps the page and the host told (`watchFullScreen`). */
  setFullScreen(on: boolean): void {
    if (on !== this.current.fullScreen) this.patch({ fullScreen: on });
  }

  toggleFullScreen(): void {
    this.setFullScreen(!this.current.fullScreen);
  }

  /** Shows or hides the lint badges on the filmstrip's slides, and keeps the choice in this browser. */
  setLintBadges(on: boolean): void {
    if (on === this.current.lintBadges) return;
    writeFlag(LINT_BADGES_KEY, on);
    this.patch({ lintBadges: on });
  }

  toggleLintBadges(): void {
    this.setLintBadges(!this.current.lintBadges);
  }

  /** Says what New slide makes, and keeps the choice in this browser. */
  setNewSlides(mode: NewSlides): void {
    if (mode === this.current.newSlides) return;
    writeFlag(NEW_SLIDES_KEY, mode === "same");
    writeChoice(NEW_SLIDES_MODE_KEY, mode);
    this.patch({ newSlides: mode });
  }

  /** Opens the layout designer on the layout `name`, or closes it. */
  openLayoutDesign(name: string | null): void {
    this.patch({ layoutDesign: name, dialog: name === null ? null : "layout-design" });
  }

  /** Plays a transition once on the canvas, from the slide before the one shown (or from nothing on the first): a preview, which changes nothing in the deck. */
  playTransition(kind: TransitionKind, duration: number): void {
    this.patch({ transitionPreview: { id: (this.current.transitionPreview?.id ?? 0) + 1, kind, duration } });
  }

  /** The preview is over; the dialog that asked for it may stop showing the slide undimmed. */
  endTransitionPreview(): void {
    if (this.current.transitionPreview !== null) this.patch({ transitionPreview: null });
  }
}

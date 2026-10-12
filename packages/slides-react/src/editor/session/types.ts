import type { Deck } from "@kasten-slides/wasm";

/**
 * What a click or drag on the slide does.
 * `select`; `text` draws a text box; `shape:<preset>` draws a shape;
 * `line:<route>` and `arrow:<route>` draw a line, straight, elbow or curved.
 */
export type Tool = "select" | "text" | `shape:${string}` | `line:${string}` | `arrow:${string}`;

/** Where saving stands. */
export type SaveState =
  | { status: "saved" }
  | { status: "unsaved" }
  | { status: "saving" }
  | { status: "error"; message: string }
  /** The file changed on disk while the deck had unsaved changes. `theirs` is what is there. */
  | { status: "conflict"; theirs: string; copy?: string | null };

/** Where a press that begins editing was, so the caret can go there: a place in the window, and whether the word at it is selected too. */
export interface EditStart {
  at: { x: number; y: number };
  select?: "word";
}

/** Everything a view needs to draw the editor. A new object after every change. */
export interface EditorState {
  readonly deck: Deck;
  /** The slide on the canvas. */
  readonly slideId: string;
  /** Element ids selected on that slide: of the slide's own elements, or of what the group gone into holds (`inside`). */
  readonly selection: readonly string[];
  /** The groups the person went into (a double click), outermost first; empty at the slide's own level. */
  readonly inside: readonly string[];
  /** Slide ids selected in the filmstrip; always holds `slideId`. */
  readonly slideSelection: readonly string[];
  /** The element whose text is being edited. */
  readonly editing: string | null;
  /** The press that began the edit, where there was one (a click on a text box, a double click): the place in the window, and whether the word there is taken. The caret goes there; null puts it at the end. */
  readonly editFrom: EditStart | null;
  readonly tool: Tool;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string | undefined;
  readonly redoLabel: string | undefined;
  readonly saving: SaveState;
  /** Counts changes to the deck, so a view can tell an edit from a re-render. */
  readonly revision: number;
  /**
   * How the change that made this revision came about, when the elements it moved are to glide to where they are now instead of
   * jumping: an undo or a redo, or a command that puts elements elsewhere (align, distribute, rotate). Null for every other
   * change: a drag has already shown the elements where they land, and typing moves nothing.
   */
  readonly settle: "undo" | "redo" | "glide" | null;
}

/** A place on the slide, in slide units. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

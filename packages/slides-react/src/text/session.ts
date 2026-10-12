// One run of the editor in a page: the editor itself, and what connects it to
// its host, namely which events end editing, and where focus is allowed to go
// before that happens.

import type { Insets, ListKind, Text, Theme, VAlign } from "@kasten-slides/wasm";
import { AllSelection, Selection, TextSelection } from "prosemirror-state";

import { type EditorHooks, type MountedEditor, mountEditor } from "./editor.ts";
import type { FormatState } from "./format-state.ts";
import { type TextPrefs, textPrefs } from "./prefs.ts";
import { wholeText, wordAt } from "./selection-info.ts";

/** Where the caret goes when editing starts with a press of the pointer: the place in the window, and whether the word there is selected too (a double click). */
export interface CaretAt {
  at: { x: number; y: number };
  select?: "word";
}

/** What the host wants to hear of, always the newest of each. */
export interface SessionCallbacks {
  onChange?: ((text: Text) => void) | undefined;
  onDone?: ((text: Text, reason: "escape" | "blur") => void) | undefined;
  onFormat?: ((state: FormatState) => void) | undefined;
  onLinkRequest?: ((current: string | null) => void) | undefined;
}

export interface SessionInput {
  element: HTMLElement;
  theme: Theme;
  baseStyle: string;
  text: Text;
  width: number;
  height: number;
  insets: Insets | undefined;
  valign: VAlign | undefined;
  /** How much the type is set smaller to fit the box (1 is not at all). */
  scale?: number | undefined;
  /** The list that words typed into an empty box are made items of. */
  defaultList?: ListKind | null | undefined;
  /** Where the caret goes at the start. Without it focus is left alone. */
  autoFocus?: "start" | "end" | "all" | CaretAt | undefined;
  /** What is corrected as words are typed. */
  prefs?(): TextPrefs | undefined;
  /** Asked each time, so a callback the host changed is the one called. */
  callbacks(): SessionCallbacks;
  /** Told of each new text, so the host's copy of it is the newest. */
  changed(text: Text): void;
}

export interface Session {
  editor: MountedEditor;
  /** Ends the session. Nothing is reported for it. */
  dispose(): void;
}

/** Whether focus is going to something that is part of the toolbar, marked `data-ks-keep-focus`. */
export const keepsFocus = (target: EventTarget | null): boolean => target instanceof Element && target.closest("[data-ks-keep-focus]") !== null;

/** Puts the caret at the start or the end, or selects everything, or puts the caret where the pointer pressed, and takes focus. */
export function place(editor: MountedEditor, where: "start" | "end" | "all" | CaretAt): void {
  const { view } = editor;
  const { doc } = view.state;
  if (typeof where === "string") {
    view.dispatch(view.state.tr.setSelection(where === "start" ? Selection.atStart(doc) : where === "end" ? Selection.atEnd(doc) : wholeText(view.state)));
  } else {
    const found = view.posAtCoords({ left: where.at.x, top: where.at.y });
    // A press outside the words (in the room under them, say) puts the caret at the end, as the editor would for the key.
    let selection: Selection = Selection.atEnd(doc);
    if (found) {
      const word = where.select === "word" ? wordAt(view.state, found.pos) : null;
      selection = word ? TextSelection.create(doc, word.from, word.to) : Selection.near(doc.resolve(found.pos));
    }
    view.dispatch(view.state.tr.setSelection(selection));
  }
  view.focus();
}

export function startSession(input: SessionInput): Session {
  let finished = false;
  let disposed = false;
  // A press on a toolbar button: some browsers do not focus a button, and then name nothing as the blur's target.
  let pressOnToolbar = false;
  const onPress = (event: MouseEvent): void => {
    // The innermost target: inside a shadow root the event's own target is the root's host.
    pressOnToolbar = keepsFocus(event.composedPath()[0] ?? event.target);
    if (pressOnToolbar) setTimeout(() => (pressOnToolbar = false), 1000);
  };
  const onRelease = (): void => {
    pressOnToolbar = false;
  };
  document.addEventListener("mousedown", onPress, true);
  document.addEventListener("mouseup", onRelease, true);

  let mounted: MountedEditor | null = null;
  const finish = (reason: "escape" | "blur"): void => {
    if (finished || disposed || !mounted) return;
    finished = true;
    input.callbacks().onDone?.(mounted.getText(), reason);
  };
  const hooks: EditorHooks = {
    ...(input.prefs ? { prefs: () => input.prefs?.() ?? textPrefs() } : {}),
    change(text) {
      input.changed(text);
      input.callbacks().onChange?.(text);
    },
    format: (state) => input.callbacks().onFormat?.(state),
    linkRequest: (current) => input.callbacks().onLinkRequest?.(current),
    escape: () => finish("escape"),
    blur(event) {
      if (keepsFocus(event.relatedTarget) || pressOnToolbar) return;
      finish("blur");
    },
  };

  const editor = mountEditor(input.element, { theme: input.theme, baseStyle: input.baseStyle, text: input.text, width: input.width, height: input.height, insets: input.insets, valign: input.valign, scale: input.scale, defaultList: input.defaultList ?? null, hooks });
  mounted = editor;
  // Coming back to the editor makes it ready to end again.
  editor.view.dom.addEventListener("focus", () => {
    finished = false;
  });
  if (input.autoFocus) place(editor, input.autoFocus);

  return {
    editor,
    dispose() {
      disposed = true;
      document.removeEventListener("mousedown", onPress, true);
      document.removeEventListener("mouseup", onRelease, true);
      editor.destroy();
    },
  };
}

/** Where the selection is and whether the editor has focus, to put back into an editor made again. */
export interface Snapshot {
  anchor: number;
  head: number;
  everything: boolean;
  focused: boolean;
}

export function snapshotOf(editor: MountedEditor): Snapshot {
  const { selection } = editor.view.state;
  return { anchor: selection.anchor, head: selection.head, everything: selection instanceof AllSelection, focused: editor.view.hasFocus() };
}

/** Puts a snapshot back. The document is the same, so the positions still mean the same places. */
export function restore(editor: MountedEditor, snapshot: Snapshot): void {
  const { view } = editor;
  const size = view.state.doc.content.size;
  const clamp = (pos: number): number => Math.min(Math.max(pos, 0), size);
  try {
    const { doc } = view.state;
    view.dispatch(view.state.tr.setSelection(snapshot.everything ? new AllSelection(doc) : TextSelection.create(doc, clamp(snapshot.anchor), clamp(snapshot.head))));
  } catch {
    // A position that is not inside a paragraph: leave the caret at the start.
  }
  if (snapshot.focused) view.focus();
}

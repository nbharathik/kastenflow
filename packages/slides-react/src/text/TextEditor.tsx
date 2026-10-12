// The editor of a text box, as a React component. It sits in the same box, with
// the same padding and alignment, as the read-only drawing, so the words do
// not move when editing starts. The editing itself is ProseMirror's, in
// editor.ts; this file only mounts it, passes its events on, and keeps it in
// step with the props.

import type { Insets, ListKind, Text, Theme, VAlign } from "@kasten-slides/wasm";
import { type JSX, type Ref, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";

import { boxOf } from "./box-style.ts";
import type { MountedEditor } from "./editor.ts";
import { measureBox, onFontsLoaded } from "./fit.ts";
import { type FormatState, linkAtSelection } from "./format-state.ts";
import { type TextEditorHandle, createHandle } from "./handle.ts";
import type { TextPrefs } from "./prefs.ts";
import { type CaretAt, type Session, restore, snapshotOf, startSession } from "./session.ts";
import "./text.css";

export type { FormatState, Tri } from "./format-state.ts";
export type { TextEditorHandle } from "./handle.ts";
export type { CaretAt } from "./session.ts";

export interface TextEditorProps {
  theme: Theme;
  text: Text;
  /** The theme text style the box is set in, as for `TextBlock`. */
  baseStyle: string;
  /** The box size in slide units. */
  width: number;
  height: number;
  insets?: Insets;
  valign?: VAlign;
  /** Where the caret goes when editing starts. Without it focus is left to the host. */
  autoFocus?: "start" | "end" | "all" | CaretAt;
  /** The kind of list the slot this box fills makes of words typed into it while it is empty, as a body slot does. */
  defaultList?: ListKind | null;
  /** The text after every change to the words. */
  onChange?: (text: Text) => void;
  /** Editing ended, by Escape or by focus leaving the editor (but not for a toolbar button marked `data-ks-keep-focus`). */
  onDone?: (text: Text, reason: "escape" | "blur") => void;
  /** The formatting of the selection, whenever the selection or the marks change. */
  onFormat?: (state: FormatState) => void;
  /** Mod-k: the host asks for an address and calls `handle.setLink`. `current` is the link the selection is in. */
  onLinkRequest?: (current: string | null) => void;
  /** For a box that resizes to fit its words: how tall they are (the insets included, in slide units), whenever the words or the box change. */
  onNaturalHeight?: (height: number) => void;
  /** What is corrected as words are typed; the person's own choices when absent. */
  prefs?: () => TextPrefs;
  handleRef?: Ref<TextEditorHandle>;
  className?: string;
}

const sameText = (a: Text, b: Text): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

export function TextEditor(props: TextEditorProps): JSX.Element {
  const { theme, baseStyle, width, height, insets, valign, className } = props;
  const host = useRef<HTMLDivElement>(null);
  const session = useRef<Session | null>(null);
  // The latest props, so the callbacks of a long-lived editor never call an old one.
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  // The words as the editor has them, which the props catch up with.
  const words = useRef(props.text);
  const editor = useRef<MountedEditor | null>(null);
  // How much "shrink text on overflow" has set the type smaller in the box being edited.
  const scale = useRef(1);

  /** Asks the page how the words fit: sets the scale of a box that shrinks them, and tells the host how tall a box that resizes is. */
  const refit = (): void => {
    const current = editor.current;
    if (!current) return;
    const now = latest.current;
    const text = current.getText();
    const shrink = text.fit === "shrink";
    if (!shrink && text.fit !== "resize") {
      if (scale.current !== 1) {
        scale.current = 1;
        current.setBox({ width: now.width, height: now.height, insets: now.insets, valign: now.valign, scale: 1 });
      }
      return;
    }
    const made = measureBox(current.view.dom as HTMLElement, { width: now.width, height: now.height, insets: boxOf(text, { insets: now.insets, valign: now.valign }).insets }, shrink);
    if (!made.measured) return;
    if (shrink && made.scale !== scale.current) {
      scale.current = made.scale;
      current.setBox({ width: now.width, height: now.height, insets: now.insets, valign: now.valign, scale: made.scale });
    }
    if (text.fit === "resize") now.onNaturalHeight?.(made.natural);
  };

  const handle = useMemo(
    () =>
      createHandle(
        () => editor.current,
        () => words.current,
        (change) => editor.current?.setBoxFields(change),
        () => latest.current.onLinkRequest?.(editor.current ? linkAtSelection(editor.current.view.state) : null),
      ),
    [],
  );
  useImperativeHandle(props.handleRef, () => handle, [handle]);

  // The schema draws with the theme's colours, fonts and text styles, so only a change in one of those makes a new editor.
  const look = useMemo(() => JSON.stringify([theme.colors, theme.fonts, theme.textStyles, baseStyle, props.defaultList ?? null]), [theme, baseStyle, props.defaultList]);
  const built = useRef(look);

  const start = (autoFocus: TextEditorProps["autoFocus"]): Session | null => {
    const element = host.current;
    if (!element) return null;
    const now = latest.current;
    const started = startSession({
      element,
      theme: now.theme,
      baseStyle: now.baseStyle,
      text: words.current,
      width: now.width,
      height: now.height,
      insets: now.insets,
      valign: now.valign,
      scale: scale.current,
      defaultList: now.defaultList ?? null,
      autoFocus,
      prefs: () => latest.current.prefs?.(),
      callbacks: () => latest.current,
      changed: (text) => {
        words.current = text;
        refit();
      },
    });
    session.current = started;
    editor.current = started.editor;
    return started;
  };

  const stop = (): void => {
    editor.current = null;
    session.current?.dispose();
    session.current = null;
  };

  useLayoutEffect(() => {
    built.current = look;
    start(latest.current.autoFocus);
    refit();
    const forget = onFontsLoaded(refit);
    return () => {
      forget();
      stop();
    };
    // The editor is made once; a change of theme is handled below, when nobody is composing.
  }, []);

  // Another theme or text style: the editor is made again, with the selection and focus put back.
  useLayoutEffect(() => {
    const current = editor.current;
    if (!current || built.current === look) return;
    const remake = (): void => {
      const saved = snapshotOf(editor.current as MountedEditor);
      stop();
      built.current = look;
      const remade = start(undefined);
      if (remade) restore(remade.editor, saved);
      refit();
    };
    // Never in the middle of an input method's composition: that would end it. Wait until it does.
    if (!current.view.composing) {
      remake();
      return;
    }
    const dom = current.view.dom;
    dom.addEventListener("compositionend", remake, { once: true });
    return () => dom.removeEventListener("compositionend", remake);
  }, [look]);

  // The box moved or changed size, or was given other insets.
  const box = JSON.stringify([width, height, insets ?? null, valign ?? null]);
  useLayoutEffect(() => {
    editor.current?.setBox({ width, height, insets, valign, scale: scale.current });
    refit();
  }, [box]);

  // Other words from outside are taken up only while nobody is typing.
  useLayoutEffect(() => {
    const current = editor.current;
    if (!current || current.view.hasFocus() || current.view.composing) return;
    if (sameText(props.text, current.getText())) return;
    words.current = props.text;
    current.setText(props.text);
    refit();
  }, [props.text]);

  return <div ref={host} className={className ? `ks-text-editor ${className}` : "ks-text-editor"} style={{ position: "absolute", inset: 0, width, height }} />;
}

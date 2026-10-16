import type { Text } from "@kasten-slides/wasm";
import { type JSX, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";

import { Upright } from "../../render/elements/Upright.tsx";
import { frameStyle } from "../../render/frame.ts";
import { type Place, cellAt, cellRect, layoutTable } from "../../render/table-layout.ts";
import { DEFAULT_INSETS } from "../../text/metrics.ts";
import { TextEditor, type TextEditorHandle } from "../../text/index.ts";
import { boxOf } from "../../theme/index.ts";
import { findElement } from "../session/scope.ts";
import type { EditorSession } from "../session/session.ts";
import type { EditorUi } from "../ui-state.ts";
import { useEditor } from "../useEditor.ts";
import { below, selectionAt, tabTarget } from "./cells.ts";
import "./cells.css";
import { takeTyped } from "./typing.ts";

const sameWords = (a: Text, b: Text): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * The cell of a table that is open for writing, edited in place over the slide: the editor of a text box, sized to the cell, with the same
 * padding and alignment as the drawing under it, so nothing moves when editing starts. What is typed goes into the table when the edit ends
 * by any route but Escape, as one step of undo; Escape puts it away. Tab and Shift+Tab write the cell and open the next or the one before
 * (Tab on the last cell adds a row), Enter writes it and opens the one below, and Shift+Enter breaks the paragraph. The cell is the one
 * given: a layer is made for each cell, so moving on to another is a new layer.
 */
export function CellLayer({ session, ui, id, at }: { session: EditorSession; ui: EditorUi; id: string; at: Place }): JSX.Element | null {
  const state = useEditor(session);
  const handle = useRef<TextEditorHandle>(null);
  // The words typed and not yet in the table, the words the cell had when it was opened, and the slide it was opened on: the edit can end because the person went to another slide.
  const pending = useRef<Text | null>(null);
  const original = useRef<Text | null>(null);
  const home = useRef(session.slide.id);

  const write = useCallback(() => {
    const text = pending.current;
    pending.current = null;
    if (text && (original.current === null || !sameWords(text, original.current))) session.tables.setCell(id, at, text, home.current);
  }, [session, id, at]);

  // Whatever ends the edit, by any route but Escape, writes what was typed.
  useEffect(() => () => write(), [write]);

  // The commands (bold, size, colour, link) reach the cell through the window's state.
  useEffect(() => {
    const current = handle.current;
    if (current) ui.setText(current);
    return () => ui.setText(null);
  }, [ui, id]);

  // A letter that opened the cell goes in once the editor is there. (The editor is a child, so it has been made by now.)
  useLayoutEffect(() => {
    const typed = takeTyped(id);
    if (typed) handle.current?.insertText(typed);
  }, [id]);

  // Where the caret goes as the cell opens: where the click that opened it was, else at the end of the words. Read once for each cell.
  const from = useMemo(() => session.state.editFrom, [session, id, at.row, at.col]);
  const element = findElement(session.slide.elements, id);
  const theme = state.deck.theme;
  const layout = session.slide.layout;
  const box = useMemo(() => (element ? boxOf(theme, layout, element) : null), [element, theme, layout]);
  if (!element || element.type !== "table" || !box) return null;

  const laid = layoutTable(element, box.w, box.h);
  const cell = cellAt(laid, at);
  const rect = cellRect(laid, at);
  if (!cell || !rect) return null;
  original.current ??= cell.cell.text;

  /** Writes the cell and opens another, or closes this one when there is none to go to. */
  const go = (to: "next" | "back" | "down"): void => {
    write();
    const table = session.scope.find((e) => e.id === id);
    if (table?.type !== "table") return;
    if (to === "down") {
      const next = below(table, at);
      if (next) session.startEditingCell(selectionAt(id, next));
      else session.stopEditing();
      return;
    }
    const target = tabTarget(table, at, to === "back");
    if (target === "append") {
      const added = session.tables.appendRow(id);
      if (added) session.startEditingCell(selectionAt(id, added));
    } else if (target) session.startEditingCell(selectionAt(id, target));
  };

  return (
    <div className="ks-text-layer ks-cell-layer" style={frameStyle(box, element, 1)} data-editing={id} data-cell={`${cell.row},${cell.col}`}>
      <Upright flipH={element.flipH} flipV={element.flipV}>
        {/* Only the cell takes the pointer: the layer is as big as the table, and a press on another cell is that cell's. */}
        <div className="ks-cell-editor" style={{ position: "absolute", left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
          <TextEditor
            handleRef={handle}
            theme={theme}
            text={cell.cell.text}
            baseStyle="body"
            width={rect.w}
            height={rect.h}
            insets={cell.cell.text.insets ?? DEFAULT_INSETS}
            valign={cell.cell.text.valign ?? "top"}
            // The first row of a table with a header is drawn in bold without bold being in its words, so it is here.
            {...(cell.header ? { className: "ks-cell-header" } : {})}
            autoFocus={from ?? "end"}
            cellKeys={{ tab: (back) => go(back ? "back" : "next"), enter: () => go("down") }}
            onChange={(text) => {
              pending.current = text;
            }}
            onDone={(text, reason) => {
              // Escape puts what was typed away; anything else that ends the edit (the focus leaving) keeps it.
              pending.current = reason === "escape" ? null : text;
              write();
              session.stopEditing();
            }}
          />
        </div>
      </Upright>
    </div>
  );
}

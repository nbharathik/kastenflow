// The paint format brush: pick up how the words and the box in hand look, then
// lay that on the next thing clicked. What was picked up lives in `ui.paint`;
// putting it down is done here, by watching for the selection to move. The
// cells of a table are picked up from and laid on the same way (table/paint.ts).

import type { Element, Text } from "@kasten-slides/wasm";
import { useEffect } from "react";

import { placeholderOf } from "../../theme/index.ts";
import type { CommandContext } from "../commands/index.ts";
import { shownFormat } from "../menus/format-view.ts";
import type { Patch } from "../session/elements.ts";
import type { EditorSession } from "../session/session.ts";
import { type CellSelection, sameSelection } from "../table/cells.ts";
import { captureCell, paintOperations } from "../table/paint.ts";
import type { EditorUi, PaintFormat } from "../ui-state.ts";
import { brushOf, carriesText, paintText } from "./paint-text.ts";

/** The looks of a box that the brush copies. */
const STYLE_KEYS = ["fill", "stroke", "radius", "shadow", "opacity", "startArrow", "endArrow"] as const;
/** Arrowheads are only for lines. */
const ARROW_KEYS: readonly string[] = ["startArrow", "endArrow"];
/** The elements that have a look of their own to copy or to take. */
const STYLED = new Set<Element["type"]>(["shape", "text", "line", "connector"]);
const HEADED = new Set<Element["type"]>(["line", "connector"]);

const textOf = (element: Element): Text | null => (element.type === "text" ? element.text : element.type === "shape" ? (element.text ?? null) : null);

/**
 * How the words and the box in hand look: the text being edited, else the selected
 * elements. A table gives the look of the cell in hand (the cell being written in, or the
 * one the keys move from) and its fill. Null when nothing is selected or open.
 */
export function capturePaint(ctx: CommandContext): PaintFormat | null {
  const { session, ui } = ctx;
  const picked = session.elements.find();
  const source = session.elements.find(session.state.editing ? [session.state.editing] : picked.slice(0, 1).map((e) => e.id))[0];
  if (!source && !ui.state.text) return null;

  // A table, with no cell open for writing: the look is the cell's own.
  if (source?.type === "table" && !ui.state.text) return captureCell(session, source);

  let brush: PaintFormat = { run: {} };
  if (ui.state.text !== null || picked.some((e) => textOf(e) !== null)) brush = brushOf(shownFormat(ctx));
  // The cell being written in gives its fill too.
  if (source?.type === "table") {
    const cell = captureCell(session, source);
    return { ...brush, ...(cell?.style ? { style: cell.style } : {}) };
  }
  if (!source || !STYLED.has(source.type)) return brush;
  const style: Record<string, unknown> = {};
  for (const key of STYLE_KEYS) {
    const value = source.style?.[key];
    if (value != null) style[key] = structuredClone(value);
  }
  return { ...brush, style };
}

/**
 * What to send so that `have` becomes `want`. A merge patch merges an object
 * into the one that is there, so the keys `have` has and `want` has not are
 * sent as null, to be taken off.
 */
function replacing(want: Patch[string], have: Patch[string]): Patch[string] {
  if (want === null || typeof want !== "object" || Array.isArray(want) || have === null || typeof have !== "object" || Array.isArray(have)) return want;
  const gone = Object.keys(have).filter((key) => !(key in want));
  return { ...want, ...Object.fromEntries(gone.map((key) => [key, null])) };
}

/** Lays the brush's look on the elements: one change for each, so one step of undo for each. */
export function applyPaint(session: EditorSession, paint: PaintFormat, ids: readonly string[]): void {
  const brushText = carriesText(paint);
  const { theme } = session.deck;
  for (const element of session.elements.find(ids)) {
    if (element.type === "table") {
      // The cells picked in it, else all of them.
      const operations = paintOperations(session, paint, element);
      if (operations.length > 0) session.run(() => session.core.applyBatch(operations));
      continue;
    }
    const patch: Patch = {};
    const text = textOf(element);
    if (brushText && text) {
      const baseStyle = placeholderOf(theme, session.slide.layout, element)?.style ?? "body";
      const painted = paintText(theme, baseStyle, text, paint);
      if (painted !== text) patch.text = painted as unknown as Patch;
    }
    if (paint.style && STYLED.has(element.type)) {
      const change: Patch = {};
      for (const key of STYLE_KEYS) {
        if (ARROW_KEYS.includes(key) && !HEADED.has(element.type)) continue;
        const want = (paint.style[key] ?? null) as Patch[string];
        const have = (element.style?.[key] ?? null) as Patch[string];
        if (JSON.stringify(want) !== JSON.stringify(have)) change[key] = replacing(want, have);
      }
      if (Object.keys(change).length > 0) patch.style = change;
    }
    if (Object.keys(patch).length > 0) session.elements.patch(patch, [element.id]);
  }
}

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * Puts the brush down. While `ui.paint` is set, the next time the selection
 * moves to something else, the brush is laid on it and put away. Escape puts
 * it away without laying it anywhere. A table is picked cells at a time with the
 * pointer, so it is laid on the cells picked when the pointer is let go (a click
 * on a cell, or a drag over several), not at the press; with the keys, at once.
 */
export function usePaintBrush(session: EditorSession, ui: EditorUi): void {
  useEffect(() => {
    /** What was selected, and which cells, when the brush picked its look up. */
    let from: readonly string[] | null = ui.state.paint ? [...session.state.selection] : null;
    let cellsFrom: CellSelection | null = session.state.cells;
    /** The pointer is down: cells picked now are not final. */
    let down = false;
    /** The brush is to be laid on what is picked when the pointer comes up. */
    let waiting = false;
    const lay = () => {
      const brush = ui.state.paint;
      const now = session.state.selection;
      waiting = false;
      if (!brush || now.length === 0) return;
      from = null;
      ui.setPaint(null);
      applyPaint(session, brush, now);
    };
    const onTable = (ids: readonly string[]) => ids.length === 1 && session.elements.find(ids)[0]?.type === "table";
    const watch = () => {
      const brush = ui.state.paint;
      if (!brush) {
        from = null;
        waiting = false;
        return;
      }
      if (from === null) {
        from = [...session.state.selection];
        cellsFrom = session.state.cells;
        return;
      }
      const now = session.state.selection;
      if (onTable(now)) {
        // The same table with other cells picked, or a table newly selected.
        if (sameIds(now, from) && sameSelection(session.state.cells, cellsFrom)) return;
        cellsFrom = session.state.cells;
        if (down) waiting = true;
        else lay();
        return;
      }
      if (now.length === 0 || sameIds(now, from)) return;
      lay();
    };
    const pressed = () => {
      down = true;
    };
    const released = () => {
      down = false;
      if (waiting) lay();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !ui.state.paint) return;
      event.stopPropagation();
      ui.setPaint(null);
    };
    const stopSession = session.subscribe(watch);
    const stopUi = ui.subscribe(watch);
    document.addEventListener("keydown", escape, true);
    // The press is heard first, before the slide acts on it; the release last, after it has picked the cell.
    document.addEventListener("pointerdown", pressed, true);
    document.addEventListener("pointerup", released);
    document.addEventListener("pointercancel", released);
    return () => {
      stopSession();
      stopUi();
      document.removeEventListener("keydown", escape, true);
      document.removeEventListener("pointerdown", pressed, true);
      document.removeEventListener("pointerup", released);
      document.removeEventListener("pointercancel", released);
    };
  }, [session, ui]);
}

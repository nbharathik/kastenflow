// The board's keys, while the board has the focus (keys typed into a card,
// a sticky or a field are theirs). Handled keys stop there, so the app's
// own shortcuts (Ctrl+K, Ctrl+W, Alt+←) keep working everywhere else. Tab
// and Shift+Enter grow a mind map from the one thing selected. Single keys
// make things (C card, S sticky, G section) and move the view (arrows with
// nothing selected, F fit, + and − zoom), P presents the sections as
// slides; 1 to 9 colour the selection (0 takes the colour off) and \ is
// focus mode; Mod+C, X, V and D copy, cut, paste and duplicate; ? lists
// them all (BoardHelp).

import { useReactFlow, type XYPosition } from "@xyflow/react";
import type { KeyboardEvent } from "react";

import { motionMs } from "../../../../lib/motion";
import { colorForKey } from "../colors";
import { copySelection, cutSelection, duplicateSelection, hasCopied, pasteCopied } from "../state/clipboard";
import type { BoardController } from "../state/controller";
import { nudge, removeSelection, restyleEdge, setCardSize, setColor, wrapInSection } from "../state/gestures";
import { addChild, addSibling, addSticky, newCard, openFile } from "../state/making";
import { select, selectedEdges, selectedNodes } from "../state/store";
import { present } from "../state/present";
import { setFocus } from "../state/focus";
import { setTool, type Tool } from "../state/tools";

/** What the keys ask of the canvas around the board. */
export interface CanvasKeys {
  /** The middle of what is in view, on the board. */
  centre(): XYPosition;
  toggleMinimap(): void;
  toggleHelp(): void;
  /** Whether the board keys are showing, which Escape closes first. */
  helpOpen(): boolean;
  closeHelp(): void;
  /** Opens Find on this board. */
  find(): void;
}

/** Colours what is selected: nodes, else connections. False when nothing is. */
function colourSelection(board: BoardController, color: string | null): boolean {
  const state = board.store.getState();
  const nodes = selectedNodes(state);
  if (nodes.length > 0) {
    setColor(board, nodes.map((n) => n.id), color);
    return true;
  }
  const edges = selectedEdges(state);
  for (const edge of edges) restyleEdge(board, edge.id, { color: color ?? "" });
  return edges.length > 0;
}

/** How far the arrow keys move the view, in screen pixels. */
const PAN_STEP = 120;

export function editable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.closest?.(".kasten-card-page")));
}

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** Enter on the selection: open cards beside the board, write in stickies,
 * shapes, sections and links, go into a nested board. */
export function enterSelection(board: BoardController): void {
  const chosen = selectedNodes(board.store.getState());
  if (chosen.length === 0) return;
  if (chosen.length > 1) {
    for (const node of chosen.reverse()) if (node.type === "card" && node.data.node.file) openFile(board, node.data.node.file, "stack");
    return;
  }
  const node = chosen[0]!;
  const file = node.data.node.file;
  if (node.type === "card" && file) return openFile(board, file, "stack");
  if (node.type === "board" && file) return board.deps.enter(file);
  if (node.type === "diagram" && file && !node.data.node.missing) return openFile(board, file, "here");
  if (node.type === "sticky" || node.type === "shape" || node.type === "section" || node.type === "link") board.store.setState({ editing: node.id });
}

/** The tools' keys: tldraw's where the board's own keys allow. */
const TOOL_KEYS: Record<string, Tool> = {
  v: "select",
  h: "hand",
  d: "draw",
  x: "erase",
  r: "shape:rect",
  o: "shape:ellipse",
  l: "connect",
};

export function useBoardKeys(board: BoardController, canvas: CanvasKeys) {
  const flow = useReactFlow();
  return (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || editable(event.target)) return;
    // The keys of a panel opened from a bar are the panel's, and Tab moves
    // through a bar's buttons rather than growing a mind map.
    const from = event.target instanceof Element ? event.target : null;
    if (from?.closest(".kasten-pop") || (event.key === "Tab" && from?.closest(".kasten-toolbar, .kasten-chrome"))) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const state = board.store.getState();
    const any = state.nodes.some((n) => n.selected) || state.edges.some((e) => e.selected);
    const chosen = selectedNodes(state);
    const one = chosen.length === 1 && !event.altKey && !mod ? chosen[0]! : null;
    let handled = true;
    if (mod && !event.altKey && key === "z") void (event.shiftKey ? board.redo() : board.undo());
    else if (mod && !event.altKey && !event.shiftKey && key === "y") void board.redo();
    else if (mod && !event.altKey && !event.shiftKey && key === "a") select(board.store, state.nodes.filter((n) => !n.hidden).map((n) => n.id));
    else if (mod && !event.altKey && !event.shiftKey && key === "c" && chosen.length > 0) copySelection(board);
    else if (mod && !event.altKey && !event.shiftKey && key === "x" && chosen.length > 0) cutSelection(board);
    else if (mod && !event.altKey && !event.shiftKey && key === "v" && hasCopied()) void pasteCopied(board, canvas.centre());
    else if (mod && !event.altKey && !event.shiftKey && key === "d" && chosen.length > 0) void duplicateSelection(board);
    else if (mod && !event.altKey && !event.shiftKey && key === "f") canvas.find();
    else if (mod || event.altKey) handled = false;
    else if ((key === "Delete" || key === "Backspace") && any) removeSelection(board);
    else if (ARROWS[key] && state.nodes.some((n) => n.selected)) {
      const [dx, dy] = ARROWS[key]!;
      const step = event.shiftKey ? 10 : 1;
      nudge(board, dx * step, dy * step);
    } else if (ARROWS[key]) {
      // Nothing selected: the arrows move around the board.
      const [dx, dy] = ARROWS[key]!;
      const step = event.shiftKey ? PAN_STEP * 4 : PAN_STEP;
      const view = flow.getViewport();
      void flow.setViewport({ x: view.x - dx * step, y: view.y - dy * step, zoom: view.zoom }, { duration: motionMs(140) });
    } else if ((key === "Tab" || (key === "Enter" && event.shiftKey)) && one && one.type !== "section") {
      // Mind-map mode: Tab grows a child, Shift+Enter a sibling.
      void (key === "Tab" ? addChild(board, one.id) : addSibling(board, one.id));
    } else if (key === "Enter" && any) enterSelection(board);
    else if (key === "Escape" && state.menu) board.store.setState({ menu: null });
    else if (key === "Escape" && canvas.helpOpen()) canvas.closeHelp();
    else if (key === "Escape" && state.tool !== "select") setTool(board, "select");
    else if (key === "Escape" && any) select(board.store, []);
    else if (key === "Escape" && state.focus) setFocus(board, false);
    else if (key === "\\" || event.code === "Backslash") setFocus(board, !state.focus);
    else if (!event.shiftKey && colorForKey(key) !== undefined && colourSelection(board, colorForKey(key) ?? null)) {
      // 1 to 9 pick a colour, 0 takes it off: the same as the dot's panel, without opening it.
    } else if (!event.shiftKey && TOOL_KEYS[key]) setTool(board, TOOL_KEYS[key]!);
    else if (event.shiftKey && event.code === "Digit1") void flow.fitView({ padding: 0.12, duration: motionMs(240), maxZoom: 1 });
    else if (event.shiftKey && event.code === "Digit0") void flow.zoomTo(1, { duration: motionMs(200) });
    else if (key === "e" && state.nodes.some((n) => n.selected && n.type === "card")) {
      const cards = selectedNodes(state).filter((n) => n.type === "card");
      const all = cards.every((n) => n.data.node.size === "expanded");
      setCardSize(board, cards.map((n) => n.id), all ? null : "expanded");
    } else if (key === "c" && !event.shiftKey) void newCard(board, canvas.centre());
    else if (key === "s" && !event.shiftKey) void addSticky(board, canvas.centre());
    else if (key === "g" && !event.shiftKey && chosen.length > 0) void wrapInSection(board, chosen.map((n) => n.id));
    else if (key === "f" && !event.shiftKey) void flow.fitView({ padding: 0.12, duration: motionMs(240), maxZoom: 1 });
    else if (key === "=" || key === "+") void flow.zoomIn({ duration: motionMs(160) });
    else if (key === "-" || key === "_") void flow.zoomOut({ duration: motionMs(160) });
    else if (key === "m" && !event.shiftKey) canvas.toggleMinimap();
    else if (key === "p" && !event.shiftKey) present(board);
    else if (key === "?") canvas.toggleHelp();
    else handled = false;
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
}

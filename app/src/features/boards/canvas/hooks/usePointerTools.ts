// Drawing, erasing and placing shapes with the pointer. With one
// of these tools a press starts its gesture wherever it lands, on a node or
// not, and React Flow's own dragging and selecting stand aside. Scrolling
// still pans and pinching still zooms.

import { useReactFlow } from "@xyflow/react";
import { useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

import type { ShapeKind } from "../../../../lib/vault/types";
import { useBoardState } from "../context";
import { shapeSize, strokeHit } from "../nodes/outlines";
import type { BoardController } from "../state/controller";
import { addDrawing, addShape } from "../state/making";
import { setTool, shapeOfTool, type Tool } from "../state/tools";

type Point = { x: number; y: number };

/** What the overlay shows while a gesture runs, in the board's own pixels
 * on screen (relative to the board's element). */
export interface Sketch {
  tool: Tool;
  points: Point[];
}

/** The box a shape takes: the one dragged out, or its own size centred
 * where the board was clicked. */
export function shapeBox(kind: ShapeKind, from: Point, to: Point): { x: number; y: number; width: number; height: number } {
  const width = Math.abs(to.x - from.x);
  const height = Math.abs(to.y - from.y);
  if (width < 12 && height < 12) {
    const size = shapeSize(kind);
    return { x: from.x - size.width / 2, y: from.y - size.height / 2, ...size };
  }
  return { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), width: Math.max(width, 12), height: Math.max(height, 12) };
}

/** The bars and menus over the board, which a tool never draws through. */
const CHROME = ".kasten-chrome, .kasten-toolbar, .kasten-board-menu, .kasten-pop, .react-flow__minimap, [role='dialog']";

export function usePointerTools(board: BoardController, wrapper: RefObject<HTMLDivElement | null>) {
  const flow = useReactFlow();
  const tool = useBoardState((s) => s.tool);
  const [sketch, setSketch] = useState<Sketch | null>(null);
  const live = useRef<{ screen: Point[]; points: Point[]; erased: Set<string>; frame: number; unwatch: () => void } | null>(null);
  const active = tool === "draw" || tool === "erase" || tool.startsWith("shape:");

  const local = (event: PointerEvent): Point => {
    const box = wrapper.current?.getBoundingClientRect();
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) };
  };

  const erase = (at: Point, erased: Set<string>) => {
    // A few screen pixels of slack, whatever the zoom.
    const tolerance = 6 / flow.getZoom();
    for (const node of board.doc.nodes) {
      if (erased.has(node.id) || !strokeHit(node, at, tolerance)) continue;
      erased.add(node.id);
      wrapper.current?.querySelector(`.react-flow__node[data-id="${CSS.escape(node.id)}"]`)?.classList.add("is-erasing");
    }
  };

  const unmark = () => {
    for (const el of wrapper.current?.querySelectorAll(".is-erasing") ?? []) el.classList.remove("is-erasing");
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): boolean => {
    if (!active || event.button !== 0 || (event.target as HTMLElement).closest(CHROME)) return false;
    event.preventDefault();
    event.stopPropagation();
    try {
      // The rest of the gesture comes here, even off the board.
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A pointer already up: its first move without a button ends the gesture.
    }
    const point = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    // The window losing the focus mid-gesture takes it away, as a cancel does.
    const onBlur = () => finish(false);
    window.addEventListener("blur", onBlur);
    const current = { screen: [local(event.nativeEvent)], points: [point], erased: new Set<string>(), frame: 0, unwatch: () => window.removeEventListener("blur", onBlur) };
    live.current = current;
    if (tool === "erase") erase(point, current.erased);
    setSketch({ tool, points: current.screen.slice() });
    return true;
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = live.current;
    if (!current) return;
    // The button went up where the board never heard of it: that ends it.
    if ((event.buttons & 1) === 0) return finish(true);
    // Every point the pointer passed, not only one per frame: smoother lines.
    const moves = event.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const move of moves.length ? moves : [event.nativeEvent]) {
      const point = flow.screenToFlowPosition({ x: move.clientX, y: move.clientY });
      current.screen.push(local(move));
      current.points.push(point);
      if (tool === "erase") erase(point, current.erased);
    }
    // One redraw of the overlay per frame.
    if (!current.frame) {
      current.frame = requestAnimationFrame(() => {
        current.frame = 0;
        if (live.current === current) setSketch({ tool, points: current.screen.slice() });
      });
    }
  };

  const finish = (keep: boolean) => {
    const current = live.current;
    live.current = null;
    setSketch(null);
    if (!current) return;
    current.unwatch();
    cancelAnimationFrame(current.frame);
    unmark();
    if (!keep) return;
    if (tool === "draw") {
      void addDrawing(board, current.points);
    } else if (tool === "erase") {
      if (current.erased.size) void board.commit([{ kind: "remove", ids: [...current.erased] }]);
    } else {
      const kind = shapeOfTool(tool);
      if (!kind) return;
      const box = shapeBox(kind, current.points[0]!, current.points[current.points.length - 1]!);
      // Like tldraw, one shape and then back to selecting it.
      setTool(board, "select");
      void addShape(board, kind, box);
    }
  };

  return {
    active,
    sketch,
    onPointerDown,
    onPointerMove,
    onPointerUp: () => finish(true),
    onPointerCancel: () => finish(false),
    onLostPointerCapture: () => finish(true),
  };
}

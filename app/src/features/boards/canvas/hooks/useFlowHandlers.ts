// What pointer gestures do on the board. A click on a card opens it beside
// the board in the side stack (Heptabase's side pane) unless it was a drag
// or a Shift selection; Ctrl or the middle button open a tab, Alt a split.
// A double-click edits in place: a card expands with its note ready to
// type in, a sticky, section or link takes its text, a nested board opens.

import { useStoreApi, type Connection, type FinalConnectionState, type OnConnectEnd, type ReactFlowProps } from "@xyflow/react";
import { useMemo, type MouseEvent as ReactMouseEvent } from "react";

import type { BoardSide } from "../../../../lib/vault/types";
import { howFrom } from "../../../workspace/store";
import type { FlowEdge, FlowNode } from "../model/flow";
import type { BoardController } from "../state/controller";
import { connect, setCardSize } from "../state/gestures";
import { openFile } from "../state/making";
import { edgesChanged, nodesChanged, select, type MenuTarget } from "../state/store";
import { setTool } from "../state/tools";

/** Clicks inside these belong to what is there (buttons, fields, the note editor). */
const OWN_CLICKS = ".nodrag, button, a, input, textarea, [contenteditable='true']";
const ownClick = (event: { target: EventTarget | null }) => Boolean((event.target as Element | null)?.closest?.(OWN_CLICKS));

const SIDES = new Set(["top", "right", "bottom", "left"]);
const sideOf = (id: string | null | undefined) => (id && SIDES.has(id) ? (id as BoardSide) : undefined);

/** One connection made with the connector tool, and it hands back the pointer. */
function leaveConnector(board: BoardController): void {
  if (board.store.getState().tool === "connect") setTool(board, "select");
}

/** Opens a card's note (or a board) the way the click asks. */
export function openFromClick(board: BoardController, node: FlowNode, event: ReactMouseEvent): void {
  const file = node.data.node.file;
  if (!file || node.data.node.missing) return;
  const how = howFrom(event);
  if (node.type === "card") openFile(board, file, how === "here" ? "stack" : how);
  else if ((node.type === "board" || node.type === "diagram") && (how === "tab" || how === "split")) openFile(board, file, how);
}

export function useFlowHandlers(board: BoardController): Partial<ReactFlowProps<FlowNode, FlowEdge>> {
  const flowStore = useStoreApi<FlowNode, FlowEdge>();
  return useMemo(() => {
    const openMenu = (event: ReactMouseEvent | MouseEvent, target: MenuTarget) => {
      event.preventDefault();
      board.store.setState({ menu: { x: event.clientX, y: event.clientY, target } });
    };
    return {
      onNodesChange: (changes) => nodesChanged(board.store, changes, board.dragging),
      onEdgesChange: (changes) => edgesChanged(board.store, changes),
      onNodeDragStart: (_, __, nodes) => board.dragStart(nodes.map((n) => n.id)),
      onNodeDragStop: () => board.dragStop(),
      onSelectionDragStart: (_, nodes) => board.dragStart(nodes.map((n) => n.id)),
      onSelectionDragStop: () => board.dragStop(),
      // Grabbing any selected node moves the whole selection; no extra
      // rectangle over a box selection.
      onSelectionEnd: () => flowStore.setState({ nodesSelectionActive: false }),
      onNodeMouseEnter: (_, node) => board.store.setState({ hovered: node.id }),
      onNodeMouseLeave: (_, node) => board.store.getState().hovered === node.id && board.store.setState({ hovered: null }),
      onConnectStart: (_, { nodeId }) => board.store.setState({ linking: nodeId }),
      onConnect: (c: Connection) => {
        connect(board, c.source, c.target, sideOf(c.sourceHandle), sideOf(c.targetHandle));
        leaveConnector(board);
      },
      // Letting go over a node's body, not a handle, still connects to it.
      onConnectEnd: ((event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
        board.store.setState({ linking: null });
        if (state.isValid || !state.fromNode) return;
        const point = "changedTouches" in event ? event.changedTouches[0] : event;
        const under = point && document.elementFromPoint(point.clientX, point.clientY)?.closest<HTMLElement>(".react-flow__node");
        const to = under?.dataset.id;
        if (to && to !== state.fromNode.id) {
          connect(board, state.fromNode.id, to, sideOf(state.fromHandle?.id));
          leaveConnector(board);
        }
      }) as OnConnectEnd,
      onNodeClick: (event, node) => {
        // Joining things, a click opens nothing.
        if (board.store.getState().tool === "connect") return;
        if (event.shiftKey || event.detail > 1 || ownClick(event)) return;
        openFromClick(board, node, event);
      },
      onNodeDoubleClick: (event, node) => {
        if (ownClick(event)) return;
        const data = node.data.node;
        if (node.type === "card" && !data.missing && data.file) {
          if (data.size !== "expanded") setCardSize(board, [node.id], "expanded");
          board.store.setState({ focusCard: { id: node.id, at: "end" } });
        } else if (node.type === "board" && data.file && !data.missing) board.deps.enter(data.file);
        // A diagram is edited over the board, where it is.
        else if (node.type === "diagram" && data.file && !data.missing) openFile(board, data.file, "here");
        else if (node.type === "sticky" || node.type === "shape" || node.type === "section" || node.type === "link") board.store.setState({ editing: node.id });
      },
      onEdgeDoubleClick: (_, edge) => board.store.setState({ editing: edge.id }),
      onNodeContextMenu: (event, node) => {
        const selected = board.store.getState().nodes.filter((n) => n.selected).map((n) => n.id);
        const ids = selected.includes(node.id) ? selected : [node.id];
        if (!selected.includes(node.id)) select(board.store, ids);
        openMenu(event, { kind: "nodes", ids });
      },
      onSelectionContextMenu: (event, nodes) => openMenu(event, { kind: "nodes", ids: nodes.map((n) => n.id) }),
      onEdgeContextMenu: (event, edge) => {
        select(board.store, [], [edge.id]);
        openMenu(event, { kind: "edge", id: edge.id });
      },
      onPaneContextMenu: (event) => {
        const { transform } = flowStore.getState();
        const box = flowStore.getState().domNode?.getBoundingClientRect();
        const at = { x: (event.clientX - (box?.left ?? 0) - transform[0]) / transform[2], y: (event.clientY - (box?.top ?? 0) - transform[1]) / transform[2] };
        openMenu(event, { kind: "pane", at });
      },
      onPaneClick: () => board.store.setState({ menu: null, editing: null }),
      onMoveStart: () => board.store.setState({ viewMoving: true, menu: null }),
    };
  }, [board, flowStore]);
}

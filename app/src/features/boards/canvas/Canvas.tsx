// The whiteboard's canvas: React Flow with the board's nodes and edges,
// the dotted background, the minimap, and the bars around it. Scrolling
// pans, Ctrl+scroll or a pinch zooms, dragging on empty space draws a
// selection box, and Space-drag, the middle button or the right button pan
// too (a right-click that does not move still opens the menu). Presenting
// (usePresentation) shows the sections one at a time and nothing else.

import { Background, BackgroundVariant, ConnectionMode, MiniMap, ReactFlow, SelectionMode, useReactFlow, useStore, type Viewport } from "@xyflow/react";
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

import { Kbd } from "../../../ui/Kbd";
import { useBoardPrefs } from "../board-prefs";
import { useMapSync } from "../map-live";
import { registerBoard } from "./active";
import { isFar, isOverview, useBoard, useBoardState } from "./context";
import { BoardEdge } from "./edges/BoardEdge";
import { EdgeMarkers } from "./edges/markers";
import { editable, useBoardKeys } from "./hooks/useBoardKeys";
import { useBoardMarks } from "./hooks/useBoardMarks";
import { useBoardSync } from "./hooks/useBoardSync";
import { useFocusPeek } from "./hooks/useFocusPeek";
import { useKeepInView } from "./hooks/useKeepInView";
import { useLinkedNode } from "./hooks/useLinkedNode";
import { openFromClick, useFlowHandlers } from "./hooks/useFlowHandlers";
import { useNoteDrop } from "./hooks/useNoteDrop";
import { usePointerTools } from "./hooks/usePointerTools";
import { usePresentation } from "./hooks/usePresentation";
import { useRightClick } from "./hooks/useRightClick";
import type { FlowEdge, FlowNode } from "./model/flow";
import { NODE_TYPES } from "./nodes/node-types";
import { setFocus } from "./state/focus";
import { addSticky, newCard } from "./state/making";
import { present } from "./state/present";
import { BoardHelp } from "./toolbar/BoardHelp";
import { FindOnBoard } from "./toolbar/FindOnBoard";
import { Breadcrumb } from "./toolbar/Breadcrumb";
import { CanvasActions } from "./toolbar/CanvasActions";
import { ContextMenu } from "./toolbar/ContextMenu";
import { PresentBar } from "./toolbar/PresentBar";
import { SelectionBar } from "./toolbar/SelectionBar";
import { SketchLayer } from "./toolbar/SketchLayer";
import { ToolBar } from "./toolbar/ToolBar";
import { ViewControl } from "./toolbar/ViewControl";
import { rememberView, viewOf } from "./trail";

const EDGE_TYPES = { board: BoardEdge };
const FIT = { padding: 0.12, maxZoom: 1 };
const PAN_BUTTONS = [1, 2];

const minimapColor = (node: FlowNode) => (node.type === "section" ? "var(--board-minimap-section)" : "var(--board-minimap-node)");

/** `embedded`: the board is shown inside a page, which keeps its bars away
 * until it is worked on, and presents it from its own header. */
export function Canvas({ embedded = false }: { embedded?: boolean }) {
  const board = useBoard();
  const flow = useReactFlow();
  const nodes = useBoardState((s) => s.nodes);
  const edges = useBoardState((s) => s.edges);
  const empty = useBoardState((s) => s.doc.nodes.length === 0);
  const edgeColors = useBoardState((s) => s.doc.edges.map((e) => e.color ?? "").join(" "));
  const far = useStore(isFar);
  const overview = useStore(isOverview);
  const wrapper = useRef<HTMLDivElement>(null);
  const minimap = useBoardPrefs((s) => s.minimap);
  const doubleClick = useBoardPrefs((s) => s.doubleClick);
  const focus = useBoardState((s) => s.focus);
  const [start] = useState<Viewport | undefined>(() => viewOf(board.path));
  // Fitting waits for nodes: on an empty board React Flow would fit the
  // first card or stroke the moment it appeared, and the view would jump.
  const [fit] = useState(() => !start && board.doc.nodes.length > 0);
  const handlers = useFlowHandlers(board);
  const [help, setHelp] = useState(false);
  const [finding, setFinding] = useState(false);
  const drop = useNoteDrop(board);
  const tool = useBoardState((s) => s.tool);
  const tools = usePointerTools(board, wrapper);
  const presentation = usePresentation(board, wrapper);
  const presenting = presentation.on;
  const selecting = tool === "select" && !presenting;
  const connecting = tool === "connect" && !presenting;
  const rightClick = useRightClick(board, { presenting, onPaneContextMenu: handlers.onPaneContextMenu });
  useBoardSync(board);
  useMapSync(board, !embedded);
  useBoardMarks(board);
  useKeepInView(board, wrapper);
  useLinkedNode(board);
  useFocusPeek(wrapper, focus && !presenting);
  // The palette acts on the whiteboard in front (a board inside a page is worked on from its own bars).
  useEffect(() => {
    if (embedded) return;
    return registerBoard(board);
  }, [board, embedded]);

  const colors = useMemo(() => [...new Set(edgeColors.split(" ").filter(Boolean))], [edgeColors]);

  // The board takes the keys when it opens, unless something else has them
  // (or it is a page's, which keeps them until the board is clicked).
  useEffect(() => {
    if (!embedded && document.activeElement === document.body) wrapper.current?.focus({ preventScroll: true });
  }, [embedded]);

  // The embed's header asks the board to present its sections, or to undo and redo.
  useEffect(() => {
    if (!embedded) return;
    const frame = wrapper.current?.closest(".kasten-board-embed");
    const run = () => present(board);
    const undo = () => void board.undo();
    const redo = () => void board.redo();
    frame?.addEventListener("kasten:present", run);
    frame?.addEventListener("kasten:undo", undo);
    frame?.addEventListener("kasten:redo", redo);
    // The header's buttons grey out while there is nothing to undo or redo.
    let told = "";
    const tell = () => {
      const { canUndo, canRedo } = board.store.getState();
      const now = `${canUndo}/${canRedo}`;
      if (now === told) return;
      told = now;
      frame?.dispatchEvent(new CustomEvent("kasten:history", { detail: { canUndo, canRedo } }));
    };
    tell();
    const stop = board.store.subscribe(tell);
    return () => {
      stop();
      frame?.removeEventListener("kasten:present", run);
      frame?.removeEventListener("kasten:undo", undo);
      frame?.removeEventListener("kasten:redo", redo);
    };
  }, [embedded, board]);

  /** The middle of what is in view, on the board. */
  const centre = () => {
    const box = wrapper.current?.getBoundingClientRect();
    return flow.screenToFlowPosition({ x: (box?.left ?? 0) + (box?.width ?? 0) / 2, y: (box?.top ?? 0) + (box?.height ?? 0) / 2 });
  };

  const onDoubleClick = (event: ReactMouseEvent) => {
    const target = event.target as HTMLElement;
    if (!selecting || !target.classList.contains("react-flow__pane")) return;
    const at = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    // A card or a sticky, whichever the person chose last (the "+" menu, Settings).
    if (useBoardPrefs.getState().doubleClick === "sticky") void addSticky(board, at);
    else void newCard(board, at);
  };

  const toggleMinimap = () => useBoardPrefs.getState().set({ minimap: !minimap });
  const closeHelp = () => {
    setHelp(false);
    wrapper.current?.focus({ preventScroll: true });
  };
  const closeFind = () => {
    setFinding(false);
    wrapper.current?.focus({ preventScroll: true });
  };
  const onKeyDown = useBoardKeys(board, { centre, toggleMinimap, toggleHelp: () => setHelp((h) => !h), helpOpen: () => help, closeHelp, find: () => setFinding(true) });

  return (
    <div
      ref={wrapper}
      className={`kasten-board is-tool-${tool.split(":")[0]}${far ? " is-far" : ""}${overview ? " is-overview" : ""}${drop.over ? " is-dropping" : ""}${presenting ? " is-presenting" : ""}${embedded ? " is-embedded" : ""}${focus && !presenting ? " is-focus" : ""}`}
      tabIndex={0}
      aria-label={`Whiteboard: ${board.doc.title}`}
      onKeyDown={(event) => (presenting ? presentation.onKey(event) : onKeyDown(event))}
      onClick={presentation.onClick}
      onDoubleClick={onDoubleClick}
      onPointerDownCapture={(event) => {
        // The board takes the keys when clicked, unless a field or a note was.
        if (!editable(event.target) && !(event.target as HTMLElement).closest(".kasten-board-menu, .kasten-pop, [role='dialog']")) wrapper.current?.focus({ preventScroll: true });
        rightClick.onPointerDown(event);
        // Drawing, erasing or placing a shape takes the press from React Flow.
        tools.onPointerDown(event);
      }}
      onPointerMove={tools.onPointerMove}
      onPointerUp={tools.onPointerUp}
      onPointerCancel={tools.onPointerCancel}
      onLostPointerCapture={tools.onLostPointerCapture}
      onPointerMoveCapture={rightClick.onPointerMoveCapture}
      onPointerUpCapture={rightClick.onPointerUpCapture}
      onContextMenuCapture={rightClick.onContextMenuCapture}
      onAuxClick={(event) => {
        if (event.button !== 1 || presenting) return;
        const id = (event.target as HTMLElement).closest<HTMLElement>(".react-flow__node")?.dataset.id;
        const node = id && board.store.getState().nodes.find((n) => n.id === id);
        if (node) openFromClick(board, node, event);
      }}
      {...drop.handlers}
    >
      <ReactFlow<FlowNode, FlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        {...(presenting ? { onNodesChange: handlers.onNodesChange, onEdgesChange: handlers.onEdgesChange } : handlers)}
        defaultViewport={start}
        fitView={fit}
        fitViewOptions={FIT}
        onMoveEnd={(_, view) => {
          rememberView(board.path, view);
          board.store.setState({ viewMoving: false });
        }}
        minZoom={0.05}
        maxZoom={2.5}
        panOnScroll={!presenting}
        zoomOnScroll={false}
        zoomOnPinch={!presenting}
        zoomOnDoubleClick={false}
        panOnDrag={presenting ? false : tool === "hand" ? true : PAN_BUTTONS}
        panActivationKeyCode={presenting ? null : "Space"}
        selectionOnDrag={selecting}
        nodesDraggable={selecting}
        nodesConnectable={selecting || connecting}
        elementsSelectable={selecting}
        selectionMode={SelectionMode.Full}
        multiSelectionKeyCode="Shift"
        selectionKeyCode="Shift"
        deleteKeyCode={null}
        disableKeyboardA11y
        nodesFocusable={false}
        edgesFocusable={false}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={28}
        nodeDragThreshold={4}
        nodeClickDistance={3}
        paneClickDistance={3}
        zIndexMode="manual"
        elevateNodesOnSelect={false}
        onlyRenderVisibleElements
      >
        {/* React Flow scales the dots' spacing with the zoom: far out the
            grid gets coarser, and in the overview it goes (at 10 % a dot
            every 2 px would cost more to paint than the board). */}
        {!overview && !presenting && <Background variant={BackgroundVariant.Dots} gap={far ? 88 : 22} size={far ? 2.4 : 1.3} color="var(--board-dots)" />}
        {minimap && !presenting && <MiniMap position="top-right" pannable zoomable nodeColor={minimapColor} nodeStrokeWidth={0} maskColor="var(--board-minimap-mask)" className="kasten-minimap" ariaLabel="Minimap" />}
        <SelectionBar />
      </ReactFlow>
      <SketchLayer sketch={tools.sketch} />
      <EdgeMarkers colors={colors} />
      {!presenting && !embedded && <Breadcrumb />}
      {empty && (
        <div className="kasten-board-empty" aria-hidden="true">
          <p className="text-16 font-medium text-ink">An empty board</p>
          <p>Double-click anywhere for a new {doubleClick}, or drag notes in from the sidebar.</p>
        </div>
      )}
      {presenting ? (
        <PresentBar />
      ) : (
        <>
          <ToolBar centre={centre} />
          <ViewControl minimap={minimap} onMinimap={toggleMinimap} />
          <CanvasActions embedded={embedded} onFind={() => setFinding(true)} onHelp={() => setHelp((h) => !h)} onFocus={() => setFocus(board, true)} />
          {focus && (
            <button type="button" className="kasten-focus-hint" onClick={() => setFocus(board, false)} aria-label="Leave focus mode" title="Leave focus mode">
              Focus mode <Kbd keys="\" />
            </button>
          )}
        </>
      )}
      <ContextMenu onMinimap={toggleMinimap} minimap={minimap} onHelp={() => setHelp(true)} onFind={() => setFinding(true)} />
      {help && !presenting && <BoardHelp onClose={closeHelp} />}
      {finding && !presenting && <FindOnBoard onClose={closeFind} />}
    </div>
  );
}

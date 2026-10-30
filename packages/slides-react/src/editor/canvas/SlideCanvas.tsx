import { boundsOf, cycle } from "@kasten-slides/canvas";
import type { Element } from "@kasten-slides/wasm";
import { type JSX, type KeyboardEvent, type PointerEvent, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { EmbedControls, EmbedLayer } from "../../embed/EmbedLayer.tsx";
import { useLinks } from "../../pages/useLinks.ts";
import { LiveContext } from "../../render/live.ts";
import { SlideView } from "../../render/index.ts";
import { dispatchKey } from "../commands/index.ts";
import { findElement } from "../session/scope.ts";
import type { EditorSession } from "../session/session.ts";
import type { EditorUi } from "../ui-state.ts";
import { useEditor } from "../useEditor.ts";
import { useElementSize } from "../useElementSize.ts";
import { useUiState } from "../useUi.ts";
import { AgentBadges } from "../agent/AgentBadges.tsx";
import { markedOn } from "../agent/marks.ts";
import { useImageDrops } from "../gallery/drops.ts";
import { StepChip } from "../panels/steps/StepChip.tsx";
import { gridOf, originOf, selectionAt } from "../table/cells.ts";
import { CellLayer } from "../table/CellLayer.tsx";
import { CellOutline } from "../table/CellOutline.tsx";
import { tableKeys } from "../table/keys.ts";
import "./canvas.css";
import { openContextMenuAt } from "./context-menu.ts";
import { CanvasController, type PointerInfo, type Target } from "./controller.ts";
import { DiagramBadges } from "./DiagramBadges.tsx";
import { DistanceLabels, useAltHeld } from "./DistanceLabels.tsx";
import { useEdgeScroll } from "./edge-scroll.ts";
import { GestureLayer } from "./GestureLayer.tsx";
import { useGlide } from "./glide.ts";
import { hitAt, itemsOf } from "./geometry.ts";
import { useGripCursor } from "./grip-cursor.ts";
import { BIG_NUDGE, NUDGE } from "./nudge.ts";
import { boundsOfAll, withOverrides } from "./overrides.ts";
import { usePan } from "./pan.ts";
import { usePinch } from "./pinch.ts";
import { pointerOf } from "./pointer.ts";
import { Overlay } from "./Overlay.tsx";
import { SelectionBar } from "./SelectionBar.tsx";
import { type Keys, keysOf, useStagePointer } from "./stage-pointer.ts";
import { useStageZoom } from "./stage-zoom.ts";
import { TextLayer } from "./TextLayer.tsx";
import { playTransition } from "./transition-preview.ts";
import { useLive } from "./useLive.ts";

export { withOverrides };

const NO_BOXES: ReadonlyMap<string, { x: number; y: number; w: number; h: number }> = new Map();
const PADDING = 48;

const targetOf = (element: EventTarget | null): Target => {
  if (!(element instanceof Element)) return { kind: "surface" };
  const handle = element.closest<HTMLElement>("[data-handle]")?.dataset.handle;
  if (handle) return { kind: "handle", handle: handle as never };
  if (element.closest("[data-rotate]")) return { kind: "rotate" };
  const end = element.closest<HTMLElement>("[data-end]")?.dataset.end;
  if (end === "start" || end === "end") return { kind: "end", end };
  // The move handle: of the block whose id it carries, or of the selection when it carries none.
  const move = element.closest<HTMLElement>("[data-move]");
  if (move) return { kind: "move", id: move.dataset.move || null };
  return { kind: "surface" };
};

/** The slide on its stage: drawn by the renderer, with the selection, handles and guides over it, and the text editor when a box is open. */
export function SlideCanvas({ session, ui }: { session: EditorSession; ui: EditorUi }): JSX.Element {
  const state = useEditor(session);
  const view = useUiState(ui);
  const stage = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const scaled = useRef<HTMLDivElement>(null);
  const size = useElementSize(stage);
  const { w: slideW, h: slideH } = state.deck.size;
  const fit = Math.max(0.05, Math.min((size.w - PADDING) / slideW, (size.h - PADDING) / slideH));
  const zoom = view.zoom === "fit" ? fit : view.zoom;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const drops = useImageDrops(session, page, zoomRef);
  const controller = useMemo(() => new CanvasController(session, ui, () => zoomRef.current), [session, ui]);
  // The canvas is drawn again when a gesture begins or ends, not for each step of the pointer: the steps are written to the page (`live.ts`).
  const gesture = useSyncExternalStore(controller.subscribeGesture, controller.getGesture, controller.getGesture);
  const live = useLive(session, controller, page, zoomRef);
  // The boxes of the composites a drag is resizing, which only the whole slide can draw again.
  const wide = useSyncExternalStore(live.subscribeWide, live.getWide, live.getWide);
  const pan = usePan(stage);
  const grip = useGripCursor(page);
  // Words that link say where they go, and Ctrl with a click follows them.
  useLinks(session, page);
  const pinch = usePinch(ui, () => controller.cancel());
  const glide = useStageZoom({ stage, page, ui, zoom, request: view.zoom, room: size });
  useGlide({ session, state, scaled, page, zoom });
  const [hover, setHover] = useState<string | null>(null);
  // Alt held over another block shows how far the selection is from it.
  const alt = useAltHeld();
  // Where the pointer is over the slide, for the keys that add something at it. Written on every move, so it holds no state.
  const track = pointerOf(ui);
  useEffect(
    () =>
      track.attach((clientX, clientY) => {
        const rect = page.current?.getBoundingClientRect();
        if (!rect) return null;
        const x = (clientX - rect.left) / zoomRef.current;
        const y = (clientY - rect.top) / zoomRef.current;
        const { w, h } = session.deck.size;
        return x >= 0 && y >= 0 && x <= w && y <= h ? { x, y } : null;
      }),
    [track, session],
  );

  const slide = session.slide;
  // The step the Steps panel or the step keys show, never past the last one the slide has.
  const previewed = view.previewStep === null ? undefined : Math.min(view.previewStep, slide.steps ?? 0);
  // A step shown belongs to the slide it was picked on.
  useEffect(() => {
    ui.setPreviewStep(null);
  }, [ui, state.slideId]);
  const shown = useMemo(() => (wide.size === 0 ? slide : withOverrides(slide, wide, state.deck.theme)), [slide, wide, state.deck.theme]);
  // A table is written in a cell at a time: the cell open is the focus of the cells picked, and the slide leaves out the words of that cell alone.
  const editedTable = state.editing !== null && state.cells?.table === state.editing ? findElement(slide.elements, state.editing) : undefined;
  const editedCell = editedTable?.type === "table" && state.cells ? originOf(gridOf(editedTable), state.cells.focus) : null;
  const hideCell = useMemo(() => (editedCell && state.editing ? { id: state.editing, row: editedCell.row, col: editedCell.col } : null), [state.editing, editedCell?.row, editedCell?.col]);
  const index = state.deck.slides.findIndex((s) => s.id === slide.id);
  const imageUrl = useCallback((path: string) => session.host.imageUrl(path), [session]);

  // A transition picked in the Transition dialog plays once on the slide, from the slide before it; the dialog is told when it ends.
  const previewing = view.transitionPreview;
  useEffect(() => {
    const root = scaled.current;
    if (!previewing || !root) return;
    const animations = playTransition(root, previewing.kind, previewing.duration, index > 0 ? (state.deck.slides[index - 1] ?? null) : null, slide, state.deck.theme);
    if (animations.length === 0) return void ui.endTransitionPreview();
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => ui.endTransitionPreview());
    return () => animations.forEach((animation) => animation.cancel());
    // A preview is asked for by its number; the slide as it is when it plays is what it plays on.
  }, [previewing?.id]);

  // When a text box closes, its editor takes the focus with it; the keys go back to the slide, unless the person has moved on to another control.
  const wasEditing = useRef(false);
  useEffect(() => {
    if (wasEditing.current && state.editing === null && (document.activeElement === null || document.activeElement === document.body)) {
      stage.current?.focus({ preventScroll: true });
    }
    wasEditing.current = state.editing !== null;
  }, [state.editing]);

  // A fixed zoom is what the person asked for; "fit" is only what fits, so the toolbar can say what it is.
  useEffect(() => {
    ui.setFitZoom(fit);
  }, [ui, fit]);

  const infoAt = (clientX: number, clientY: number, keys: Keys): PointerInfo => {
    const rect = page.current?.getBoundingClientRect();
    const z = zoomRef.current;
    return {
      x: rect ? (clientX - rect.left) / z : 0,
      y: rect ? (clientY - rect.top) / z : 0,
      shift: keys.shiftKey,
      alt: keys.altKey,
      mod: keys.ctrlKey || keys.metaKey,
      button: keys.button,
      detail: keys.detail,
      client: { x: clientX, y: clientY },
    };
  };
  const toInfo = (event: PointerEvent): PointerInfo => infoAt(event.clientX, event.clientY, event);
  // The last keys held, for the steps of a drag that goes on without the pointer moving (the stage scrolls under it).
  const held = useRef<Keys>({ shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, button: 0, detail: 1 });
  const edge = useEdgeScroll(
    stage,
    () => controller.busy,
    (x, y) => controller.move(infoAt(x, y, held.current)),
  );
  // The grey round the slide: a press there clears the selection, and a drag from it draws a selection rectangle.
  const stagePointer = useStagePointer({ session, controller, stage, pan, glide, edge, held, toInfo });

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // A press while the slide is still gliding to its new size is a press on where it will be: let it arrive first.
    glide.settle();
    // The middle button, or Space held, pans: the stage does it.
    if (pan.wants(event)) return;
    // A press on the bar over the selection is the bar's: its buttons and menus, not a gesture on the slide.
    if (event.target instanceof HTMLElement && event.target.closest("[data-selbar]")) return;
    // A press inside the text being edited belongs to the text: the caret, a drag, a double and a triple click are the editor's.
    // The slide must neither take the focus (which ends the edit) nor start a gesture of its own.
    if (state.editing !== null && event.target instanceof HTMLElement && event.target.closest(".ks-text-layer")) return;
    held.current = keysOf(event);
    // A press on a move handle starts a move. The handle is not text, so the box being edited keeps the focus, its caret and its
    // edit; the handle of another block is a press elsewhere, which ends the edit like one.
    const grab = targetOf(event.target);
    if (grab.kind === "move") {
      if (event.button !== 0) return;
      if (state.editing === null || (grab.id !== null && grab.id !== state.editing)) stage.current?.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      controller.down(toInfo(event), grab);
      return;
    }
    stage.current?.focus({ preventScroll: true });
    // Anywhere else a press ends the edit, and goes on as a press on the slide: on empty space it clears the selection, on another
    // block it selects that one. (The state read here is the one drawn last, so the live one is asked, not `state`.)
    if (session.state.editing !== null) session.stopEditing();
    event.currentTarget.setPointerCapture(event.pointerId);
    grip.take(event.target);
    controller.down(toInfo(event), targetOf(event.target));
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    track.moved(event.clientX, event.clientY);
    if (controller.busy) {
      held.current = keysOf(event);
      controller.move(toInfo(event));
      return edge.follow(event.clientX, event.clientY);
    }
    const at = toInfo(event);
    // On the way from a block to its lighter move handle, which stands out beyond its corner, the pointer is over the handle: the block stays hovered.
    const onHandle = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-move]")?.dataset.move : undefined;
    setHover(session.state.tool !== "select" ? null : onHandle || hitAt(itemsOf(session), at, zoomRef.current));
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    edge.stop();
    grip.give();
    controller.up(toInfo(event));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const editing = state.editing !== null;
    if (event.key === "Escape") {
      // Each step cancels one thing and says it took the key. When there is nothing left to cancel the key goes on, and in full screen
      // it is what leaves it (full-screen.ts).
      const took = (cancel: () => void): void => {
        cancel();
        event.preventDefault();
      };
      if (controller.cancel()) return event.preventDefault();
      if (editing) return took(() => session.stopEditing());
      if (view.previewStep !== null) return took(() => ui.setPreviewStep(null));
      if (state.tool !== "select") return took(() => session.setTool("select"));
      // With cells picked in a table the next step is the table's frame; the one after clears the selection.
      if (state.cells) return took(() => session.selectCells(null));
      // Inside a group, Escape goes up one level (and selects the group left); at the top it clears the selection.
      if (state.inside.length > 0) return took(() => session.leaveGroup());
      if (state.selection.length > 0) return took(() => session.select([]));
      return;
    }
    if (editing) {
      dispatchKey(event.nativeEvent, { session, ui }, "text");
      return;
    }
    // Space held, on the slide itself, makes the pointer a hand.
    if (event.key === " " && event.target === event.currentTarget && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      pan.space(true);
      return;
    }
    // Cells picked in a table take the arrows, Tab, Enter and the letters before the slide does.
    if (tableKeys(event.nativeEvent, { session })) return;
    if (dispatchKey(event.nativeEvent, { session, ui }, "stage")) return;
    const step = event.shiftKey ? BIG_NUDGE : NUDGE;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const arrow = arrows[event.key];
    if (arrow && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (state.selection.length > 0) session.elements.nudge(arrow[0], arrow[1]);
      else session.goBy(arrow[0] + arrow[1] > 0 ? 1 : -1);
    } else if ((event.key === "Enter" || event.key === "F2") && state.selection.length === 1) {
      event.preventDefault();
      const only = session.scope.find((e) => e.id === state.selection[0]);
      if (only && (only.type === "text" || only.type === "shape") && !only.locked) session.startEditing(only.id);
      // Enter on a group goes into it, as a double click does, and takes the first thing it holds.
      else if (only?.type === "group" && event.key === "Enter") session.enterGroup(only.id, only.children[0]?.id);
      // Enter on a table whose frame is selected opens its first cell.
      else if (only?.type === "table" && !only.locked) session.startEditingCell(selectionAt(only.id, { row: 0, col: 0 }));
    } else if (event.key === "Tab") {
      event.preventDefault();
      const order = session.scope.filter((e) => !e.locked).map((e) => e.id);
      const next = cycle(order, state.selection[0] ?? null, event.shiftKey);
      if (next) session.select([next]);
    }
  };

  const selected = controller.selectedItems().map((item) => ({ item, element: findElement(slide.elements, item.id) as Element }));
  // The groups gone into are outlined, so it is plain where the person is.
  const entered = state.inside.flatMap((id) => {
    const group = findElement(slide.elements, id);
    const box = group ? session.elements.boxOf(group) : null;
    return box ? [box] : [];
  });
  const group = selected.length > 1 ? boundsOfAll(selected.map((s) => s.item)) : null;
  // Where an assistant's work is badged: on its element; a drag slides the badge with it.
  const badgeBoxes = markedOn(slide) === 0 ? NO_BOXES : new Map(itemsOf(session).map((item) => [item.id, item]));
  const hovered = hover && state.tool === "select" ? (itemsOf(session).find((i) => i.id === hover) ?? null) : null;
  // A text box under the pointer says it can be written in (a click does); a block that is selected, that it can be moved.
  const overText = hovered && !hovered.locked && findElement(slide.elements, hovered.id)?.type === "text";
  const cursor =
    state.tool !== "select" ? "crosshair" : gesture === "grab" ? "grabbing" : gesture === "move" ? "move" : overText ? "text" : hovered && state.selection.includes(hovered.id) ? "move" : undefined;

  return (
    <div
      ref={stage}
      className="ks-stage"
      // Which slide this is, for a host that reads what is selected (a chat about the selected words).
      data-slide={slide.id}
      data-slide-number={index + 1}
      tabIndex={0}
      role="application"
      aria-label="Slide"
      onKeyDown={onKeyDown}
      // Two fingers zoom and carry the slide: the second takes back what the first began, and the slide's own handlers do not see them.
      onPointerDownCapture={(event) => pinch.down(event) && event.stopPropagation()}
      onPointerMoveCapture={(event) => pinch.move(event) && event.stopPropagation()}
      onPointerUpCapture={(event) => {
        const was = pinch.active;
        pinch.up(event);
        if (was) event.stopPropagation();
      }}
      onPointerCancelCapture={(event) => pinch.up(event)}
      {...stagePointer}
      onMouseDown={(event) => event.button === 1 && event.preventDefault()}
    >
      <div className="ks-page-wrap">
        <div
          ref={page}
          className="ks-page"
          data-tool={state.tool}
          style={{ width: slideW * zoom, height: slideH * zoom, cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          {...drops}
          onPointerCancel={() => {
            grip.give();
            controller.cancel();
          }}
          onPointerLeave={() => {
            track.left();
            setHover(null);
          }}
          onDoubleClick={(event) => !(event.target instanceof HTMLElement && event.target.closest("[data-selbar]")) && controller.doubleClick({ ...toInfo(event as never), detail: 2 })}
          onContextMenu={(event) => {
            event.preventDefault();
            if (controller.busy || (event.target instanceof HTMLElement && event.target.closest("[data-selbar]"))) return;
            const at = toInfo(event as never);
            openContextMenuAt(session, ui, zoomRef.current, event, { x: at.x, y: at.y });
          }}
        >
          <div ref={scaled} className="ks-page-scale" style={{ width: slideW, height: slideH, transform: `scale(${zoom})` }}>
            <LiveContext.Provider value={live}>
              <SlideView deck={state.deck} slide={shown} number={index + 1} count={state.deck.slides.length} mode="edit" step={previewed} imageUrl={imageUrl} hideTextOf={hideCell ? null : state.editing} hideCell={hideCell} />
            </LiveContext.Provider>
            {gesture === null ? <EmbedLayer deck={state.deck} slide={shown} step={previewed} selection={state.selection} host={session.host} imageUrl={imageUrl} /> : null}
            {state.editing && editedCell ? (
              <CellLayer key={`${state.editing}/${editedCell.row}/${editedCell.col}`} session={session} ui={ui} id={state.editing} at={editedCell} />
            ) : state.editing ? (
              <TextLayer session={session} ui={ui} id={state.editing} />
            ) : null}
          </div>
          <Overlay zoom={zoom} selected={selected} group={group} hovered={hovered} entered={entered} gesture={gesture} active={state.tool === "select"} />
          <CellOutline session={session} zoom={zoom} />
          <GestureLayer session={session} controller={controller} zoom={zoom} />
          {alt && gesture === null && state.tool === "select" && hovered && !state.selection.includes(hovered.id) ? <DistanceLabels from={controller.selectionBox()} to={boundsOf(hovered)} zoom={zoom} /> : null}
          {group && state.tool === "select" && state.editing === null && gesture === null && !selected.every(({ item }) => item.locked) ? (
            <SelectionBar session={session} ui={ui} bounds={group} zoom={zoom} width={slideW * zoom} />
          ) : null}
          {state.tool === "select" && state.editing === null && gesture === null ? <EmbedControls session={session} zoom={zoom} page={page} /> : null}
          <AgentBadges slide={slide} boxes={badgeBoxes} zoom={zoom} />
          <DiagramBadges session={session} zoom={zoom} hidden={gesture !== null} />
          {previewed !== undefined ? <StepChip step={previewed} steps={slide.steps ?? 0} /> : null}
        </div>
      </div>
    </div>
  );
}

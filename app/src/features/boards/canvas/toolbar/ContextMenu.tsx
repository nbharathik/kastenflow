// The board's right-click menu: for the nodes clicked, a connection, or
// the empty board. Deleting a note is here too, as its own explicit step
// with a question first; taking a card off the board never deletes.

import { useReactFlow } from "@xyflow/react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { boardLink } from "../../../../lib/kasten-links";
import { motionMs } from "../../../../lib/motion";
import { boxOf } from "../../../browser/bounds";
import { useOccludes } from "../../../browser/occlusion";
import type { BoardNode } from "../../../../lib/vault/types";
import { linkFor } from "../../../workspace/links";
import { titleOf } from "../../../workspace/names";
import { noteAt } from "../../../workspace/tree";
import { useBoard, useBoardState } from "../context";
import { layout, removeFromBoard, restyleEdge, setCardSize, setColor, toggleFold, wrapInSection } from "../state/gestures";
import { copySelection, duplicateSelection, hasCopied, pasteCopied } from "../state/clipboard";
import { setFocus } from "../state/focus";
import { addSection, addSticky, newCard, openFile } from "../state/making";
import { present } from "../state/present";
import { select, type Menu } from "../state/store";
import { ColorSwatches } from "./ColorSwatches";
import { LayoutMenu } from "./LayoutMenu";

function Item({ label, hint, danger, onSelect }: { label: string; hint?: string; danger?: boolean; onSelect: () => void }) {
  return (
    <button type="button" role="menuitem" className={`kasten-board-menu-item${danger ? " is-danger" : ""}`} onClick={onSelect}>
      <span className="flex-1">{label}</span>
      {hint && <span className="kasten-board-menu-hint">{hint}</span>}
    </button>
  );
}

const Divider = () => <hr className="kasten-board-menu-divider" />;

const STEPS: Record<string, (at: number, count: number) => number> = {
  ArrowDown: (at, count) => (at + 1) % count,
  ArrowUp: (at, count) => (at - 1 + count) % count,
  Home: () => 0,
  End: (_, count) => count - 1,
};

/** Up and down, Home and End go through the menu's items, round at the
 * ends, with a row of colours as one stop; left and right go along the
 * colours. Tab closes the menu. */
function moveFocus(event: ReactKeyboardEvent<HTMLElement>, close: () => void): void {
  if (event.key === "Tab") {
    event.preventDefault();
    close();
    return;
  }
  const active = document.activeElement as HTMLElement | null;
  const colours = active?.closest<HTMLElement>("[role='group']");
  if (colours && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
    event.preventDefault();
    const swatches = [...colours.querySelectorAll<HTMLElement>("button")];
    const at = swatches.indexOf(active!);
    swatches[(at + (event.key === "ArrowRight" ? 1 : -1) + swatches.length) % swatches.length]?.focus({ preventScroll: true });
    return;
  }
  const step = STEPS[event.key];
  const stops = [...event.currentTarget.querySelectorAll<HTMLElement>("[role='menuitem']:not(:disabled), [role='group']")];
  if (!step || stops.length === 0) return;
  event.preventDefault();
  const at = stops.findIndex((stop) => stop === active || stop.contains(active));
  const next = stops[step(at < 0 ? -1 : at, stops.length)]!;
  const target = next.getAttribute("role") === "group" ? (next.querySelector<HTMLElement>("[aria-pressed='true']") ?? next.querySelector<HTMLElement>("button")) : next;
  target?.focus({ preventScroll: true });
}

interface ViewActions {
  minimap: boolean;
  onMinimap(): void;
  onHelp(): void;
  onFind(): void;
}

export function ContextMenu(view: ViewActions) {
  const board = useBoard();
  const menu = useBoardState((s) => s.menu);
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const close = () => board.store.setState({ menu: null });

  useEffect(() => {
    if (!menu) return;
    const onDown = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) board.store.setState({ menu: null });
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") board.store.setState({ menu: null });
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [menu, board]);

  // Down and right of the pointer, or up or left of it where that does not
  // fit, as a native menu opens; kept inside the window, also as it grows:
  // arranging and the trash's question make it taller once open.
  const sides = useRef<{ x: Side; y: Side } | null>(null);
  useLayoutEffect(() => {
    sides.current = null;
    if (!menu) return setPlace(null);
    const fit = () => {
      const box = panel.current?.getBoundingClientRect();
      const width = box?.width ?? 240;
      const height = box?.height ?? 300;
      const { innerWidth, innerHeight } = window;
      const opened = (sides.current ??= { x: sideFor(menu.x, width, innerWidth), y: sideFor(menu.y, height, innerHeight) });
      setPlace({ left: placeOn(opened.x, menu.x, width, innerWidth), top: placeOn(opened.y, menu.y, height, innerHeight) });
    };
    fit();
    if (!panel.current || typeof ResizeObserver === "undefined") return;
    const sized = new ResizeObserver(fit);
    sized.observe(panel.current);
    return () => sized.disconnect();
  }, [menu]);

  // The keys go to the menu while it is open, and back where they were
  // when it closes, unless what was chosen took them somewhere.
  const open = Boolean(menu);
  // Over a browser tab's page it would be hidden behind it.
  useOccludes(open, () => (panel.current ? boxOf(panel.current.getBoundingClientRect()) : null));
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus({ preventScroll: true });
    return () => {
      if (!document.activeElement || document.activeElement === document.body) before?.focus({ preventScroll: true });
    };
  }, [open]);

  if (!menu) return null;
  // On the page's body: the board contains its layout, which would make
  // it the frame for a fixed menu and clip it.
  return createPortal(
    <div
      ref={panel}
      role="menu"
      aria-label="Board menu"
      className="kasten-board-menu kasten-board-layer"
      style={{ left: place?.left ?? menu.x, top: place?.top ?? menu.y }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(event) => {
        // The board's own keys wait while the menu is open.
        event.stopPropagation();
        moveFocus(event, close);
      }}
    >
      <MenuItems menu={menu} close={close} view={view} />
    </div>,
    document.body,
  );
}

/** Which side of the pointer a menu opens on, along one axis. */
type Side = "after" | "before";

/** After the pointer at `at` when `size` fits there in `room`, else before
 * it when it fits there, else after it, pushed back inside. */
export function sideFor(at: number, size: number, room: number): Side {
  return at + size <= room - 8 || at - size < 8 ? "after" : "before";
}

/** Where a menu of `size` starts on `side` of `at`, kept inside `room`. */
export function placeOn(side: Side, at: number, size: number, room: number): number {
  return Math.max(8, Math.min(side === "after" ? at : at - size, room - size - 8));
}

function MenuItems({ menu, close, view }: { menu: Menu; close: () => void; view: ViewActions }): ReactNode {
  const board = useBoard();
  const flow = useReactFlow();
  const [confirm, setConfirm] = useState<{ path: string; title: string } | null>(null);
  const [layoutOpen, setLayoutOpen] = useState(false);
  // The colours show only once asked for, here as in the bar over a selection.
  const [colourOpen, setColourOpen] = useState(false);
  const run = (action: () => unknown) => () => {
    close();
    void action();
  };
  const target = menu.target;

  if (target.kind === "pane") {
    return (
      <>
        <Item label="New card here" hint="C" onSelect={run(() => newCard(board, target.at))} />
        <Item label="Sticky here" hint="S" onSelect={run(() => addSticky(board, target.at))} />
        <Item label="Section here" onSelect={run(() => addSection(board, target.at))} />
        {hasCopied() && <Item label="Paste here" hint="Ctrl+V" onSelect={run(() => pasteCopied(board, target.at))} />}
        <Divider />
        <Item label="Select all" hint="Ctrl+A" onSelect={run(() => select(board.store, board.store.getState().nodes.filter((n) => !n.hidden).map((n) => n.id)))} />
        <Item label="Tidy the whole board" onSelect={run(() => layout(board, "tidy"))} />
        <Item label="Cluster cards by tag" onSelect={run(() => layout(board, "cluster"))} />
        <Divider />
        <Item label="Fit everything in view" hint="F" onSelect={run(() => flow.fitView({ padding: 0.12, duration: motionMs(240), maxZoom: 1 }))} />
        <Item label="Back to 100%" hint="Shift+0" onSelect={run(() => flow.zoomTo(1, { duration: motionMs(200) }))} />
        <Item label={view.minimap ? "Hide the minimap" : "Show the minimap"} hint="M" onSelect={run(view.onMinimap)} />
        <Item label="Present" hint="P" onSelect={run(() => present(board))} />
        <Item label="Find on this board" hint="Ctrl+F" onSelect={run(view.onFind)} />
        <Item label="Focus mode" hint="\" onSelect={run(() => setFocus(board, true))} />
        <Item label="Board keys" hint="?" onSelect={run(view.onHelp)} />
      </>
    );
  }

  if (target.kind === "edge") {
    const edge = board.doc.edges.find((e) => e.id === target.id);
    if (!edge) return null;
    return (
      <>
        <Item label="Edit label" hint="Double-click" onSelect={run(() => board.store.setState({ editing: edge.id }))} />
        <Item label={edge.fromEnd === "arrow" ? "No arrow at the start" : "Arrow at the start"} onSelect={run(() => restyleEdge(board, edge.id, { fromEnd: edge.fromEnd === "arrow" ? "" : "arrow" }))} />
        <Item label={(edge.toEnd ?? "arrow") === "arrow" ? "No arrow at the end" : "Arrow at the end"} onSelect={run(() => restyleEdge(board, edge.id, { toEnd: (edge.toEnd ?? "arrow") === "arrow" ? "none" : "" }))} />
        <Item label={colourOpen ? "Hide colours" : "Colour…"} onSelect={() => setColourOpen((o) => !o)} />
        {colourOpen && (
          <div className="kasten-board-menu-swatches">
            <ColorSwatches value={edge.color ?? null} onPick={(color) => run(() => restyleEdge(board, edge.id, { color: color ?? "" }))()} />
          </div>
        )}
        <Divider />
        <Item label="Delete connection" hint="Del" danger onSelect={run(() => removeFromBoard(board, [], [edge.id]))} />
      </>
    );
  }

  const nodes = target.ids.map((id) => board.node(id)).filter((n): n is BoardNode => Boolean(n));
  const cards = nodes.filter((n) => n.kind === "file" && n.file?.endsWith(".md") && !n.missing);
  const single = nodes.length === 1 ? nodes[0]! : null;
  if (confirm) {
    return (
      <div className="kasten-board-menu-confirm" role="alertdialog" aria-label="Move note to trash">
        <p>
          Move “{confirm.title}” to the trash? Its cards stay on their boards, marked missing, until you restore it from the Trash or take them off.
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" className="kasten-button" onClick={() => setConfirm(null)} autoFocus>
            Cancel
          </button>
          <button type="button" className="kasten-button is-danger" onClick={run(() => board.deps.trash(confirm.path).then(() => board.refresh()))}>
            Move to trash
          </button>
        </div>
      </div>
    );
  }
  return (
    <>
      {cards.length > 0 && <Item label={cards.length > 1 ? "Open in the side stack" : "Open beside the board"} hint="Enter" onSelect={run(() => [...cards].reverse().forEach((c) => openFile(board, c.file!, "stack")))} />}
      {single?.kind === "file" && single.file && !single.missing && <Item label="Open in a new tab" hint="Ctrl+click" onSelect={run(() => openFile(board, single.file!, "tab"))} />}
      {single?.kind === "file" && single.file?.endsWith(".md") && !single.missing && <Item label="Open in split view" hint="Alt+click" onSelect={run(() => openFile(board, single.file!, "split"))} />}
      {single?.kind === "file" && single.file?.endsWith(".md") && !single.missing && (
        <Item
          label="Copy link"
          hint="[[ ]]"
          onSelect={run(() => {
            const notes = board.deps.notes();
            const meta = noteAt(notes, single.file!);
            return navigator.clipboard?.writeText(meta ? linkFor(meta, notes) : `[[${single.file!.replace(/\.md$/, "")}]]`);
          })}
        />
      )}
      {single?.file?.endsWith(".canvas") && !single.missing && <Item label="Open this board" hint="Double-click" onSelect={run(() => board.deps.enter(single.file!))} />}
      {single?.kind === "file" && single.file?.endsWith(".drawio") && !single.missing && <Item label="Edit diagram" hint="Double-click" onSelect={run(() => openFile(board, single.file!, "here"))} />}
      {single && ((single.kind === "text" && !single.draw) || single.kind === "group" || single.kind === "link") && <Item label={single.kind === "group" ? "Rename section" : "Edit"} hint="Enter" onSelect={run(() => board.store.setState({ editing: single.id }))} />}
      {single?.kind === "group" && <Item label="Copy link to this location" onSelect={run(() => navigator.clipboard?.writeText(boardLink(board.path, single.id)))} />}
      {cards.length > 0 && (
        <>
          <Divider />
          <Item label="Show title only" onSelect={run(() => setCardSize(board, cards.map((c) => c.id), "title"))} />
          <Item label="Show title and first lines" onSelect={run(() => setCardSize(board, cards.map((c) => c.id), null))} />
          <Item label="Show the whole note" hint="E" onSelect={run(() => setCardSize(board, cards.map((c) => c.id), "expanded"))} />
        </>
      )}
      <Divider />
      <Item label={colourOpen ? "Hide colours" : "Colour…"} hint="1–9" onSelect={() => setColourOpen((o) => !o)} />
      {colourOpen && (
        <div className="kasten-board-menu-swatches">
          <ColorSwatches value={nodes.length === 1 ? (nodes[0]!.color ?? null) : null} onPick={(color) => run(() => setColor(board, target.ids, color))()} />
        </div>
      )}
      <Item label="Wrap in a section" hint="G" onSelect={run(() => wrapInSection(board, target.ids))} />
      <Item
        label="Duplicate"
        hint="Ctrl+D"
        onSelect={run(() => {
          select(board.store, target.ids);
          return duplicateSelection(board);
        })}
      />
      <Item
        label="Copy"
        hint="Ctrl+C"
        onSelect={run(() => {
          select(board.store, target.ids);
          copySelection(board);
        })}
      />
      {single?.kind === "group" && <Item label={single.collapsed ? "Unfold section" : "Fold section"} onSelect={run(() => toggleFold(board, single.id))} />}
      {single?.kind === "group" && <Item label="Present from here" hint="P" onSelect={run(() => present(board))} />}
      {nodes.length > 1 && <Item label={layoutOpen ? "Hide layout" : "Align and arrange…"} onSelect={() => setLayoutOpen((o) => !o)} />}
      {layoutOpen && <LayoutMenu onDone={close} />}
      <Divider />
      <Item label="Remove from board" hint="Del" onSelect={run(() => removeFromBoard(board, target.ids))} />
      {cards.length === 1 && single && (
        <Item
          label="Move note to trash…"
          danger
          onSelect={() => {
            const meta = noteAt(board.deps.notes(), single.file!);
            setConfirm({ path: single.file!, title: meta ? titleOf(meta) : single.file! });
          }}
        />
      )}
    </>
  );
}

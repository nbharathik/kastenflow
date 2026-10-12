// The small bar over a selection: a colour dot and the few actions that fit
// what is selected (selection-actions.ts), the rest in "More". It keeps its
// size at every zoom, steps aside while things move or are written in, and
// fades in when it comes back. The colours show only when the dot is pressed.

import { NodeToolbar, Position, useStore, type ReactFlowState } from "@xyflow/react";
import { useCallback, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";

import type { BoardNode } from "../../../../lib/vault/types";
import { useBoard, useBoardState } from "../context";
import { removeFromBoard, setCardSize, setColor, toggleFold, wrapInSection } from "../state/gestures";
import { openFile } from "../state/making";
import { ColorDot } from "./ColorDot";
import { closeOnEscape, focusBoard, focusFirst, moveAlong, useDismiss } from "./dismiss";
import { ToolIcon, type ToolIconName } from "./icons";
import { LayoutMenu } from "./LayoutMenu";
import { barActions, isNoteCard } from "./selection-actions";

const SIZES = [
  ["title", "Title only"],
  [null, "Title and first lines"],
  ["expanded", "Whole note"],
] as const;

/** The value every node shares, or null when they differ. */
function shared<T>(nodes: BoardNode[], pick: (n: BoardNode) => T): T | null {
  const first = nodes[0] ? pick(nodes[0]) : null;
  return nodes.every((n) => pick(n) === first) ? first : null;
}

/** Whether the selection's top is too near the top of the view for the
 * bar and its panels to fit above it. */
function useNearTop(ids: readonly string[]): boolean {
  return useStore(
    useCallback(
      (s: ReactFlowState) => {
        let top = Infinity;
        for (const id of ids) {
          const node = s.nodeLookup.get(id);
          if (node) top = Math.min(top, node.internals.positionAbsolute.y);
        }
        return top * s.transform[2] + s.transform[1] < 96;
      },
      [ids],
    ),
  );
}

interface BarButtonProps {
  icon: ToolIconName;
  label: string;
  title?: string;
  /** Opens a panel, and whether it is open. */
  expanded?: boolean;
  /** The icon is turned a quarter (a folded section). */
  turned?: boolean;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}

function BarButton({ icon, label, title, expanded, turned, onClick }: BarButtonProps) {
  return (
    <button type="button" aria-label={label} title={title ?? label} aria-expanded={expanded} aria-haspopup={expanded === undefined ? undefined : "menu"} onClick={onClick}>
      <ToolIcon name={icon} className={`size-4${turned ? " -rotate-90" : ""}`} />
    </button>
  );
}

/** A button with a small panel beside it, closed by a press elsewhere or Escape. */
function WithPanel({ open, close, children }: { open: boolean; close: () => void; children: ReactNode }) {
  const root = useRef<HTMLSpanElement>(null);
  useDismiss(open, root, close);
  return (
    <span ref={root} className="relative inline-flex" onKeyDown={closeOnEscape(open, close)}>
      {children}
    </span>
  );
}

export function SelectionBar() {
  const board = useBoard();
  const key = useBoardState((s) => s.nodes.reduce((ids, n) => (n.selected && !n.hidden ? `${ids}${ids ? " " : ""}${n.id}` : ids), ""));
  const busy = useBoardState((s) => s.moving || s.menu !== null || s.editing !== null);
  const doc = useBoardState((s) => s.doc);
  const [panel, setPanel] = useState<"size" | "align" | null>(null);
  const ids = useMemo(() => (key ? key.split(" ") : []), [key]);
  const nearTop = useNearTop(ids);
  const close = useCallback(() => setPanel(null), []);
  /** A choice in a panel closes it and hands the keys back to the board. */
  const choose = useCallback(() => {
    focusBoard(document.activeElement);
    setPanel(null);
  }, []);
  if (!key || busy) return null;
  const nodes = ids.map((id) => doc.nodes.find((n) => n.id === id)).filter((n): n is BoardNode => Boolean(n));
  const actions = barActions(nodes);
  if (actions.length === 0) return null;
  const cards = nodes.filter(isNoteCard);
  const size = shared(cards, (n) => n.size ?? null);
  const colours = new Set(nodes.map((n) => n.color ?? ""));
  const side = nearTop ? "below" : "above";
  const section = nodes.length === 1 && nodes[0]!.kind === "group" ? nodes[0]! : null;
  const toggle = (which: "size" | "align") => setPanel((now) => (now === which ? null : which));

  const render = (action: (typeof actions)[number]): ReactNode => {
    switch (action) {
      case "colour":
        return <ColorDot key={action} value={colours.size === 1 ? ([...colours][0] || null) : null} mixed={colours.size > 1} placement={side} onPick={(color) => setColor(board, ids, color)} />;
      case "size":
        return (
          <WithPanel key={action} open={panel === "size"} close={close}>
            <BarButton icon="size" label="Card size" title="How much of the note shows (E)" expanded={panel === "size"} onClick={() => toggle("size")} />
            {panel === "size" && (
              <div ref={focusFirst} className={`kasten-pop kasten-mini-menu is-${side}`} role="menu" aria-label="Card size" onKeyDown={moveAlong}>
                {SIZES.map(([value, label]) => (
                  <button
                    key={label}
                    type="button"
                    role="menuitemradio"
                    aria-checked={size === value}
                    className="kasten-board-menu-item"
                    onClick={() => {
                      setCardSize(board, cards.map((c) => c.id), value);
                      choose();
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </WithPanel>
        );
      case "open":
        return <BarButton key={action} icon="open" label="Open in the side stack" title="Open in the side stack (Enter)" onClick={() => [...cards].reverse().forEach((c) => openFile(board, c.file!, "stack"))} />;
      case "fold":
        return <BarButton key={action} icon="fold" label={section?.collapsed ? "Unfold section" : "Fold section"} turned={Boolean(section?.collapsed)} onClick={() => toggleFold(board, section!.id)} />;
      case "ungroup":
        return <BarButton key={action} icon="section" label="Ungroup section" title="Take the section away; what is inside stays" onClick={() => removeFromBoard(board, [section!.id])} />;
      case "align":
        return (
          <WithPanel key={action} open={panel === "align"} close={close}>
            <BarButton icon="layout" label="Align and arrange" expanded={panel === "align"} onClick={() => toggle("align")} />
            {panel === "align" && (
              <div ref={focusFirst} className={`kasten-pop is-${side}`} onKeyDown={moveAlong}>
                <LayoutMenu onDone={choose} />
              </div>
            )}
          </WithPanel>
        );
      case "group":
        return <BarButton key={action} icon="wrap" label="Wrap in a section" title="Wrap in a section (G)" onClick={() => void wrapInSection(board, ids)} />;
      case "remove":
        return <BarButton key={action} icon="remove" label="Remove from board" title="Remove from board (Delete). Notes stay in the vault." onClick={() => removeFromBoard(board, ids)} />;
      case "more":
        return (
          <BarButton
            key={action}
            icon="more"
            label="More"
            title="More (right-click)"
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              board.store.setState({ menu: { x: box.left, y: box.bottom + 6, target: { kind: "nodes", ids } } });
            }}
          />
        );
    }
  };

  return (
    <NodeToolbar nodeId={ids} isVisible position={nearTop ? Position.Bottom : Position.Top} offset={10}>
      <div className="kasten-toolbar kasten-selbar nodrag nopan" role="toolbar" aria-label="Selection" data-kind={section ? "section" : nodes.length > 1 ? "several" : cards.length ? "card" : "item"}>
        {actions.map(render)}
      </div>
    </NodeToolbar>
  );
}

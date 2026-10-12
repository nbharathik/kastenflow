// The line between two panes, which moves: drag it, or focus it and use
// the arrow keys (Shift for bigger steps). A double-click evens the two
// panes out. The panes follow the pointer while dragging, and their shares
// of the width are kept when it lets go.

import { useRef } from "react";

import { holdWhile } from "../features/browser/occlusion";
import { useWorkspace } from "../features/workspace/store";
import type { Pane } from "../features/workspace/tabs";
import { BIG_STEP, STEP } from "../ui/ResizeHandle";

/** The narrowest a pane gets, in pixels. */
const MIN = 280;

interface Drag {
  x: number;
  left: HTMLElement;
  right: HTMLElement;
  /** The two panes' widths in pixels, and their shares, at the start. */
  width: number;
  from: number;
  share: number;
  last: [number, number];
}

export function PaneDivider({ left, right }: { left: Pane; right: Pane }) {
  const drag = useRef<Drag | null>(null);

  /** The two panes' shares with the left one `leftWidth` pixels wide. */
  const shares = (leftWidth: number, total: number, share: number): [number, number] => {
    const width = Math.max(MIN, Math.min(total - MIN, leftWidth));
    const l = total > 0 ? (width / total) * share : share / 2;
    return [l, share - l];
  };

  const sides = (el: HTMLElement) => {
    const l = el.previousElementSibling as HTMLElement | null;
    const r = el.nextElementSibling as HTMLElement | null;
    return l && r ? { l, r, lw: l.getBoundingClientRect().width, rw: r.getBoundingClientRect().width } : null;
  };

  const keep = ([l, r]: [number, number]) => useWorkspace.getState().resizePanes({ [left.id]: l, [right.id]: r });
  const share = (left.size ?? 1) + (right.size ?? 1);

  return (
    <div className="relative z-30 w-0 shrink-0">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the panes"
        aria-valuenow={Math.round(((left.size ?? 1) / share) * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={0}
        title="Drag to resize the panes, or double-click to even them out"
        className="kasten-resize is-left"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const found = sides(e.currentTarget.parentElement!);
          if (!found) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture?.(e.pointerId);
          e.currentTarget.classList.add("is-dragging");
          document.body.classList.add("kasten-resizing");
          // A browser tab's native view would swallow the pointer as it crosses it.
          holdWhile("pane-divider");
          drag.current = { x: e.clientX, left: found.l, right: found.r, width: found.lw + found.rw, from: found.lw, share, last: [left.size ?? 1, right.size ?? 1] };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          d.last = shares(d.from + e.clientX - d.x, d.width, d.share);
          d.left.style.flexGrow = String(d.last[0]);
          d.right.style.flexGrow = String(d.last[1]);
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          if (!d) return;
          drag.current = null;
          e.currentTarget.classList.remove("is-dragging");
          document.body.classList.remove("kasten-resizing");
          keep(d.last);
        }}
        onPointerCancel={(e) => {
          drag.current = null;
          e.currentTarget.classList.remove("is-dragging");
          document.body.classList.remove("kasten-resizing");
        }}
        onDoubleClick={() => keep([share / 2, share / 2])}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          const found = sides(e.currentTarget.parentElement!);
          if (!found) return;
          e.preventDefault();
          const step = (e.shiftKey ? BIG_STEP : STEP) * (e.key === "ArrowLeft" ? -1 : 1);
          keep(shares(found.lw + step, found.lw + found.rw, share));
        }}
      />
    </div>
  );
}

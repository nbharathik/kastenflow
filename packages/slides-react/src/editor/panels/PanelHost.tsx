import { type JSX, type KeyboardEvent, type PointerEvent, useLayoutEffect, useRef, useState } from "react";

import { PANEL_WIDTH, chromeOf, useChromeValue } from "../chrome/chrome.ts";
import { useUiValue } from "../chrome/useUiValue.ts";
import { moveMs, play } from "../motion.ts";
import type { EditorSession } from "../session/session.ts";
import type { EditorUi, PanelName } from "../ui-state.ts";
import { SidePanel } from "./SidePanel.tsx";

const EASE = "cubic-bezier(0.2, 0, 0, 1)";

/** How far an arrow key moves the panel's edge, and Shift. */
const KEY_STEP = 16;
const KEY_STEP_BIG = 64;

/**
 * Where the side panel lives: beside the slide, as wide as the person made it (the edge is a handle: drag it, use the arrow keys, double
 * click for the usual width) and kept in this browser. It opens by growing out of the right edge and closes by shrinking back into it, over
 * the `--ks-base` time, so the slide beside it is refitted a little at a time instead of jumping. Where motion is off it just appears.
 */
export function PanelHost({ session, ui }: { session: EditorSession; ui: EditorUi }): JSX.Element | null {
  const wanted = useUiValue(ui, (state) => state.panel);
  const width = useChromeValue(ui, (state) => state.panelWidth);
  const chrome = chromeOf(ui);
  const host = useRef<HTMLDivElement>(null);
  /** The panel last shown: it outlives the window state's panel while the panel shrinks away. */
  const [drawn, setDrawn] = useState<PanelName | null>(wanted);
  const [dragging, setDragging] = useState(false);
  const latest = useRef(width);
  latest.current = width;
  const at = useRef(wanted);
  const stop = useRef<(() => void) | null>(null);

  useLayoutEffect(() => () => stop.current?.(), []);

  useLayoutEffect(() => {
    const before = at.current;
    at.current = wanted;
    const node = host.current;
    if (wanted !== null) {
      setDrawn(wanted);
      // Opening from nothing: grow out of the edge. Moving to another tab keeps the width.
      if (before === null && node) {
        const grow = play(node, [{ width: "0px" }, { width: `${latest.current}px` }], { duration: moveMs(node), easing: EASE });
        if (grow) node.style.overflow = "hidden";
        void grow?.finished.then(
          () => (node.style.overflow = ""),
          () => (node.style.overflow = ""),
        );
      }
      return;
    }
    if (before === null) return;
    if (!node) return setDrawn(null);
    const shrink = play(node, [{ width: `${node.offsetWidth}px` }, { width: "0px" }], { duration: moveMs(node), easing: EASE });
    if (!shrink) return setDrawn(null);
    node.style.overflow = "hidden";
    const done = () => setDrawn((now) => (at.current === null ? null : now));
    void shrink.finished.then(done, done);
  }, [wanted]);

  const grab = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const from = { x: event.clientX, width: latest.current };
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // The window's own events do as well.
    }
    // Dragging left makes the panel wider.
    const move = (pointer: globalThis.PointerEvent) => chrome.setPanelWidth(from.width + from.x - pointer.clientX, false);
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      stop.current = null;
      setDragging(false);
      chrome.setPanelWidth(latest.current);
    };
    stop.current = end;
    setDragging(true);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const onEdgeKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? KEY_STEP_BIG : KEY_STEP;
    const next = event.key === "ArrowLeft" ? latest.current + step : event.key === "ArrowRight" ? latest.current - step : event.key === "Home" ? PANEL_WIDTH.max : event.key === "End" ? PANEL_WIDTH.min : null;
    if (next === null) return;
    event.preventDefault();
    chrome.setPanelWidth(next);
  };

  const shown = wanted ?? drawn;
  if (shown === null) return null;
  return (
    <div ref={host} className={`ks-panel-host${dragging ? " is-dragging" : ""}`} style={{ width }}>
      <div
        className={`ks-panel-edge${dragging ? " is-active" : ""}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the side panel"
        aria-valuemin={PANEL_WIDTH.min}
        aria-valuemax={PANEL_WIDTH.max}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={grab}
        onKeyDown={onEdgeKey}
        onDoubleClick={() => chrome.setPanelWidth(PANEL_WIDTH.start)}
      />
      <SidePanel session={session} ui={ui} shown={shown} />
    </div>
  );
}

// One small control in the board's lower-left corner for the view: undo and
// redo, zoom out and in around the percentage (which opens fit, 100 % and a
// few more), and the minimap. It rests faint until the pointer comes to it.

import { useReactFlow, useStore } from "@xyflow/react";
import { useCallback, useRef, useState } from "react";

import { motionMs } from "../../../../lib/motion";
import { useBoard, useBoardState } from "../context";
import { closeOnEscape, focusBoard, focusFirst, moveAlong, useDismiss } from "./dismiss";
import { ToolIcon } from "./icons";

const percent = (s: { transform: [number, number, number] }) => Math.round(s.transform[2] * 100);

interface Props {
  minimap: boolean;
  onMinimap: () => void;
}

export function ViewControl({ minimap, onMinimap }: Props) {
  const board = useBoard();
  const flow = useReactFlow();
  const zoom = useStore(percent);
  const canUndo = useBoardState((s) => s.canUndo);
  const canRedo = useBoardState((s) => s.canRedo);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, root, close);
  const fit = () => void flow.fitView({ padding: 0.12, duration: motionMs(260), maxZoom: 1 });
  const zoomTo = (level: number) => void flow.zoomTo(level, { duration: motionMs(180) });
  const choose = (action: () => void) => () => {
    focusBoard(root.current);
    close();
    action();
  };
  return (
    <div ref={root} className="kasten-chrome kasten-view" role="toolbar" aria-label="View" onKeyDown={closeOnEscape(open, close)}>
      <button type="button" className="kasten-tool" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => void board.undo()}>
        <ToolIcon name="undo" />
      </button>
      <button type="button" className="kasten-tool" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => void board.redo()}>
        <ToolIcon name="redo" />
      </button>
      <span className="kasten-toolbar-sep" />
      <button type="button" className="kasten-tool" aria-label="Zoom out" title="Zoom out (−, Ctrl+scroll)" onClick={() => void flow.zoomOut({ duration: motionMs(180) })}>
        <ToolIcon name="minus" />
      </button>
      <span className="relative inline-flex">
        <button type="button" className="kasten-zoom-value" aria-label={`Zoom ${zoom}%`} aria-haspopup="menu" aria-expanded={open} title="Fit, 100% and more" onClick={() => setOpen((o) => !o)}>
          {zoom}%
        </button>
        {open && (
          <div ref={focusFirst} className="kasten-pop kasten-above-start kasten-zoom-menu" role="menu" aria-label="Zoom" onKeyDown={moveAlong}>
            <button type="button" role="menuitem" className="kasten-board-menu-item" onClick={choose(fit)}>
              <span className="flex-1">Fit everything in view</span>
              <span className="kasten-board-menu-hint">F</span>
            </button>
            {[100, 50, 200].map((level) => (
              <button key={level} type="button" role="menuitem" className="kasten-board-menu-item" onClick={choose(() => zoomTo(level / 100))}>
                <span className="flex-1">{level}%</span>
                {level === 100 && <span className="kasten-board-menu-hint">Shift+0</span>}
              </button>
            ))}
          </div>
        )}
      </span>
      <button type="button" className="kasten-tool" aria-label="Zoom in" title="Zoom in (+, Ctrl+scroll)" onClick={() => void flow.zoomIn({ duration: motionMs(180) })}>
        <ToolIcon name="plus" />
      </button>
      <span className="kasten-toolbar-sep" />
      <button type="button" className="kasten-tool" aria-label="Minimap" aria-pressed={minimap} title="Minimap (M)" onClick={onMinimap}>
        <ToolIcon name="map" />
      </button>
    </div>
  );
}

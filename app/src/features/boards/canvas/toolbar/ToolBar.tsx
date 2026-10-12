// The board's tools: a slim strip of icons on its left edge, as in tldraw. Names
// and keys are in the tooltips. Select and hand; a sticky, the shapes, the pen,
// a connector and a section; and "+" for everything else that goes on a
// board. The pen's widths, colour and eraser show beside it only while it is
// the tool. The strip rests quietly until the pointer comes to it (unless the
// setting keeps it at full strength).

import { useState, type ReactNode } from "react";

import type { ShapeKind } from "../../../../lib/vault/types";
import { useBoardPrefs } from "../../board-prefs";
import { useBoard, useBoardState } from "../context";
import type { Point } from "../model/placement";
import { SHAPES, outlinePath } from "../nodes/outlines";
import { addSection, addSticky } from "../state/making";
import { PEN_SIZES, setPen } from "../state/pen";
import { setTool, shapeOfTool, type Tool } from "../state/tools";
import { AddMenu } from "./AddMenu";
import { ColorDot } from "./ColorDot";
import { moveAlong } from "./dismiss";
import { ToolIcon } from "./icons";

const SELECT = "M6 3l12 9-5.5 1.2L16 20l-2.6 1.2-2.7-6.4L6 18.5z";
const HAND = "M8 12V6.5a1.5 1.5 0 013 0V11m0-5.5v-1a1.5 1.5 0 013 0V11m0-4.5a1.5 1.5 0 013 0V12m0-3a1.5 1.5 0 013 0v5.5a6.5 6.5 0 01-6.5 6.5h-1.2a6 6 0 01-4.8-2.4L4.6 14.9a1.6 1.6 0 012.4-2.1L8 14";
const PEN = "M4 20l1.2-4.4L15.6 5.2a2.1 2.1 0 013 3L8.2 18.6zM13.5 7.3l3 3";
const ERASER = "M8.5 20h11M4.4 15.6l9.2-9.2a2 2 0 012.8 0l3.2 3.2a2 2 0 010 2.8L12 20H8.8l-4.4-4.4z";

function Glyph({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="size-[18px]" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function ShapeGlyph({ kind }: { kind: ShapeKind }) {
  const wide = kind !== "ellipse" && kind !== "diamond" && kind !== "triangle";
  const [w, h] = wide ? [20, 13] : [17, 15];
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden="true">
      <path transform={`translate(${(24 - w) / 2} ${(24 - h) / 2})`} d={outlinePath(kind, w, h, 1)} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" />
    </svg>
  );
}

interface ToolButtonProps {
  label: string;
  keys?: string;
  pressed?: boolean;
  expanded?: boolean;
  /** Left out of a very short board (a board inside a page); its key still works. */
  minor?: boolean;
  onClick: () => void;
  children: ReactNode;
}

function ToolButton({ label, keys, pressed, expanded, minor, onClick, children }: ToolButtonProps) {
  return (
    <button type="button" className="kasten-tool" aria-label={label} aria-pressed={pressed} aria-expanded={expanded} data-minor={minor || undefined} title={keys ? `${label} (${keys})` : label} onClick={onClick}>
      {children}
    </button>
  );
}

export function ToolBar({ centre }: { centre: () => Point }) {
  const board = useBoard();
  const tool = useBoardState((s) => s.tool);
  const pen = useBoardState((s) => s.pen);
  const solid = useBoardPrefs((s) => s.alwaysToolbar);
  const [shapes, setShapes] = useState(false);
  const [lastShape, setLastShape] = useState<ShapeKind>("rect");
  const shape = shapeOfTool(tool);
  const inking = tool === "draw" || tool === "erase";
  const pick = (next: Tool) => {
    setShapes(false);
    setTool(board, next);
  };
  /** A width is for the pen: choosing one while erasing goes back to it. */
  const widen = (size: number) => {
    setPen(board, { size });
    if (tool !== "draw") pick("draw");
  };
  return (
    <div className="kasten-chrome kasten-tools" role="toolbar" aria-label="Tools" aria-orientation="vertical" data-solid={solid || undefined} onKeyDown={(e) => e.key === "Escape" && setShapes(false)}>
      <ToolButton label="Select" keys="V" pressed={tool === "select"} onClick={() => pick("select")}>
        <Glyph d={SELECT} />
      </ToolButton>
      <ToolButton label="Hand" keys="H" minor pressed={tool === "hand"} onClick={() => pick("hand")}>
        <Glyph d={HAND} />
      </ToolButton>
      <span className="kasten-tools-sep" />
      <ToolButton label="Sticky" keys="S" onClick={() => void addSticky(board, centre())}>
        <ToolIcon name="sticky" />
      </ToolButton>
      <span className="relative inline-flex">
        <ToolButton
          label="Shapes"
          keys="R rectangle, O ellipse"
          pressed={Boolean(shape)}
          expanded={shapes}
          onClick={() => (shape ? setShapes((open) => !open) : (setTool(board, `shape:${lastShape}`), setShapes(true)))}
        >
          <ShapeGlyph kind={shape ?? lastShape} />
        </ToolButton>
        {shapes && (
          <div className="kasten-pop kasten-beside kasten-shapes" role="group" aria-label="Shapes" onKeyDown={moveAlong}>
            {SHAPES.map(({ kind, name }) => (
              <button
                key={kind}
                type="button"
                className="kasten-tool"
                aria-pressed={shape === kind}
                aria-label={name}
                title={name}
                onClick={() => {
                  setLastShape(kind);
                  pick(`shape:${kind}`);
                }}
              >
                <ShapeGlyph kind={kind} />
              </button>
            ))}
          </div>
        )}
      </span>
      <span className="relative inline-flex">
        <ToolButton label="Pen" keys="D" pressed={tool === "draw"} onClick={() => pick("draw")}>
          <Glyph d={PEN} />
        </ToolButton>
        {inking && (
          <div className="kasten-pop kasten-beside kasten-pen" role="group" aria-label="Pen" onKeyDown={moveAlong}>
            {PEN_SIZES.map((size) => (
              <button key={size} type="button" className="kasten-tool" aria-pressed={tool === "draw" && pen.size === size} aria-label={`Width ${size}`} title={`Width ${size}`} onClick={() => widen(size)}>
                <span className="kasten-pen-dot" style={{ width: size + 2, height: size + 2 }} />
              </button>
            ))}
            <ColorDot label="Pen colour" value={pen.color} placement="below" onPick={(color) => setPen(board, { color })} />
            <span className="kasten-tools-sep" />
            <ToolButton label="Eraser" keys="X" pressed={tool === "erase"} onClick={() => pick(tool === "erase" ? "draw" : "erase")}>
              <Glyph d={ERASER} />
            </ToolButton>
          </div>
        )}
      </span>
      <ToolButton label="Connector" keys="L" minor pressed={tool === "connect"} onClick={() => pick(tool === "connect" ? "select" : "connect")}>
        <ToolIcon name="arrow-up-right" />
      </ToolButton>
      <ToolButton label="Section" minor onClick={() => void addSection(board, centre())}>
        <ToolIcon name="section" />
      </ToolButton>
      <span className="kasten-tools-sep" />
      <AddMenu centre={centre} />
    </div>
  );
}

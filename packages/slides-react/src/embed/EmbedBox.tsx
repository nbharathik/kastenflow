// The box of an embed and the page inside it. The page is laid out at the size its frame says (a window of its own, a design such
// as Desktop) and the whole is scaled to the box with a transform, so a page keeps its layout, its fonts and its proportions, and
// resizing the box only changes the scale.

import type { JSX, ReactNode } from "react";

import { type Frame, frameFor, type View } from "./scale.ts";
import "./embed.css";

export interface EmbedBoxProps {
  /** The box in slide units. */
  box: { w: number; h: number };
  view: View;
  children: ReactNode | ((frame: Frame) => ReactNode);
  className?: string;
}

/** The inline style of the stage a page is laid out on: its place in the box, its layout size, and the scale. */
export function stageStyle(frame: Frame): { left: number; top: number; width: number; height: number; transform: string } {
  return { left: frame.at.x, top: frame.at.y, width: frame.layout.w, height: frame.layout.h, transform: `scale(${frame.scale})` };
}

export function EmbedBox({ box, view, children, className = "" }: EmbedBoxProps): JSX.Element {
  const frame = frameFor(box, view);
  return (
    <div className={`ks-embed-box${className ? ` ${className}` : ""}`} data-letterboxed={frame.letterboxed || undefined}>
      <div className="ks-embed-stage" style={stageStyle(frame)} data-scale={frame.scale}>
        {typeof children === "function" ? children(frame) : children}
      </div>
    </div>
  );
}

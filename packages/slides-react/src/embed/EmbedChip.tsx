// The little control that goes with an embed being looked at: how far its page is zoomed, a step down and up, Fit, and (while a
// presentation hands the page the pointer) the way back. It is drawn in plain pixels beside the box, not scaled with the page.

import type { JSX, PointerEvent } from "react";

import { Icon } from "../editor/ui/Icon.tsx";
import { percent } from "./scale.ts";
import "./embed-chip.css";

export interface EmbedChipProps {
  /** The scale the page is drawn at now (1 is 100%). */
  scale: number;
  /** The page follows the box (Fit) rather than a zoom that was set. */
  fitted: boolean;
  onStep(direction: 1 | -1): void;
  onFit(): void;
  /** Gives the keys back to the slide; offered while a presentation lets the page take them. */
  onDone?: (() => void) | undefined;
  /** Previews the live page in the peek beside the slide (a web page in the editor). */
  onPreview?: (() => void) | undefined;
  /** Opens the address in the person's own browser (a web page in the editor). */
  onOpenOutside?: (() => void) | undefined;
  /** Where it sits: over the corner of a box in a presentation, or beside the selection in the editor. */
  className?: string;
}

const stop = (event: PointerEvent): void => event.stopPropagation();

export function EmbedChip({ scale, fitted, onStep, onFit, onDone, onPreview, onOpenOutside, className = "" }: EmbedChipProps): JSX.Element {
  return (
    <div className={`ks-embed-chip${className ? ` ${className}` : ""}`} role="group" aria-label="Page zoom" onPointerDown={stop} onPointerUp={stop} onClick={(event) => event.stopPropagation()}>
      {onPreview ? (
        <button type="button" className="ks-embed-chip-btn" aria-label="Preview live" title="Preview live: show the page beside the slide" onClick={onPreview}>
          <Icon name="globe" size={14} />
        </button>
      ) : null}
      {onOpenOutside ? (
        <button type="button" className="ks-embed-chip-btn" aria-label="Open externally" title="Not showing? Open externally" onClick={onOpenOutside}>
          <Icon name="external-link" size={14} />
        </button>
      ) : null}
      <button type="button" className="ks-embed-chip-btn" aria-label="Zoom out" title="Zoom out (Ctrl and -)" onClick={() => onStep(-1)}>
        {"−"}
      </button>
      <output className="ks-embed-chip-value" aria-live="polite" data-fitted={fitted || undefined} title={fitted ? "The page fits the box" : "Zoom of the page"}>
        {percent(scale)}
      </output>
      <button type="button" className="ks-embed-chip-btn" aria-label="Zoom in" title="Zoom in (Ctrl and +)" onClick={() => onStep(1)}>
        +
      </button>
      <button type="button" className="ks-embed-chip-btn is-text" aria-pressed={fitted} title="Fit the page to the box (Ctrl and 0)" onClick={onFit}>
        Fit
      </button>
      {onDone ? (
        <button type="button" className="ks-embed-chip-btn is-text" title="Give the keys back to the slide (Esc)" onClick={onDone}>
          Done
        </button>
      ) : null}
    </div>
  );
}

// The little control that goes with an embed being looked at: how far its page is zoomed, a step down and up, Fit, and (while a
// presentation hands the page the pointer) the way back. It is drawn in plain pixels beside the box, not scaled with the page.

import type { JSX, MouseEvent, PointerEvent } from "react";

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
  /** Plays the page here in the editor, or stops it (a web page or a video in the desktop app, which shows its picture until then). */
  onPlay?: (() => void) | undefined;
  /** The page is playing now, so the button stops it. */
  playing?: boolean | undefined;
  /** Previews the live page in the peek beside the slide (a web page in the editor). */
  onPreview?: (() => void) | undefined;
  /** Opens the address in the person's own browser (a web page in the editor). */
  onOpenOutside?: (() => void) | undefined;
  /** Where it sits: over the corner of a box in a presentation, or beside the selection in the editor. */
  className?: string;
}

const stop = (event: PointerEvent): void => event.stopPropagation();

/**
 * After a button of the chip in the editor was used, the keys go back to the slide, so that Delete, the arrows and Esc act on the
 * selection and not on the button. (In a presentation there is no slide editor around the chip, and nothing moves.)
 */
const handBack = (event: { currentTarget: HTMLElement }): void => event.currentTarget.closest<HTMLElement>(".ks-stage")?.focus({ preventScroll: true });

/** A click on a button: what it does, then the keys back to the slide. */
const then = (action: () => void) => (event: MouseEvent<HTMLElement>) => {
  action();
  handBack(event);
};

export function EmbedChip({ scale, fitted, onStep, onFit, onDone, onPlay, playing = false, onPreview, onOpenOutside, className = "" }: EmbedChipProps): JSX.Element {
  return (
    <div className={`ks-embed-chip${className ? ` ${className}` : ""}`} role="group" aria-label="Page zoom" onPointerDown={stop} onPointerUp={stop} onClick={(event) => event.stopPropagation()}>
      {onPlay ? (
        <button
          type="button"
          className="ks-embed-chip-btn"
          aria-label={playing ? "Stop playing" : "Play"}
          aria-pressed={playing}
          title={playing ? "Stop playing (Esc)" : "Play: use the page here. Esc stops it"}
          onClick={then(onPlay)}
        >
          <Icon name={playing ? "square" : "play"} size={14} />
        </button>
      ) : null}
      {onPreview ? (
        <button type="button" className="ks-embed-chip-btn" aria-label="Preview live" title="Preview live: show the page beside the slide" onClick={then(onPreview)}>
          <Icon name="globe" size={14} />
        </button>
      ) : null}
      {onOpenOutside ? (
        <button type="button" className="ks-embed-chip-btn" aria-label="Open externally" title="Not showing? Open externally" onClick={then(onOpenOutside)}>
          <Icon name="external-link" size={14} />
        </button>
      ) : null}
      <button type="button" className="ks-embed-chip-btn" aria-label="Zoom out" title="Zoom out (Ctrl and -)" onClick={then(() => onStep(-1))}>
        {"−"}
      </button>
      <output className="ks-embed-chip-value" aria-live="polite" data-fitted={fitted || undefined} title={fitted ? "The page fits the box" : "Zoom of the page"}>
        {percent(scale)}
      </output>
      <button type="button" className="ks-embed-chip-btn" aria-label="Zoom in" title="Zoom in (Ctrl and +)" onClick={then(() => onStep(1))}>
        +
      </button>
      <button type="button" className="ks-embed-chip-btn is-text" aria-pressed={fitted} title="Fit the page to the box (Ctrl and 0)" onClick={then(onFit)}>
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

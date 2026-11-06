// The tools that choose how to draw: the colours, undo of the last stroke, clear, and "Keep ink". In the show they appear over the toolbar
// while a pen is in hand; in the presenter's view the same strip sits above the slide, with the pen, the highlighter and the laser.

import { type JSX, useEffect, useSyncExternalStore } from "react";

import { INK_COLORS } from "./model.ts";
import type { InkStore } from "./store.ts";
import "./ink.css";

const NAMES = { red: "Red", blue: "Blue", green: "Green", yellow: "Yellow", white: "White", black: "Black" } as const;

/** Whether a key press goes to a field the person is typing in. */
const typing = (target: EventTarget | null): boolean => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** The keys of the ink in a window that has no reveal.js to bind them (the presenter's view): P, H, E and L. Returns whether the key was one. */
export function inkKey(store: InkStore, event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "target">, laser: boolean): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return false;
  switch (event.key.toLowerCase()) {
    case "p":
      store.toggleTool("pen");
      return true;
    case "h":
      store.toggleTool("highlighter");
      return true;
    case "e":
      store.clear();
      return true;
    case "l":
      if (!laser) return false;
      store.setLaser(!store.getSnapshot().laser);
      return true;
    default:
      return false;
  }
}

export interface InkToolsProps {
  store: InkStore;
  /** Also show the buttons that pick up the pen, the highlighter and the laser (the presenter's view; the show has its own toolbar). */
  pickers?: boolean;
  /** The strip shows even with no pen in hand. */
  always?: boolean;
}

export function InkTools({ store, pickers = false, always = false }: InkToolsProps): JSX.Element | null {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const hasInk = state.strokes.length > 0;
  if (!pickers && !always && state.tool === null) return null;
  return (
    <div className="ks-ink-tools" role="toolbar" aria-label="Ink">
      {pickers ? (
        <>
          <button type="button" className="ks-ink-button" aria-pressed={state.tool === "pen"} title="Pen (P)" onClick={() => store.toggleTool("pen")}>
            Pen
          </button>
          <button type="button" className="ks-ink-button" aria-pressed={state.tool === "highlighter"} title="Highlighter (H)" onClick={() => store.toggleTool("highlighter")}>
            Highlighter
          </button>
          <button type="button" className="ks-ink-button" aria-pressed={state.laser} title="Laser pointer on the audience's screen (L)" onClick={() => store.setLaser(!state.laser)}>
            Laser
          </button>
        </>
      ) : null}
      {INK_COLORS.map((color) => (
        <button key={color} type="button" className="ks-ink-swatch" data-color={color} aria-label={NAMES[color]} aria-pressed={state.color === color} onClick={() => store.setColor(color)} />
      ))}
      <button type="button" className="ks-ink-button" disabled={!hasInk} title="Undo the last stroke" onClick={() => store.undo()}>
        Undo
      </button>
      <button type="button" className="ks-ink-button" disabled={!hasInk && !state.live} title="Clear the ink on this slide (E)" onClick={() => store.clear()}>
        Clear
      </button>
      <button type="button" className="ks-ink-button" aria-pressed={state.keep} title="Keep each slide's ink for the rest of the show" onClick={() => store.setKeep(!state.keep)}>
        Keep ink
      </button>
    </div>
  );
}

/** Gives a window the keys of the ink. */
export function useInkKeys(store: InkStore, laser: boolean): void {
  useEffect(() => {
    const keys = (event: KeyboardEvent): void => {
      if (inkKey(store, event, laser)) event.preventDefault();
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [store, laser]);
}

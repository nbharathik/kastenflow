// A bar between two panels that is dragged, or moved with the arrow keys, to give one panel more room and the other less. The value is
// where the bar sits as a share (0 to 1) of the box it divides, measured from the box's top or left edge.

import { type JSX, type KeyboardEvent, type PointerEvent, type RefObject, useRef } from "react";

import { clamp, nudged } from "./layout.ts";

export interface SplitterProps {
  /** The way the bar runs: a vertical bar divides left from right, a horizontal one top from bottom. */
  orientation: "vertical" | "horizontal";
  value: number;
  min: number;
  max: number;
  /** The box the bar divides; the pointer's place in it is the new value. */
  container: RefObject<HTMLElement | null>;
  label: string;
  onChange(value: number): void;
  /** Double-click: back to the default. */
  onReset(): void;
}

const percent = (value: number): number => Math.round(value * 100);

export function Splitter({ orientation, value, min, max, container, label, onChange, onReset }: SplitterProps): JSX.Element {
  const dragging = useRef(false);
  const vertical = orientation === "vertical";

  const follow = (event: PointerEvent<HTMLDivElement>): void => {
    const box = container.current?.getBoundingClientRect();
    if (!box) return;
    const bar = event.currentTarget.getBoundingClientRect();
    const thick = vertical ? bar.width : bar.height;
    const length = (vertical ? box.width : box.height) - thick;
    if (length <= 0) return;
    const at = (vertical ? event.clientX - box.left : event.clientY - box.top) - thick / 2;
    onChange(clamp(at / length, min, max));
  };

  const keys = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const next = nudged(value, event.key, event.shiftKey, min, max, vertical ? "ArrowRight" : "ArrowDown", vertical ? "ArrowLeft" : "ArrowUp");
    if (next === null) return;
    // These keys are for the bar; the view's own keys (the arrows go to the next slide) must not also hear them.
    event.preventDefault();
    event.stopPropagation();
    if (next !== value) onChange(next);
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={percent(value)}
      aria-valuemin={percent(min)}
      aria-valuemax={percent(max)}
      className={`ks-pv-splitter is-${orientation}`}
      title="Drag to resize. Double-click to reset."
      onPointerDown={(event) => {
        if (event.button > 0) return;
        event.preventDefault();
        dragging.current = true;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // The bar still follows the pointer while it is over it.
        }
        event.currentTarget.classList.add("is-dragging");
      }}
      onPointerMove={(event) => {
        if (dragging.current) follow(event);
      }}
      onPointerUp={(event) => {
        dragging.current = false;
        event.currentTarget.classList.remove("is-dragging");
        try {
          event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
          // Nothing was captured.
        }
      }}
      onPointerCancel={(event) => {
        dragging.current = false;
        event.currentTarget.classList.remove("is-dragging");
      }}
      onDoubleClick={onReset}
      onKeyDown={keys}
    />
  );
}

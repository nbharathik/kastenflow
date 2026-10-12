import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from "react";

import { keyStep, scrubbed } from "../chrome/scrub.ts";

interface NumberFieldProps {
  /** The name for a screen reader (and for the box when it has no other). */
  label: string;
  /** A short word to draw in place of the label ("W" for "Width"): the handle to drag. */
  short?: string;
  /** "mixed" shows nothing and commits whatever is typed. */
  value: number | "mixed" | null;
  onCommit(value: number): void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  width?: number;
  decimals?: number;
  disabled?: boolean;
}

/** A drag that began on a number's label: where the pointer was, what the number was, and whether it has moved enough to be a drag. */
interface Drag {
  x: number;
  start: number;
  moved: boolean;
}

/**
 * A number in a box: Enter or leaving it commits, the arrow keys step (Shift steps ten times as far, Alt a tenth, the page keys ten
 * steps), and dragging its label sideways turns it like a dial, the number changing under the pointer and the deck once, when it is let go.
 */
export function NumberField({ label, short, value, onCommit, step = 1, min, max, unit, width = 64, decimals = 2, disabled }: NumberFieldProps) {
  const shown = typeof value === "number" ? String(Math.round(value * 10 ** decimals) / 10 ** decimals) : "";
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const drag = useRef<Drag | null>(null);
  /** The press that ended a drag is not a click on the label (which would put the caret in the box). */
  const dragged = useRef(false);

  const commit = (raw: string) => {
    const n = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(n)) return setText(shown);
    const clamped = Math.min(Math.max(n, min ?? -Infinity), max ?? Infinity);
    setText(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };

  const startValue = () => {
    const typed = Number(text);
    return Number.isFinite(typed) && text.trim() !== "" ? typed : typeof value === "number" ? value : 0;
  };

  const onLabelDown = (event: PointerEvent<HTMLSpanElement>) => {
    if (disabled || event.button !== 0) return;
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // The label's own events do as well.
    }
    drag.current = { x: event.clientX, start: startValue(), moved: false };
  };
  const onLabelMove = (event: PointerEvent<HTMLSpanElement>) => {
    const now = drag.current;
    if (!now || event.buttons !== 1) return;
    const dx = event.clientX - now.x;
    if (!now.moved && Math.abs(dx) < 3) return;
    now.moved = true;
    setText(String(scrubbed({ start: now.start, dx, step, shift: event.shiftKey, alt: event.altKey, ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }), decimals })));
  };
  const onLabelUp = (event: PointerEvent<HTMLSpanElement>) => {
    const now = drag.current;
    drag.current = null;
    if (!now?.moved) return;
    dragged.current = true;
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // It was let go already.
    }
    commit(text);
  };

  return (
    <label
      className="ks-field"
      onClick={(event) => {
        // A drag on the label is not a click: it must not give the box the focus.
        if (dragged.current) {
          dragged.current = false;
          event.preventDefault();
        }
      }}
    >
      <span
        className="ks-field-label ks-scrub"
        {...(short === undefined ? {} : { "aria-hidden": true })}
        title={disabled ? undefined : "Drag to change"}
        onPointerDown={onLabelDown}
        onPointerMove={onLabelMove}
        onPointerUp={onLabelUp}
        onPointerCancel={() => (drag.current = null)}
      >
        {short ?? label}
      </span>
      <input
        className="ks-input"
        style={{ width }}
        inputMode="decimal"
        value={text}
        placeholder={value === "mixed" ? "—" : undefined}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => setText(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            // The number may hand the focus to a text box as it is committed; the key must not go on to type there.
            event.preventDefault();
            commit(event.currentTarget.value);
          } else if (event.key === "Escape") setText(shown);
          else {
            const delta = keyStep(event.key, step, { shift: event.shiftKey, alt: event.altKey });
            if (delta === null) return;
            event.preventDefault();
            commit(String(Math.round((startValue() + delta) * 10 ** (decimals + 1)) / 10 ** (decimals + 1)));
          }
        }}
      />
      {unit ? <span className="ks-field-unit">{unit}</span> : null}
    </label>
  );
}

interface SegmentedProps<T extends string> {
  label: string;
  value: T | "mixed" | null;
  options: { value: T; label: ReactNode; title: string }[];
  onPick(value: T): void;
}

/** A row of choices, one of which is picked. */
export function Segmented<T extends string>({ label, value, options, onPick }: SegmentedProps<T>) {
  return (
    <div className="ks-segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          aria-label={option.title}
          data-tip={option.title}
          data-ks-keep-focus=""
          className={`ks-seg${value === option.value ? " is-on" : ""}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** An on-off switch with a label. */
export function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange(on: boolean): void }) {
  return (
    <label className="ks-toggle">
      <input type="checkbox" checked={on} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** A labelled group of controls in a side panel. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ks-section">
      <h3 className="ks-section-title">{title}</h3>
      {children}
    </section>
  );
}

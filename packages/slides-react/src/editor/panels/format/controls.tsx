// The small controls the panel's sections are made of. Each one shows a value
// that a selection may disagree about ("mixed") and commits what is entered
// once (on Enter or when it is left), so one edit is one step of undo.

import type { Theme } from "@kasten-slides/wasm";
import { type ComponentProps, type ReactNode, useEffect, useId, useRef, useState } from "react";

import { colorOf } from "../../../theme/index.ts";
import { ColorPicker } from "../../ui/ColorPicker.tsx";
import { NumberField } from "../../ui/Fields.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { Popover, usePopover } from "../../ui/Popover.tsx";
import "./format.css";
import type { Mixed } from "./values.ts";

/** A label on the left and its control on the right. */
export function Row({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`ks-sp-row${wide ? " is-wide" : ""}`}>
      <span className="ks-sp-label">{label}</span>
      <div className="ks-sp-control">{children}</div>
    </div>
  );
}

/** Controls side by side, for a name that covers them all. `end` is for a cluster at the right edge of the panel, whose tooltips open leftward. */
export function Cluster({ label, children, end }: { label: string; children: ReactNode; end?: boolean }) {
  return (
    <div className={`ks-sp-cluster${end ? " is-end" : ""}`} role="group" aria-label={label}>
      {children}
    </div>
  );
}

interface ColorButtonProps {
  theme: Theme;
  label: string;
  /** A theme token, `#rrggbb`, null for none, or "mixed". */
  value: string | null | Mixed;
  onPick(value: string | null): void;
  noneLabel?: string;
  /** What to call "none" on the button: "None", or "Theme default". */
  emptyName?: string;
  disabled?: boolean;
}

/** The colour shown on the button, in words a person can read. */
function nameOf(value: string | null | Mixed, empty: string): string {
  if (value === "mixed") return "Mixed";
  return value === null ? empty : value;
}

/** A swatch that opens the colour palette beside it. */
export function ColorButton({ theme, label, value, onPick, noneLabel = "None", emptyName = "None", disabled }: ColorButtonProps) {
  const menu = usePopover();
  // A press on the button while the palette is open closes it (the palette hears the press first); it must not open it again.
  const wasOpen = useRef(false);
  const colour = value !== null && value !== "mixed" ? colorOf(theme, value) : undefined;
  return (
    <>
      <button
        type="button"
        className="ks-btn ks-sp-color"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={menu.anchor !== null}
        disabled={disabled}
        onPointerDown={() => {
          wasOpen.current = menu.anchor !== null;
        }}
        onClick={(event) => {
          const closing = wasOpen.current && event.detail > 0;
          wasOpen.current = false;
          if (!closing) menu.openFrom(event.currentTarget);
        }}
      >
        <span className={`ks-sp-swatch${colour === undefined ? (value === "mixed" ? " is-mixed" : " is-none") : ""}`} style={colour ? { background: colour } : undefined} />
        <span className="ks-sp-color-name">{nameOf(value, emptyName)}</span>
        <Icon name="chevron-down" size={12} />
      </button>
      {menu.anchor ? (
        <Popover anchor={menu.anchor} onClose={menu.close} label={label}>
          <ColorPicker
            theme={theme}
            value={value === "mixed" ? null : value}
            noneLabel={noneLabel}
            onPick={(picked) => {
              menu.close();
              onPick(picked);
            }}
          />
        </Popover>
      ) : null}
    </>
  );
}

/** A number with a short word beside it, and a fuller name for assistive technology and tests ("Left" for "Text inset left"). */
export function ShortNumber({ short, ...rest }: { short: string } & ComponentProps<typeof NumberField>) {
  // The short word is the number's own label, so it is the handle to drag as well.
  return (
    <span className="ks-sp-short">
      <NumberField {...rest} short={short} />
    </span>
  );
}

interface SliderProps {
  label: string;
  /** 0 to 100, or "mixed". */
  value: number | Mixed;
  onCommit(value: number): void;
  disabled?: boolean;
}

/** A slider with its value in percent. The deck changes when it is let go of, not all the way along. */
export function Slider({ label, value, onCommit, disabled }: SliderProps) {
  const now = typeof value === "number" ? value : 100;
  const [draft, setDraft] = useState(now);
  useEffect(() => setDraft(now), [now]);
  const changed = useRef(false);
  const done = (at: number) => {
    if (!changed.current) return;
    changed.current = false;
    if (at !== value) onCommit(at);
  };
  return (
    <span className="ks-sp-slider">
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={draft}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={value === "mixed" ? "Mixed" : `${draft}%`}
        data-mixed={value === "mixed" ? "" : undefined}
        onChange={(event) => {
          changed.current = true;
          setDraft(Number(event.target.value));
        }}
        onPointerUp={(event) => done(Number(event.currentTarget.value))}
        onKeyUp={(event) => done(Number(event.currentTarget.value))}
        onBlur={(event) => done(Number(event.currentTarget.value))}
      />
      <output className="ks-sp-percent">{value === "mixed" ? "—" : `${draft}%`}</output>
    </span>
  );
}

interface SelectFieldProps<T extends string> {
  label: string;
  value: T | Mixed;
  options: readonly { value: T; label: string }[];
  onPick(value: T): void;
  disabled?: boolean;
}

/** A menu of choices in a box; "mixed" shows as its own entry that cannot be picked. */
export function SelectField<T extends string>({ label, value, options, onPick, disabled }: SelectFieldProps<T>) {
  return (
    <select className="ks-select ks-sp-select" aria-label={label} value={value} disabled={disabled} onChange={(event) => onPick(event.target.value as T)}>
      {value === "mixed" ? (
        <option value="mixed" disabled>
          Mixed
        </option>
      ) : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** An on-off switch that can also say "some are on": it shows a dash then, and a press turns all on. */
export function TriToggle({ label, on, onChange, disabled }: { label: string; on: boolean | Mixed; onChange(on: boolean): void; disabled?: boolean }) {
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (box.current) box.current.indeterminate = on === "mixed";
  }, [on]);
  return (
    <label className="ks-toggle ks-sp-toggle">
      <input ref={box} type="checkbox" checked={on === true} disabled={disabled} aria-checked={on === "mixed" ? "mixed" : on} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  mixed?: boolean;
  onCommit(value: string): void;
  placeholder?: string;
  multiline?: boolean;
  disabled?: boolean;
  invalid?: boolean;
}

/** A line or a few lines of text. Enter or leaving the box commits (in a few lines Enter is a new line, and Ctrl+Enter commits); Escape puts back what was there. */
export function TextField({ label, value, mixed, onCommit, placeholder, multiline, disabled, invalid }: TextFieldProps) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value, mixed]);
  const id = useId();
  const commit = () => {
    if (text !== value) onCommit(text);
  };
  const shared = {
    id,
    value: text,
    disabled,
    "aria-label": label,
    "aria-invalid": invalid || undefined,
    placeholder: mixed ? "Mixed" : placeholder,
    onChange: (event: { target: { value: string } }) => setText(event.target.value),
    onBlur: commit,
  };
  return multiline ? (
    <textarea
      className="ks-input ks-sp-area"
      rows={3}
      {...shared}
      onKeyDown={(event) => {
        if (event.key === "Escape") setText(value);
        else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) commit();
      }}
    />
  ) : (
    <input
      className="ks-input ks-sp-text"
      {...shared}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        else if (event.key === "Escape") setText(value);
      }}
    />
  );
}

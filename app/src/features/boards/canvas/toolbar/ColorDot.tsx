// One small dot for a colour, in the selection's bar and the pen's options: it
// shows the current colour and opens the swatches only when pressed. The keys
// 1 to 9 pick a colour without opening anything (0 for none).

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { colorForKey, colorName, cssColor } from "../colors";
import { ColorSwatches } from "./ColorSwatches";
import { closeOnEscape, focusBoard, moveAlong, useDismiss } from "./dismiss";

interface Props {
  /** The colour every chosen thing shares, or null for none. */
  value: string | null;
  /** The chosen things differ: the dot shows that, not a colour. */
  mixed?: boolean;
  onPick: (color: string | null) => void;
  label?: string;
  /** Which side of the dot the swatches open on. */
  placement?: "above" | "below";
}

export function ColorDot({ value, mixed = false, onPick, label = "Colour", placement = "above" }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, root, close);

  // Opened, the focus goes to the colour in use, so the arrows start there.
  useEffect(() => {
    if (!open) return;
    const swatches = root.current?.querySelectorAll<HTMLElement>(".kasten-board-swatch");
    (root.current?.querySelector<HTMLElement>("[aria-pressed='true']") ?? swatches?.[0])?.focus({ preventScroll: true });
  }, [open]);

  const choose = (color: string | null) => {
    onPick(color);
    setOpen(false);
    focusBoard(root.current);
  };
  const state = mixed ? "mixed" : value ? colorName(value) : "none";
  const leave = () => {
    setOpen(false);
    button.current?.focus({ preventScroll: true });
  };
  // In the panel the keys are its own: arrows go along the swatches, and 1 to 9 and 0 pick one.
  const keys = (event: ReactKeyboardEvent<HTMLElement>) => {
    const color = event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ? undefined : colorForKey(event.key);
    if (color === undefined) return moveAlong(event);
    event.preventDefault();
    event.stopPropagation();
    choose(color);
  };
  return (
    <span ref={root} className="relative inline-flex" onKeyDown={closeOnEscape(open, leave)}>
      <button ref={button} type="button" className="kasten-dot-button" aria-label={`${label}: ${state}`} aria-haspopup="dialog" aria-expanded={open} title={`${label} (1–9, 0 for none)`} onClick={() => setOpen((o) => !o)}>
        <span className={`kasten-dot${value ? "" : " is-none"}${mixed ? " is-mixed" : ""}`} style={!mixed && value ? { background: cssColor(value) } : undefined} />
      </button>
      {open && (
        <div className={`kasten-pop kasten-color-pop is-${placement}`} role="dialog" aria-label={label} onKeyDown={keys}>
          <ColorSwatches value={mixed ? null : value} onPick={choose} />
        </div>
      )}
    </span>
  );
}

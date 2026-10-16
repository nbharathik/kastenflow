import "../pages/editor/styles/tokens.css";

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";

import { Icon } from "../../ui/Icon";
import { IconOrEmoji } from "../../ui/IconOrEmoji";
import { useOccludesElement } from "../browser/occlusion";

export interface PickerOption {
  key: string;
  label: string;
  icon?: ReactNode;
  detail?: string;
  disabled?: boolean;
}

interface PickerProps {
  /** The dialog's name, e.g. "Add tag". */
  label: string;
  placeholder: string;
  /** Null while the options load. */
  options: readonly PickerOption[] | null;
  onPick(key: string): void;
  /** A last row that makes something new from the typed text. */
  create?: {
    /** The row's words for the text so far; null hides the row. */
    label(text: string): string | null;
    /** What the box asks for when the row is chosen with no text. */
    prompt?: string;
    run(text: string): void;
  };
  /** Shown when nothing matches. */
  empty?: string;
  /** Clicks inside this (the bar the picker belongs to) leave it open. */
  within: RefObject<HTMLElement | null>;
  onClose(): void;
}

/** Puts the focus back where it was (the button that opened a popup) when
 * the popup goes, unless the focus has already moved somewhere else. */
export function useReturnFocus(): void {
  // Read while rendering: the popup's autoFocus moves the focus before any effect runs.
  const [before] = useState(() => document.activeElement);
  useEffect(
    () => () => {
      const now = document.activeElement;
      if (before instanceof HTMLElement && before.isConnected && (!now || now === document.body)) before.focus();
    },
    [before],
  );
}

/** A small list above the bulk bar, filtered as you type; ↑ ↓ and Enter pick. */
export function Picker({ label, placeholder, options, onPick, create, empty = "Nothing matches", within, onClose }: PickerProps) {
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const [asking, setAsking] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  useReturnFocus();
  // A browser tab's page beside the list steps aside while it is open.
  useOccludesElement(box);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if (!within.current?.contains(event.target as Node)) close.current();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [within]);

  const q = text.trim().toLowerCase();
  const shown = (options ?? []).filter((o) => !q || o.label.toLowerCase().includes(q) || o.detail?.toLowerCase().includes(q));
  const createLabel = create?.label(text.trim()) ?? null;
  const count = shown.length + (createLabel ? 1 : 0);
  const current = Math.min(active, Math.max(0, count - 1));

  function choose(index: number) {
    const option = shown[index];
    if (option) {
      if (!option.disabled) onPick(option.key);
      return;
    }
    if (!create || !createLabel) return;
    if (text.trim()) create.run(text.trim());
    else {
      setAsking(true);
      input.current?.focus();
    }
  }

  return (
    <div
      ref={box}
      role="dialog"
      aria-label={label}
      className="absolute bottom-full left-0 z-40 mb-2 flex w-72 flex-col overflow-hidden rounded-xl bg-(--notion-menu-bg) text-13 text-ink shadow-(--notion-shadow) starting:translate-y-1 starting:opacity-0 transition"
    >
      <div className="flex items-center gap-2 border-b border-line px-3">
        <Icon name="search" className="size-4 text-muted" />
        <input
          ref={input}
          autoFocus
          value={text}
          aria-label={label}
          aria-controls={`${id}-list`}
          aria-activedescendant={count > 0 ? `${id}-${current}` : undefined}
          placeholder={asking && create?.prompt ? create.prompt : placeholder}
          onChange={(event) => {
            setText(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
            else if (event.key === "ArrowDown") setActive(Math.min(current + 1, count - 1));
            else if (event.key === "ArrowUp") setActive(Math.max(current - 1, 0));
            else if (event.key === "Enter") choose(current);
            else return;
            // Esc closes the picker only, not the selection behind it.
            event.preventDefault();
            event.stopPropagation();
          }}
          className="h-10 min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted"
        />
      </div>
      <div id={`${id}-list`} role="listbox" aria-label={label} className="max-h-64 overflow-y-auto p-1">
        {options === null && <p className="px-2.5 py-2 text-muted">Loading…</p>}
        {options !== null && shown.length === 0 && (options.length === 0 || !createLabel) && <p className="px-2.5 py-2 text-muted">{empty}</p>}
        {shown.map((option, i) => (
          <Row key={option.key} id={`${id}-${i}`} active={i === current} disabled={option.disabled} onHover={() => setActive(i)} onClick={() => choose(i)}>
            <span className="grid w-5 place-items-center text-16" aria-hidden="true">
              {typeof option.icon === "string" ? <IconOrEmoji icon={option.icon} /> : option.icon}
            </span>
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {option.detail && <span className="shrink-0 text-12 text-muted">{option.detail}</span>}
          </Row>
        ))}
        {createLabel && (
          <Row id={`${id}-${shown.length}`} active={current === shown.length} onHover={() => setActive(shown.length)} onClick={() => choose(shown.length)}>
            <span className="grid w-5 place-items-center text-muted" aria-hidden="true">
              <Icon name="plus" className="size-4" />
            </span>
            <span className="min-w-0 flex-1 truncate">{createLabel}</span>
          </Row>
        )}
      </div>
    </div>
  );
}

function Row({ id, active, disabled, onHover, onClick, children }: { id: string; active: boolean; disabled?: boolean; onHover(): void; onClick(): void; children: ReactNode }) {
  return (
    <button
      id={id}
      type="button"
      role="option"
      aria-selected={active}
      aria-disabled={disabled || undefined}
      tabIndex={-1}
      onMouseMove={onHover}
      onClick={onClick}
      className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left ${active ? "bg-(--notion-hover)" : ""} ${disabled ? "cursor-default opacity-45" : ""}`}
    >
      {children}
    </button>
  );
}

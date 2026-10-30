// Text, number and link cells: the value as a line of text (a link opens
// in the browser), edited in place. Enter or leaving the cell saves, Escape
// puts the value back, Tab saves and moves on.

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { openUrl } from "../../../../../lib/api";
import { Icon } from "../../../../../ui/Icon";
import { asText, openableUrl } from "../../../../panel/properties/values";
import { useWorkspace } from "../../../../workspace/store";
import { useLatest, type Move } from "../context";
import { numberFrom, urlLabel } from "../format";
import type { TypeCellProps } from "./types";

export function TextCell({ value, def, editing, seed, label, save, finish }: TypeCellProps) {
  const text = asText(value);
  const numeric = def.type === "number";
  if (editing) {
    return (
      <CellInput
        initial={text}
        seed={seed}
        label={label}
        numeric={numeric}
        onCommit={(draft) => save(numeric ? numberFrom(draft) : draft.trim() || null)}
        finish={finish}
      />
    );
  }
  if (!text) return null;
  if (def.type === "url" && openableUrl(text)) {
    const open = () => openUrl(text.trim()).catch((err: unknown) => useWorkspace.getState().toast(err instanceof Error ? err.message : String(err)));
    return (
      <>
        <a
          className="kasten-table-link"
          href={text.trim()}
          target="_blank"
          rel="noopener noreferrer"
          tabIndex={-1}
          title={`${text} (Ctrl+click opens it)`}
          // A plain click only picks the cell (and a double-click edits it).
          // Ctrl or Cmd+click opens the address itself, here rather than
          // through the app's handler for links, which never sees it.
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault();
            if (!e.ctrlKey && !e.metaKey) return;
            e.stopPropagation();
            void open();
          }}
        >
          {urlLabel(text)}
        </a>
        <button
          type="button"
          tabIndex={-1}
          className="kasten-table-open-link"
          aria-label={`Open link of ${label.replace(/^.*? of /, "")}`}
          title="Open the address"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            void open();
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <Icon name="external" className="size-3" />
        </button>
      </>
    );
  }
  return (
    <span className={`kasten-table-text${numeric ? " is-number" : ""}`} title={numeric ? undefined : text}>
      {text}
    </span>
  );
}

interface CellInputProps {
  /** The text when editing began. */
  initial: string;
  seed: string | null;
  label: string;
  numeric?: boolean;
  onCommit(draft: string): void;
  finish(move?: Move, refocus?: boolean): void;
}

/** A one-line editor filling the cell, its caret at the end. */
export function CellInput({ initial, seed, label, numeric = false, onCommit, finish }: CellInputProps) {
  const [draft, setDraft] = useState(seed ?? initial);
  const input = useRef<HTMLInputElement>(null);
  const closed = useRef(false);
  const latest = useLatest({ draft, initial, onCommit });

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // Typing still in the field when its row scrolls out of view is kept.
  useEffect(
    () => () => {
      if (closed.current) return;
      const { draft, initial, onCommit } = latest.current;
      if (draft !== initial) onCommit(draft);
    },
    [latest],
  );

  const close = (commit: boolean, move: Move, refocus: boolean) => {
    if (closed.current) return;
    closed.current = true;
    if (commit && draft !== initial) onCommit(draft);
    finish(move, refocus);
  };

  return (
    <input
      ref={input}
      className={`kasten-table-input${numeric ? " is-number" : ""}`}
      aria-label={label}
      value={draft}
      inputMode={numeric ? "decimal" : undefined}
      spellCheck={!numeric}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => close(true, null, false)}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") {
          e.preventDefault();
          close(true, null, true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          close(false, null, true);
        } else if (e.key === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          close(true, e.shiftKey ? "prev" : "next", true);
        }
      }}
    />
  );
}

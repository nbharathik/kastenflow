// What a selection in the reader offers: a highlight in one of five
// colours (or the keys 1 to 5), and a comment with it. The colour used last
// is remembered for the comment's highlight.

import { useEffect, useState } from "react";

import { freeKey } from "../../../lib/keys";
import type { HighlightColor } from "../../../lib/vault/types";
import { COLOR_NAMES, HIGHLIGHT_COLORS } from "../colors";

const KEY = "kasten.highlight.color";

export function lastColor(): HighlightColor {
  try {
    const saved = localStorage.getItem(KEY);
    return (HIGHLIGHT_COLORS as readonly string[]).includes(saved ?? "") ? (saved as HighlightColor) : "yellow";
  } catch {
    return "yellow";
  }
}

export function keepColor(color: HighlightColor): void {
  try {
    localStorage.setItem(KEY, color);
  } catch {
    // Yellow it is, next time.
  }
}

interface Props {
  /** Where it sits, in the pages' scroll area. */
  at: { left: number; top: number };
  onPick(color: HighlightColor, comment: string | null): void;
  onClose(): void;
}

export function SelectionBar({ at, onPick, onClose }: Props) {
  const [comment, setComment] = useState<string | null>(null);
  const pick = (color: HighlightColor, note: string | null = null) => {
    keepColor(color);
    onPick(color, note?.trim() || null);
  };

  useEffect(() => {
    if (comment !== null) return;
    const onKey = (event: KeyboardEvent) => {
      // Keys typed in a field, here or in another pane, are not colours.
      if (!freeKey(event)) return;
      if (event.key === "Escape") return onClose();
      const n = Number(event.key);
      if (Number.isInteger(n) && n >= 1 && n <= HIGHLIGHT_COLORS.length && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        pick(HIGHLIGHT_COLORS[n - 1]!);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="kasten-sel-bar" style={{ left: at.left, top: at.top }} role="toolbar" aria-label="Highlight the selection" onPointerUp={(e) => e.stopPropagation()} onPointerDown={(e) => e.preventDefault()}>
      <div className="kasten-sel-row">
        {HIGHLIGHT_COLORS.map((color, i) => (
          <button key={color} type="button" className={`kasten-hl-swatch is-${color}`} aria-label={`Highlight ${COLOR_NAMES[color].toLowerCase()}`} title={`${COLOR_NAMES[color]} (${i + 1})`} onClick={() => pick(color)} />
        ))}
        <span className="kasten-sel-sep" />
        <button type="button" className="kasten-sel-comment" aria-expanded={comment !== null} onClick={() => setComment((c) => (c === null ? "" : null))}>
          Comment
        </button>
      </div>
      {comment !== null && (
        <form
          className="kasten-sel-note"
          onSubmit={(e) => {
            e.preventDefault();
            pick(lastColor(), comment);
          }}
        >
          <textarea
            autoFocus
            rows={3}
            value={comment}
            placeholder="Why this passage matters…"
            aria-label="Comment"
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) pick(lastColor(), comment);
            }}
          />
          <button type="submit" className="kasten-sel-save">
            Highlight with comment
          </button>
        </form>
      )}
    </div>
  );
}

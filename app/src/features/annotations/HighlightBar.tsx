// What selecting words on a page kept from the web offers: a bar by the words
// with the five highlight colours (or the keys 1 to 5 out of the text), and a
// comment to go with it. The highlight is kept beside the page, never in its
// text.

import "../sources/colors.css";
import "../sources/reader/reader-marks.css";
import "./annotations.css";

import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

import { SelectionBar } from "../sources/reader/SelectionBar";
import { useSelectedWords, type SelectionEditor } from "./use-selected-words";
import { MOST_HIGHLIGHT, type HighlightsModel } from "./use-text-highlights";

interface Props {
  model: HighlightsModel;
  editor: RefObject<SelectionEditor | null>;
  ready: number;
  /** The page's text column: a selection outside it gets no bar. */
  root: RefObject<HTMLElement | null>;
}

export function HighlightBar({ model, editor, ready, root }: Props) {
  const words = useSelectedWords(editor, ready, MOST_HIGHLIGHT);
  const key = words ? `${words.from}:${words.quote}` : null;
  /** The words the bar was put away for: it stays away until the selection changes. */
  const [putAway, setPutAway] = useState<string | null>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  // Placed by the selection when it is made. Focus moving into the bar's field
  // does not move it, because the field's own selection is not the page's.
  useEffect(() => {
    if (!key) return setAt(null);
    const selection = window.getSelection();
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const column = root.current;
    if (range && column?.contains(range.commonAncestorContainer)) {
      const rect = range.getBoundingClientRect();
      return setAt({ left: rect.left + rect.width / 2, top: Math.max(8, rect.top - 48) });
    }
    // The page's own selection with no DOM selection to measure: above the text column.
    const box = column?.getBoundingClientRect();
    setAt((was) => was ?? { left: (box?.left ?? 0) + (box?.width ?? 0) / 2, top: Math.max(8, (box?.top ?? 0) + 8) });
  }, [key, root]);

  if (!words || !key || putAway === key || !at) return null;
  return createPortal(
    <div className="kasten-text-hl-host" style={{ left: at.left, top: at.top }}>
      <SelectionBar
        at={{ left: 0, top: 0 }}
        onPick={(color, comment) => {
          setPutAway(key);
          void model.add(words, color, comment);
        }}
        onClose={() => setPutAway(key)}
      />
    </div>,
    document.body,
  );
}

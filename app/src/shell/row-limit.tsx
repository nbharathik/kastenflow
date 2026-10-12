// A sidebar list that shows only its first rows and a "Show N more" for the
// rest. How far a list was opened is kept for the session, by the list's
// key, so collapsing a project and opening it again leaves it as it was.

import { useState } from "react";

import { FIRST_ROWS, MORE_ROWS } from "../features/workspace/sidebar-rows";

const opened = new Map<string, number>();

/** The rows a list shows now and a way to show more. Not kept past the session. */
export function useRowLimit(key: string): [limit: number, more: () => void] {
  const [, redraw] = useState(0);
  return [
    opened.get(key) ?? FIRST_ROWS,
    () => {
      opened.set(key, (opened.get(key) ?? FIRST_ROWS) + MORE_ROWS);
      redraw((n) => n + 1);
    },
  ];
}

/** Forgets how far lists were opened (tests). */
export const forgetRowLimits = () => opened.clear();

/** The button that shows the next rows of a list. */
export function ShowMoreRow({ shown, total, depth, onMore }: { shown: number; total: number; depth: number; onMore: () => void }) {
  return (
    <li>
      <button
        type="button"
        className="flex h-[26px] w-full items-center rounded-lg text-left text-13 text-muted hover:bg-hover hover:text-ink"
        style={{ paddingLeft: `${30 + depth * 14}px` }}
        onClick={onMore}
      >
        Show {Math.min(MORE_ROWS, total - shown).toLocaleString()} more of {total.toLocaleString()}
      </button>
    </li>
  );
}

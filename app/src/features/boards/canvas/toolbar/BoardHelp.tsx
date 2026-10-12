// The board's keys and gestures in one list, from ?, the More menu or the
// board's menu. Escape closes it, here or on the board (useBoardKeys).

import { useEffect, useRef } from "react";

import { IconButton } from "../../../../ui/Button";

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: "Move around",
    rows: [
      ["Scroll", "Pan"],
      ["Ctrl+scroll or pinch", "Zoom"],
      ["Right-drag, middle-drag or Space+drag", "Pan"],
      ["← ↑ → ↓ (nothing selected)", "Move the view; Shift for more"],
      ["F or Shift+1", "Fit everything in view"],
      ["+ and −, Shift+0", "Zoom in and out, back to 100%"],
      ["M", "Minimap"],
      ["\\", "Focus mode: hide the bars; they come back at an edge or on a key"],
      ["P", "Present: each section a slide, from the selected one"],
      ["→ or Space, ←", "Next and previous slide; Esc ends"],
    ],
  },
  {
    title: "Tools",
    rows: [
      ["V", "Select and move"],
      ["H", "Hand: drag to pan"],
      ["D", "Pen; pick a width and colour beside the bar"],
      ["X", "Erase drawings: drag across them"],
      ["R, O", "Rectangle, ellipse: click or drag out; more beside the bar"],
      ["L", "Connector: drag from a side's dot to another thing"],
      ["Esc", "Back to selecting"],
    ],
  },
  {
    title: "Make",
    rows: [
      ["Double-click", "A new card or sticky, as chosen in the + menu"],
      ["C", "New card"],
      ["S", "New sticky"],
      ["G", "Wrap the selection in a section"],
      ["Tab, Shift+Enter", "Grow a mind map from the selected card"],
      ["Right-click", "Everything else"],
    ],
  },
  {
    title: "Change",
    rows: [
      ["1 to 9, 0", "Colour the selection; none"],
      ["Enter", "Open a card, or edit a sticky, shape or section"],
      ["E", "Show the whole card"],
      ["← ↑ → ↓", "Nudge the selection; Shift for 10 px"],
      ["Delete", "Take off the board (the note stays)"],
      ["Ctrl+Z, Ctrl+Shift+Z", "Undo, redo"],
      ["Ctrl+A, Shift+drag", "Select all, add to the selection"],
      ["Ctrl+C, Ctrl+X, Ctrl+V", "Copy, cut and paste, onto this board or another"],
      ["Ctrl+D", "Duplicate the selection"],
      ["Ctrl+F", "Find a card, sticky or section on the board"],
    ],
  },
];

export function BoardHelp({ onClose }: { onClose(): void }) {
  const root = useRef<HTMLDivElement>(null);
  // Focus comes here on opening, so a screen reader reads the list.
  useEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div ref={root} tabIndex={-1} className="kasten-board-help kasten-board-layer" role="dialog" aria-label="Board keys" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <header>
        <h2>Board keys</h2>
        <IconButton icon="close" label="Close the board keys" size="sm" onClick={onClose} />
      </header>
      {GROUPS.map((group) => (
        <section key={group.title} aria-label={group.title}>
          <h3>{group.title}</h3>
          <dl>
            {group.rows.map(([keys, what]) => (
              <div key={keys}>
                <dt>{keys}</dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

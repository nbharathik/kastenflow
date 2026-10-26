// The outline: the headings of the open file (\part to \subparagraph), indented
// by level. A click, or Enter, puts the caret on the heading. With no heading
// it says so and offers to add a section.

import { forwardRef, useEffect, useState } from "react";

import { Button } from "../../ui/Button";
import type { AssistIndex } from "./completion/data";
import type { OutlineItem } from "./completion/scan";
import { arrowFocus } from "./list-keys";

interface Props {
  index: AssistIndex;
  /** The open file (full path). */
  path: string | null;
  onJump(line: number): void;
  onAdd(): void;
}

export const Outline = forwardRef<HTMLElement, Props>(function Outline({ index, path, onJump, onAdd }, ref) {
  const [items, setItems] = useState<OutlineItem[]>(() => (path ? index.outline(path) : []));
  useEffect(() => {
    const read = () => setItems(path ? index.outline(path) : []);
    read();
    return index.subscribe(read);
  }, [index, path]);

  const base = items.reduce((lowest, item) => Math.min(lowest, item.level), 6);
  return (
    <section ref={ref} className="latex-outline" aria-label="Outline of this file">
      <h3 className="latex-side-title">Outline</h3>
      {items.length === 0 ? (
        <div className="latex-side-empty">
          <p className="m-0">No headings in this file yet.</p>
          <Button size="sm" onClick={onAdd}>
            Add a section
          </Button>
        </div>
      ) : (
        <ul className="latex-outline-list" onKeyDown={arrowFocus}>
          {items.map((item) => (
            <li key={`${item.line}-${item.command}`}>
              <button type="button" className="latex-outline-item" style={{ paddingLeft: 8 + (item.level - base) * 12 }} title={`${item.title} (line ${item.line})`} onClick={() => onJump(item.line)}>
                <span className={`min-w-0 flex-1 truncate ${item.level <= 2 ? "is-major" : ""}`}>{item.title}</span>
                <span className="latex-line-no">{item.line}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
});

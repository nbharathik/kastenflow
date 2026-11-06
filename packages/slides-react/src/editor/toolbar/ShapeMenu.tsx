import { type JSX, type KeyboardEvent, useEffect, useRef, useState } from "react";

import { keysOf } from "../commands/index.ts";
import { swallowKeys, useFocusWhenShown } from "../menus/focus.ts";
import { shapeCommand } from "../menus/items-insert.tsx";
import { useDropdown } from "../menus/useDropdown.ts";
import { ShapePreview } from "../menus/previews.tsx";
import type { EditorSession } from "../session/session.ts";
import { findShapes } from "../shapes.ts";
import { Popover } from "../ui/Popover.tsx";
import { ToolButton } from "./ToolButton.tsx";

const COLUMNS = 7;
const ARROWS = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"];

/** The cell nearest above or below `from`, by where it is on screen. */
function neighbour(cells: HTMLElement[], from: HTMLElement, direction: 1 | -1): HTMLElement | undefined {
  const here = from.getBoundingClientRect();
  const rows = cells.filter((cell) => (direction > 0 ? cell.getBoundingClientRect().top > here.top + 1 : cell.getBoundingClientRect().top < here.top - 1));
  if (rows.length === 0) return undefined;
  const nearest = direction > 0 ? Math.min(...rows.map((c) => c.getBoundingClientRect().top)) : Math.max(...rows.map((c) => c.getBoundingClientRect().top));
  const row = rows.filter((cell) => cell.getBoundingClientRect().top === nearest);
  return row.reduce((best, cell) => (Math.abs(cell.getBoundingClientRect().left - here.left) < Math.abs(best.getBoundingClientRect().left - here.left) ? cell : best));
}

/** A shape's name for its tooltip, with the key that adds it at once where it has one. */
const tipOf = (label: string, keys: string | undefined): string => (keys ? `${label} (${keys})` : label);

/** The shape button: a scrollable grid of outlines, grouped by title. Picking one arms the shape tool. */
export function ShapeMenu({ session, tool }: { session: EditorSession; tool: string }): JSX.Element {
  const dd = useDropdown("dialog");
  const grid = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const groups = findShapes(search);
  // A search is for one opening of the menu.
  useEffect(() => {
    if (!dd.anchor) setSearch("");
  }, [dd.anchor]);

  // Opened with the keyboard, the first shape is ready for the arrow keys.
  useFocusWhenShown(grid, dd.anchor && dd.keyboard ? ".ks-shape-cell" : null, dd.anchor);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    swallowKeys(event);
    if (!ARROWS.includes(event.key)) return;
    const field = event.currentTarget.querySelector<HTMLInputElement>(".ks-shape-search");
    const cells = [...event.currentTarget.querySelectorAll<HTMLElement>(".ks-shape-cell")];
    // From the search box, Down goes to the first shape; the arrows otherwise move the caret.
    if (document.activeElement === field) {
      if (event.key !== "ArrowDown" || !cells[0]) return;
      event.preventDefault();
      event.stopPropagation();
      cells[0].focus();
      return;
    }
    const at = cells.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    event.preventDefault();
    event.stopPropagation();
    const next = event.key === "ArrowRight" ? cells[at + 1] : event.key === "ArrowLeft" ? cells[at - 1] : neighbour(cells, cells[at]!, event.key === "ArrowDown" ? 1 : -1);
    // Up from the first row goes on to the search box.
    (next ?? (event.key === "ArrowUp" ? field : null))?.focus();
  };

  return (
    <>
      <ToolButton icon="shapes" label="Shape" menu on={tool.startsWith("shape:")} {...dd.trigger} />
      {dd.anchor ? (
        <Popover anchor={dd.anchor} onClose={dd.close} label="Shapes">
          <div ref={grid} className="ks-shape-menu" onKeyDown={onKeyDown}>
            <input className="ks-input ks-shape-search" type="search" aria-label="Search shapes" placeholder="Search shapes" value={search} onChange={(event) => setSearch(event.target.value)} />
            <div className="ks-shape-scroll" data-ks-keep-focus="" onMouseDown={(event) => event.preventDefault()}>
              {groups.length === 0 ? <p className="ks-shape-none">No shape has that name.</p> : null}
              {groups.map((group) => (
                <section key={group.title} className="ks-shape-group">
                  <h4 className="ks-shape-title">{group.title}</h4>
                  <div className="ks-shape-grid" style={{ gridTemplateColumns: `repeat(${COLUMNS}, 30px)` }} role="group" aria-label={group.title}>
                    {group.shapes.map((shape) => (
                      <button
                        key={shape.preset}
                        type="button"
                        className={`ks-shape-cell${tool === `shape:${shape.preset}` ? " is-on" : ""}`}
                        aria-label={shape.label}
                        data-tip={tipOf(shape.label, keysOf(shapeCommand(shape.preset)))}
                        onClick={() => {
                          dd.close();
                          session.setTool(`shape:${shape.preset}`);
                        }}
                      >
                        <ShapePreview preset={shape.preset} />
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </Popover>
      ) : null}
    </>
  );
}

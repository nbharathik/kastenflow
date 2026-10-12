import "./present.css";

import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type RefObject } from "react";

import type { PageEditorHandle } from "../editor/page-handle";
import type { SectionInfo } from "../editor/sections/api";

/** The drag's own type, so a section dragged in from elsewhere is not taken for one of the page's. */
const DRAGGED = "application/x-kasten-section";

/**
 * The page's sections as a filmstrip down its left side: click one to go to
 * it, drag one onto another (or Alt+Up and Alt+Down on it) to put it there.
 * Moving a section moves its Markdown between the `---` lines, as one step
 * of the page's history.
 */
export function SectionStrip({ editor, body, ready }: { editor: RefObject<PageEditorHandle | null>; body: string; ready: number }) {
  const [sections, setSections] = useState<SectionInfo[]>([]);
  // Counts the moves made here, so the list is read again at once rather than with the next save.
  const [moves, setMoves] = useState(0);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const list = useRef<HTMLOListElement>(null);
  // The section to give the focus back to once the list has been drawn again after a move.
  const refocus = useRef<number | null>(null);

  useEffect(() => {
    setSections(editor.current?.sections() ?? []);
  }, [editor, body, ready, moves]);

  useEffect(() => {
    const at = refocus.current;
    if (at === null) return;
    refocus.current = null;
    list.current?.querySelector<HTMLElement>(`[data-section="${at}"]`)?.focus();
  }, [sections]);

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= sections.length || !editor.current?.moveSection(from, to)) return;
    refocus.current = to;
    setMoves((n) => n + 1);
  };

  const onKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const by = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (by === 0) return;
    event.preventDefault();
    if (event.altKey) move(index, index + by);
    else list.current?.querySelector<HTMLElement>(`[data-section="${index + by}"]`)?.focus();
  };

  const onDragOver = (event: DragEvent<HTMLElement>, index: number) => {
    if (dragging === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setOver(index);
  };

  const onDrop = (event: DragEvent<HTMLElement>, index: number) => {
    event.preventDefault();
    // What is dropped is one of this page's sections, or nothing it knows.
    const given = event.dataTransfer.getData(DRAGGED);
    const from = dragging ?? (given === "" ? Number.NaN : Number(given));
    setDragging(null);
    setOver(null);
    if (Number.isInteger(from)) move(from, index);
  };

  return (
    <nav className="kasten-sec-strip" aria-label="Sections of this page">
      <ol ref={list}>
        {sections.map((section, index) => (
          <li key={`${index}:${section.divider ?? "first"}`} className={`${dragging === index ? "is-dragged" : ""}${over === index && dragging !== null && dragging !== index ? ` is-over is-${dragging < index ? "after" : "before"}` : ""}`}>
            <button
              type="button"
              draggable
              data-section={index}
              className="kasten-sec-strip-item"
              title="Click to go to this section. Drag it, or press Alt+Up or Alt+Down, to move it."
              onClick={() => editor.current?.showSection(index)}
              onKeyDown={(event) => onKey(event, index)}
              onDragStart={(event) => {
                event.dataTransfer.setData(DRAGGED, String(index));
                event.dataTransfer.effectAllowed = "move";
                setDragging(index);
              }}
              onDragOver={(event) => onDragOver(event, index)}
              onDragLeave={() => setOver((was) => (was === index ? null : was))}
              onDrop={(event) => onDrop(event, index)}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
            >
              <span className="kasten-sec-strip-number">{index + 1}</span>
              <span className="kasten-sec-strip-title">{section.title}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

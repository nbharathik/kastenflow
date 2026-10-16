// A tag database's body as a place pages can be dropped: a page dragged from
// the sidebar, the Library, search or the Inbox joins the tag (it gains it; it
// is not moved), and the label "Add tag #x" shows before it is let go. Every
// drag has a button beside it: "Add existing pages".

import "./tag-drop.css";

import { useRef, useState, type DragEvent, type ReactNode } from "react";

import { carriesNotes, droppedNotes } from "../workspace/drag";

/** `className` is kept on the element, so a style that names it still finds it. */
export function TagDropZone({ tag, onDrop, className = "", children }: { tag: string; onDrop(paths: string[]): void; className?: string; children: ReactNode }) {
  const [over, setOver] = useState(false);
  // Enter and leave fire for every child the drag crosses: count them.
  const depth = useRef(0);
  const accepts = (event: DragEvent) => carriesNotes(event);
  return (
    <div
      className={`kasten-tag-drop ${className}`.trim()}
      data-over={over || undefined}
      onDragEnter={(event) => {
        if (!accepts(event)) return;
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(event) => {
        if (!accepts(event)) return;
        // Adding a tag copies nothing and moves nothing: the cursor says "copy".
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (!accepts(event)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(event) => {
        if (!accepts(event)) return;
        event.preventDefault();
        depth.current = 0;
        setOver(false);
        const paths = droppedNotes(event);
        if (paths.length > 0) onDrop(paths);
      }}
    >
      {over && (
        <div className="kasten-tag-drop-label" role="status">
          Add tag #{tag}
        </div>
      )}
      {children}
    </div>
  );
}

import { type JSX, type KeyboardEvent, type PointerEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { EditorSession } from "../session/session.ts";
import type { EditorUi } from "../ui-state.ts";
import { undoKey } from "../filmstrip/keys.ts";
import { useUiValue } from "../chrome/useUiValue.ts";
import { Icon } from "../ui/Icon.tsx";
import { useEditorValue } from "../useEditor.ts";
import { MAX_HEIGHT, MIN_HEIGHT, clampHeight, readHeight, saveHeight } from "./height.ts";
import "./notes.css";

/** How long after the last key the words are written to the slide. */
export const WRITE_DELAY = 600;

/**
 * The speaker notes under the slide, with a strip above them that folds them away (and a bar to bring them back): the slide gets the
 * room while the notes are not wanted, and the person need not go to a menu to change that.
 */
export function NotesPane({ session, ui }: { session: EditorSession; ui: EditorUi }): JSX.Element {
  const open = useUiValue(ui, (state) => state.notesOpen);
  const slideId = useEditorValue(session, (state) => state.slideId);
  const [height, setHeight] = useState(readHeight);
  const [resizing, setResizing] = useState(false);
  const latest = useRef(height);
  latest.current = height;
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const change = (next: number) => {
    setHeight(clampHeight(next));
    saveHeight(next);
  };

  // Drag the top edge: up makes the pane taller.
  const grab = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const from = { y: event.clientY, height: latest.current };
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // The window's own events do as well.
    }
    const move = (pointer: globalThis.PointerEvent) => setHeight(clampHeight(from.height + from.y - pointer.clientY));
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      stop.current = null;
      setResizing(false);
      saveHeight(latest.current);
    };
    stop.current = end;
    setResizing(true);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const onGripKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 16;
    const next = event.key === "ArrowUp" ? latest.current + step : event.key === "ArrowDown" ? latest.current - step : event.key === "Home" ? MIN_HEIGHT : event.key === "End" ? MAX_HEIGHT : null;
    if (next === null) return;
    event.preventDefault();
    change(next);
  };

  if (!open) {
    return (
      <button type="button" className="ks-btn ks-notes-bar" aria-label="Show speaker notes" data-tip="Show speaker notes" onClick={() => ui.toggleNotes()}>
        <Icon name="chevron-up" size={14} />
        <span>Speaker notes</span>
      </button>
    );
  }

  return (
    <section className="ks-notes" aria-label="Speaker notes" style={{ height }}>
      <button type="button" className="ks-btn ks-notes-head" aria-label="Hide speaker notes" data-tip="Hide speaker notes" onClick={() => ui.toggleNotes()}>
        <Icon name="chevron-down" size={14} />
        <span>Speaker notes</span>
      </button>
      <div
        className={`ks-notes-grip${resizing ? " is-active" : ""}`}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize speaker notes"
        aria-valuemin={MIN_HEIGHT}
        aria-valuemax={MAX_HEIGHT}
        aria-valuenow={height}
        tabIndex={0}
        onPointerDown={grab}
        onKeyDown={onGripKey}
      />
      {/* One editor for each slide, so the words of one slide are never shown, or written, for another. */}
      <NotesEditor key={slideId} session={session} slideId={slideId} />
    </section>
  );
}

/**
 * The notes of one slide. What is typed stays here until it is written to the
 * slide: a moment after the last key, when the focus leaves, and when this
 * editor goes away because another slide is shown.
 */
function NotesEditor({ session, slideId }: { session: EditorSession; slideId: string }): JSX.Element {
  const stored = useEditorValue(session, (state) => state.deck.slides.find((slide) => slide.id === slideId)?.notes ?? "");
  // Null while nothing is being typed: the slide's own notes are shown, so a change from outside (undo, another window) appears at once.
  const [draft, setDraft] = useState<string | null>(null);
  const pending = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const write = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    const text = pending.current;
    if (text === null) return;
    pending.current = null;
    // A slide that has gone has no notes to write.
    if (!session.state.deck.slides.some((slide) => slide.id === slideId)) return;
    session.slides.setNotes(text, slideId);
    const written = session.state.deck.slides.find((slide) => slide.id === slideId)?.notes ?? "";
    if (written === text) setDraft(null);
    else pending.current = text;
  }, [session, slideId]);

  // Goes before the editor leaves, and before the session ends.
  useLayoutEffect(() => write, [write]);

  return (
    <textarea
      className="ks-notes-text"
      aria-label="Speaker notes for this slide"
      placeholder="Click to add speaker notes"
      value={draft ?? stored}
      onChange={(event) => {
        pending.current = event.target.value;
        setDraft(event.target.value);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(write, WRITE_DELAY);
      }}
      onBlur={write}
      onKeyDown={(event) => {
        if (undoKey(event, session, pending.current !== null)) return;
        if (event.key !== "Escape") return;
        event.preventDefault();
        write();
        const root = event.currentTarget.closest(".ks-editor") ?? document;
        root.querySelector<HTMLElement>(".ks-stage")?.focus();
      }}
    />
  );
}

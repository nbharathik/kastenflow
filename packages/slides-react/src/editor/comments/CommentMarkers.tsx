import type { JSX } from "react";
import { useEffect } from "react";

import type { EditorSession } from "../session/session.ts";
import type { EditorUi } from "../ui-state.ts";
import { useEditor } from "../useEditor.ts";
import { focusComment, stopPinning, useFocusedComment, usePinning } from "./pinning.ts";
import "./comments.css";

/** The size of a marker in pixels on screen, and the gap between those of the slide as a whole. */
const MARKER = 22;
const GAP = 4;

/**
 * The comments of the slide shown, as small numbered markers drawn over it: at the point a comment is pinned to, at the top right corner of
 * the element it is about, or in a column at the right edge for the slide as a whole. Pressing one opens the Comments panel at that comment.
 * While a comment waits for a spot, a layer over the slide takes the next press and pins it there. Drawn over the slide and never in it, so
 * a marker is in no thumbnail, no presentation and no export. Resolved comments leave no marker.
 */
export function CommentMarkers({ session, ui, zoom, hidden = false }: { session: EditorSession; ui: EditorUi; zoom: number; hidden?: boolean }): JSX.Element | null {
  const state = useEditor(session);
  const focused = useFocusedComment(session);
  const pinning = usePinning(session);
  const slide = state.deck.slides.find((s) => s.id === state.slideId);
  const comments = (slide?.comments ?? []).filter((comment) => !comment.resolved);

  // Escape gives up pinning.
  useEffect(() => {
    if (pinning === null) return;
    const stop = (event: KeyboardEvent): void => {
      if (event.key === "Escape") stopPinning(session);
    };
    window.addEventListener("keydown", stop);
    return () => window.removeEventListener("keydown", stop);
  }, [pinning, session]);
  // Another slide is another place: a spot awaited on one is not kept for the next.
  useEffect(() => stopPinning(session), [session, state.slideId]);

  if (!slide || hidden || (comments.length === 0 && pinning === null)) return null;
  const width = slide ? state.deck.size.w * zoom : 0;
  let wholeSlide = 0;

  return (
    <div className="ks-cm-layer" data-selbar="">
      {pinning !== null ? (
        <div
          className="ks-cm-pin-layer"
          role="button"
          tabIndex={0}
          aria-label="Press the spot on the slide for the comment"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const x = Math.round((event.clientX - rect.left) / zoom);
            const y = Math.round((event.clientY - rect.top) / zoom);
            const made = session.review.add(pinning, { pin: { x, y } }, slide.id);
            stopPinning(session);
            if (made) focusComment(session, made);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") stopPinning(session);
          }}
        />
      ) : null}
      {comments.map((comment, i) => {
        let left: number;
        let top: number;
        const box = comment.element ? (() => {
          const [element] = session.elements.find([comment.element]);
          return element ? session.elements.boxOf(element) : null;
        })() : null;
        if (comment.pin) {
          left = comment.pin.x * zoom - MARKER / 2;
          top = comment.pin.y * zoom - MARKER / 2;
        } else if (box) {
          left = (box.x + box.w) * zoom - MARKER / 2;
          top = box.y * zoom - MARKER / 2;
        } else {
          left = width - MARKER - GAP;
          top = GAP + wholeSlide * (MARKER + GAP);
          wholeSlide += 1;
        }
        const label = `Comment ${i + 1} by ${comment.author}: ${comment.text.slice(0, 80)}`;
        return (
          <button
            key={comment.id}
            type="button"
            className={`ks-btn ks-cm-marker${focused === comment.id ? " is-focused" : ""}${comment.agent ? " is-agent" : ""}`}
            style={{ left: Math.max(0, left), top: Math.max(0, top) }}
            aria-label={label}
            data-tip={label}
            data-comment-marker={comment.id}
            onClick={() => {
              focusComment(session, comment.id);
              ui.openPanel("comments");
            }}
          >
            {i + 1}
          </button>
        );
      })}
    </div>
  );
}

import type { JSX } from "react";
import { useState } from "react";

import { labelOf } from "../panels/steps/model.ts";
import { Empty } from "../panels/Placeholders.tsx";
import type { CommentPlace } from "../session/review.ts";
import type { EditorSession } from "../session/session.ts";
import type { EditorUi } from "../ui-state.ts";
import { TextButton } from "../ui/Button.tsx";
import { useEditor } from "../useEditor.ts";
import { slideTitle } from "../dialogs/slide-title.ts";
import { CommentCard, isSend } from "./CommentCard.tsx";
import { startPinning, stopPinning, useFocusedComment, usePinning } from "./pinning.ts";
import "./comments.css";

type Show = "open" | "all";
type Where = "slide" | "element";

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Comments: notes left on the slide shown, on the element selected, or at a spot on the slide, each answered and resolved in turn. They are
 * the deck's (saved in its file) but are never drawn when presenting or exporting; the markers on the slide are the editor's own.
 */
export function CommentsPanel({ session }: { session: EditorSession; ui?: EditorUi }): JSX.Element {
  const state = useEditor(session);
  const focused = useFocusedComment(session);
  const pinning = usePinning(session);
  const [words, setWords] = useState("");
  const [where, setWhere] = useState<Where>("slide");
  const [show, setShow] = useState<Show>("open");
  const [everywhere, setEverywhere] = useState(false);

  const all = session.review.all();
  const listed = all.filter(({ slide, comment }) => (everywhere || slide.id === state.slideId) && (show === "all" || !comment.resolved));
  const selected = state.selection.length === 1 ? session.slide.elements.find((e) => e.id === state.selection[0]) : undefined;
  // A comment on an element needs one selected; with none, it is about the slide.
  const aboutElement = where === "element" && selected !== undefined;
  const place: CommentPlace = aboutElement && selected ? { element: selected.id } : {};
  const open = all.filter(({ comment }) => !comment.resolved).length;

  const leave = (): void => {
    if (session.review.add(words, place) !== undefined) setWords("");
  };

  const groups: { slideId: string; number: number; title: string; items: typeof listed }[] = [];
  for (const item of listed) {
    const last = groups[groups.length - 1];
    if (last && last.slideId === item.slide.id) last.items.push(item);
    else groups.push({ slideId: item.slide.id, number: item.number, title: slideTitle(item.slide), items: [item] });
  }

  return (
    <div className="ks-cm">
      <section className="ks-cm-compose" aria-label="Leave a comment">
        <textarea
          className="ks-cm-input"
          rows={3}
          aria-label="Comment"
          placeholder="Leave a comment"
          value={words}
          data-autofocus=""
          onChange={(event) => setWords(event.target.value)}
          onKeyDown={(event) => {
            if (isSend(event)) {
              event.preventDefault();
              leave();
            }
          }}
        />
        <div className="ks-cm-where" role="group" aria-label="What it is about">
          <button type="button" className="ks-btn ks-cm-choice" aria-pressed={!aboutElement} onClick={() => setWhere("slide")}>
            This slide
          </button>
          <button type="button" className="ks-btn ks-cm-choice" aria-pressed={aboutElement} disabled={selected === undefined} onClick={() => setWhere("element")} title={selected ? `On ${labelOf(selected)}` : "Select one element to comment on it"}>
            Selected element
          </button>
        </div>
        <div className="ks-cm-buttons">
          <TextButton primary disabled={words.trim() === ""} onClick={leave}>
            Comment
          </TextButton>
          {pinning === null ? (
            <TextButton disabled={words.trim() === ""} onClick={() => startPinning(session, words.trim())} title="Then press the spot on the slide where it belongs">
              Pin to a spot…
            </TextButton>
          ) : (
            <TextButton onClick={() => stopPinning(session)}>Cancel pinning</TextButton>
          )}
        </div>
        {pinning !== null ? (
          <p className="ks-cm-hint" role="status">
            Press the spot on the slide where the comment belongs. Escape cancels.
          </p>
        ) : (
          <p className="ks-cm-hint">Comments are kept in the deck. They are not shown when presenting or exporting.</p>
        )}
      </section>
      <div className="ks-cm-filters" role="group" aria-label="Which comments">
        <button type="button" className="ks-btn ks-cm-choice" aria-pressed={!everywhere} onClick={() => setEverywhere(false)}>
          This slide
        </button>
        <button type="button" className="ks-btn ks-cm-choice" aria-pressed={everywhere} onClick={() => setEverywhere(true)}>
          All slides
        </button>
        <label className="ks-cm-check">
          <input type="checkbox" checked={show === "all"} onChange={(event) => setShow(event.target.checked ? "all" : "open")} /> Show resolved
        </label>
      </div>
      <p className="ks-cm-count" role="status">
        {open === 0 ? "No open comments." : `${plural(open, "open comment")} in the deck.`}
      </p>
      {groups.length === 0 ? (
        all.length === 0 ? (
          <Empty icon="message-square" title="No comments yet">
            Leave a note on this slide, on something you select, or at a spot on it.
          </Empty>
        ) : (
          <p className="ks-cm-none">{everywhere ? "Nothing to show here." : "No comments on this slide."}</p>
        )
      ) : (
        groups.map((group) => (
          <section key={group.slideId} className="ks-cm-slide" aria-label={`Slide ${group.number}`}>
            {everywhere ? (
              <button type="button" className="ks-btn ks-cm-slide-head" onClick={() => session.goTo(group.slideId)}>
                Slide {group.number} · {group.title}
              </button>
            ) : null}
            <ul className="ks-cm-list">
              {group.items.map((item) => (
                <CommentCard key={item.comment.id} session={session} item={item} focused={focused === item.comment.id} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

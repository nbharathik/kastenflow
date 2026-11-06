import type { JSX, KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";

import type { CommentOn } from "../session/review.ts";
import type { EditorSession } from "../session/session.ts";
import { TextButton } from "../ui/Button.tsx";
import { focusComment } from "./pinning.ts";
import { aboutText, pinnedToSomething, whenText } from "./words.ts";

/** Ctrl+Enter (or Cmd+Enter) sends what is being written. */
export const isSend = (event: KeyboardEvent): boolean => event.key === "Enter" && (event.ctrlKey || event.metaKey);

/** Who wrote it, and when; an assistant is named as one. */
export function Byline({ author, agent, created }: { author: string; agent: boolean; created: string }): JSX.Element {
  const when = whenText(created);
  return (
    <span className="ks-cm-by">
      <span className="ks-cm-author">{author}</span>
      {agent ? <span className="ks-cm-agent">Assistant</span> : null}
      {when ? <time dateTime={created}>{when}</time> : null}
    </span>
  );
}

/** One comment with its answers, and what can be done to it: look at what it is about, answer it, settle it or open it again. */
export function CommentCard({ session, item, focused }: { session: EditorSession; item: CommentOn; focused: boolean }): JSX.Element {
  const { slide, number, comment } = item;
  const [replying, setReplying] = useState(false);
  const [words, setWords] = useState("");
  const card = useRef<HTMLLIElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  // A marker pressed on the slide brings its comment into view.
  useEffect(() => {
    if (focused) card.current?.scrollIntoView?.({ block: "nearest" });
  }, [focused]);
  useEffect(() => {
    if (replying) field.current?.focus();
  }, [replying]);

  const show = (): void => {
    session.goTo(slide.id);
    if (comment.element && pinnedToSomething(slide, comment)) session.select([comment.element]);
    focusComment(session, comment.id);
  };
  const send = (): void => {
    if (session.review.reply(comment.id, words)) {
      setWords("");
      setReplying(false);
    }
  };

  return (
    <li ref={card} className={`ks-cm-card${comment.resolved ? " is-resolved" : ""}${focused ? " is-focused" : ""}`} data-comment={comment.id}>
      <div className="ks-cm-head">
        <Byline author={comment.author} agent={Boolean(comment.agent)} created={comment.created} />
        {comment.resolved ? <span className="ks-cm-state">Resolved</span> : null}
      </div>
      <p className="ks-cm-text">{comment.text}</p>
      <button type="button" className="ks-btn ks-cm-about" onClick={show} aria-label={`Show on slide ${number}: ${aboutText(slide, comment)}`}>
        On {aboutText(slide, comment)}
      </button>
      {(comment.replies ?? []).length > 0 ? (
        <ul className="ks-cm-replies" aria-label="Answers">
          {(comment.replies ?? []).map((reply) => (
            <li key={reply.id} className="ks-cm-reply">
              <Byline author={reply.author} agent={Boolean(reply.agent)} created={reply.created} />
              <p className="ks-cm-text">{reply.text}</p>
            </li>
          ))}
        </ul>
      ) : null}
      {replying ? (
        <div className="ks-cm-write">
          <textarea
            ref={field}
            className="ks-cm-input"
            rows={2}
            aria-label="Your answer"
            placeholder="Write an answer"
            value={words}
            onChange={(event) => setWords(event.target.value)}
            onKeyDown={(event) => {
              if (isSend(event)) {
                event.preventDefault();
                send();
              } else if (event.key === "Escape") {
                event.stopPropagation();
                setReplying(false);
              }
            }}
          />
          <div className="ks-cm-buttons">
            <TextButton primary disabled={words.trim() === ""} onClick={send}>
              Answer
            </TextButton>
            <TextButton onClick={() => setReplying(false)}>Cancel</TextButton>
          </div>
        </div>
      ) : (
        <div className="ks-cm-buttons">
          <TextButton onClick={() => setReplying(true)}>Answer</TextButton>
          <TextButton onClick={() => session.review.resolve(comment.id, !comment.resolved)}>{comment.resolved ? "Reopen" : "Resolve"}</TextButton>
        </div>
      )}
    </li>
  );
}

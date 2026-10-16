// One stack of comments: the comments of a section, of the page as a whole or
// the ones that lost their place, each with its author, its words, and what
// can be done to it (resolve, reopen, attach again), and a place to add one.

import "./comments.css";

import { useState, type ReactNode } from "react";

import { brief } from "../../annotations/brief";
import { versionTime } from "../../panel/history/versions";
import { authorName, openIn, type PlacedComment } from "./comment-groups";

function when(created: string | null): string | null {
  const time = created ? Date.parse(created) : Number.NaN;
  return Number.isFinite(time) ? versionTime(time) : null;
}

interface ItemProps {
  item: PlacedComment;
  onResolve(resolved: boolean): void;
  /** Scrolls to the comment's words in the page; false when they cannot be shown. */
  onShow(): boolean;
  /** Attaches the comment to the selected words (or the page); only for a detached one. */
  onAttach?: () => void;
  attachTitle?: string;
}

function CommentItem({ item, onResolve, onShow, onAttach, attachTitle }: ItemProps) {
  const { comment, place } = item;
  const author = authorName(comment.author);
  const resolved = Boolean(comment.resolved);
  const time = when(comment.created);
  const quote = comment.anchor.quote;
  const found = "range" in place && place.range !== null;
  return (
    <li className={`kasten-comment${author.agent ? " is-agent" : ""}${resolved ? " is-resolved" : ""}`}>
      <div className="kasten-comment-head">
        <span className={`kasten-comment-author${author.agent ? " is-agent" : ""}`} title={author.agent ? `Written by the agent ${author.name}` : undefined}>
          {author.agent ? `Agent · ${author.name}` : author.name}
        </span>
        {time && <time dateTime={comment.created ?? undefined}>{time}</time>}
        {resolved && <span className="kasten-comment-state">Resolved</span>}
      </div>
      {quote &&
        (found ? (
          <button type="button" className="kasten-comment-quote" title="Show these words in the page" onClick={onShow}>
            “{brief(quote)}”
          </button>
        ) : (
          <p className="kasten-comment-quote">“{brief(quote)}”</p>
        ))}
      <p className="kasten-comment-text">{comment.text}</p>
      <div className="kasten-comment-actions">
        {resolved ? (
          <button type="button" className="kasten-comment-btn" onClick={() => onResolve(false)}>
            Reopen
          </button>
        ) : (
          <button type="button" className="kasten-comment-btn" onClick={() => onResolve(true)}>
            Resolve
          </button>
        )}
        {onAttach && (
          <button type="button" className="kasten-comment-btn" title={attachTitle} onClick={onAttach}>
            Attach here
          </button>
        )}
      </div>
    </li>
  );
}

/** A place to write a comment; `about` is the words it will be on. */
export function AddComment({ label, about, onAbout, onAdd }: { label: string; about?: string | null; onAbout?: () => void; onAdd(text: string): Promise<boolean> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const added = await onAdd(text);
    setBusy(false);
    if (added) setText("");
  };
  return (
    <form
      className="kasten-comment-add"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {about && (
        <p className="kasten-comment-about">
          <span>On</span>
          <span className="kasten-comment-about-quote" title={about}>
            “{brief(about, 60)}”
          </span>
          {onAbout && (
            <button type="button" onClick={onAbout} title="Comment on the whole page instead">
              Whole page
            </button>
          )}
        </p>
      )}
      <textarea
        rows={2}
        value={text}
        placeholder="Add a comment…"
        aria-label={label}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <button type="submit" className="kasten-comment-btn is-primary" disabled={!text.trim() || busy}>
        {busy ? "Adding…" : "Comment"}
      </button>
    </form>
  );
}

interface StackProps {
  /** The stack's name: a section's title, "Whole page", "Detached". */
  title: ReactNode;
  /** A number before the title, for a section. */
  number?: number;
  items: PlacedComment[];
  showResolved: boolean;
  /** Goes to the stack's section in the page. */
  onGo?: () => void;
  onResolve(id: string, resolved: boolean): void;
  onShow(item: PlacedComment): boolean;
  /** Present on the stack of detached comments. */
  onAttach?: (item: PlacedComment) => void;
  attachTitle?: string;
  /** A place to add a comment. */
  add?: { label: string; about?: string | null; onAbout?: () => void; onAdd(text: string): Promise<boolean> };
  /** A line under the title. */
  note?: string;
  className?: string;
}

export function CommentStack({ title, number, items, showResolved, onGo, onResolve, onShow, onAttach, attachTitle, add, note, className = "" }: StackProps) {
  const open = openIn(items);
  const shown = showResolved ? items : items.filter((item) => !item.comment.resolved);
  return (
    <section className={`kasten-comment-stack${className ? ` ${className}` : ""}`} aria-label={typeof title === "string" ? `Comments: ${title}` : "Comments"}>
      <h3 className="kasten-comment-stack-head">
        {number !== undefined && <span className="kasten-comment-stack-number">{number}</span>}
        {onGo ? (
          <button type="button" title="Go to this section" onClick={onGo}>
            {title}
          </button>
        ) : (
          <span>{title}</span>
        )}
        {items.length > 0 && <span className="kasten-comment-stack-count">{open > 0 ? `${open} open` : "all resolved"}</span>}
      </h3>
      {note && <p className="kasten-comment-note">{note}</p>}
      {shown.length > 0 && (
        <ul className="kasten-comment-list">
          {shown.map((item) => (
            <CommentItem key={item.comment.id} item={item} onResolve={(resolved) => onResolve(item.comment.id, resolved)} onShow={() => onShow(item)} onAttach={onAttach && (() => onAttach(item))} attachTitle={attachTitle} />
          ))}
        </ul>
      )}
      {add && <AddComment {...add} />}
    </section>
  );
}

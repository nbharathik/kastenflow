import type { Slide } from "@kasten-slides/wasm";
import { type JSX, type KeyboardEvent, memo, useLayoutEffect, useMemo, useRef } from "react";

import type { EditorSession } from "../session/session.ts";
import { Icon } from "../ui/Icon.tsx";
import { undoKey } from "../filmstrip/keys.ts";
import { Ghost } from "./Ghost.tsx";
import { bodyLineEdit } from "./lines.ts";
import { textToMarkdown, titleMarkdown } from "./markdown.ts";
import { bodyElement, titleElement } from "./titles.ts";
import { useDraft } from "./useDraft.ts";
import { canStartTitle, createTitle, readField, writeField } from "./write.ts";

/** What a row asks of the outline it is in. One object for the whole outline, so rows are not drawn again for it. */
export interface OutlineApi {
  /** Shows the slide and picks only it. */
  show(id: string): void;
  /** Shows the slide and goes back to the editor. */
  open(id: string): void;
  /** Adds a slide after this one and puts the caret in its title. */
  addAfter(id: string): void;
  /** Puts the caret in the title of the slide after this one. */
  focusTitleAfter(id: string): void;
}

export interface OutlineRowProps {
  session: EditorSession;
  api: OutlineApi;
  slide: Slide;
  /** From 0. */
  index: number;
  shown: boolean;
}

const isEnter = (event: KeyboardEvent) => event.key === "Enter" && !event.nativeEvent.isComposing;

/**
 * One slide in the outline: its number, its title as a field and its body as
 * Markdown. It is drawn again only when its own slide changes.
 */
export const OutlineRow = memo(function OutlineRow({ session, api, slide, index, shown }: OutlineRowProps): JSX.Element {
  const id = slide.id;
  const title = titleElement(slide);
  const body = bodyElement(slide);
  const storedTitle = useMemo(() => (title ? titleMarkdown(title.text) : ""), [title?.text]);
  const storedBody = useMemo(() => (body ? textToMarkdown(body.text) : ""), [body?.text]);
  const bodyField = useRef<HTMLTextAreaElement>(null);
  // Where the caret goes once the body shows words that a key has changed.
  const caret = useRef<{ start: number; end: number } | null>(null);
  useLayoutEffect(() => {
    if (caret.current && bodyField.current) bodyField.current.setSelectionRange(caret.current.start, caret.current.end);
    caret.current = null;
  });
  // A slide with nothing on it has no title yet, and the first words typed make one.
  const blank = !title && canStartTitle(session.state.deck, slide);
  const titleDraft = useDraft(
    storedTitle,
    (typed) => (title ? writeField(session, id, title.id, "title", typed) : blank && createTitle(session, id, typed)),
    () => readField(session, id, "title"),
  );
  const bodyDraft = useDraft(
    storedBody,
    (typed) => body && writeField(session, id, body.id, "body", typed),
    () => readField(session, id, "body"),
  );

  const onTitleKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (undoKey(event, session, titleDraft.typing())) return;
    if (!isEnter(event) || event.shiftKey) return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) api.addAfter(id);
    else if (bodyField.current) bodyField.current.focus();
    else api.focusTitleAfter(id);
  };

  const onBodyKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const field = event.currentTarget;
    if (undoKey(event, session, bodyDraft.typing())) return;
    if (isEnter(event) && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      api.addAfter(id);
      return;
    }
    const edit = bodyLineEdit(event, field.value, field.selectionStart, field.selectionEnd);
    if (!edit) return;
    event.preventDefault();
    caret.current = { start: edit.start, end: edit.end };
    bodyDraft.onChange(edit.value);
  };

  return (
    <section className={`ks-ol-row${shown ? " is-shown" : ""}${slide.hidden ? " is-skipped" : ""}${slide.backup && index > 0 ? " is-backup" : ""}`} data-slide={id} aria-label={`Slide ${index + 1}`}>
      <div className="ks-ol-side">
        <button type="button" className="ks-btn ks-ol-num" tabIndex={-1} aria-label={`Show slide ${index + 1}`} title="Show this slide; double-click to edit it" onClick={() => api.show(id)} onDoubleClick={() => api.open(id)}>
          {index + 1}
        </button>
        {slide.hidden ? (
          <span className="ks-ol-flag" title="Skipped when presenting">
            <Icon name="eye-off" size={13} />
          </span>
        ) : null}
        {slide.backup && index > 0 ? <span className="ks-ol-flag is-word">Backup</span> : null}
      </div>
      <div className="ks-ol-main">
        {title || blank ? (
          // The same field before and after the first words make the title, so the caret stays where it is.
          <div className="ks-ol-field">
            <input
              className="ks-ol-title"
              aria-label={`Title of slide ${index + 1}`}
              placeholder="Untitled slide"
              value={titleDraft.value}
              onChange={(event) => titleDraft.onChange(event.target.value)}
              onFocus={() => api.show(id)}
              onBlur={titleDraft.onBlur}
              onKeyDown={onTitleKey}
            />
            <Ghost text={titleDraft.value} kind="title" />
          </div>
        ) : (
          // Other things on the slide and no text to use as a title: the outline does not make one beside them.
          <input className="ks-ol-title is-none" aria-label={`Title of slide ${index + 1}`} placeholder="Untitled slide" value="" readOnly title="This slide has no text to use as a title" onFocus={() => api.show(id)} onKeyDown={onTitleKey} />
        )}
        {body ? (
          <div className="ks-ol-grow" data-value={bodyDraft.value}>
            <textarea
              ref={bodyField}
              className="ks-ol-body"
              aria-label={`Text of slide ${index + 1}`}
              placeholder="Add text, a line for each point"
              rows={1}
              spellCheck
              value={bodyDraft.value}
              onChange={(event) => bodyDraft.onChange(event.target.value)}
              onFocus={() => api.show(id)}
              onBlur={bodyDraft.onBlur}
              onKeyDown={onBodyKey}
            />
            <Ghost text={bodyDraft.value} kind="body" />
          </div>
        ) : null}
      </div>
    </section>
  );
});

// A page's comments as stacks: one for each section of a page that has
// sections, one for the page as a whole, and one for the comments that lost
// their place, each with "Attach here" to put it back. The column beside a
// sections page and the panel's Comments tab are both this.

import "./comments.css";

import { useMemo, useState } from "react";

import { anchorFor, sectionAtOffset, type Words } from "../../annotations/anchor";
import type { CommentAnchor } from "../../../lib/vault/annotation-types";
import { brief } from "../../annotations/brief";
import { CommentStack } from "./CommentStack";
import { stacksOf, type PlacedComment } from "./comment-groups";
import type { CommentsEditor, CommentsModel } from "./use-comments";

interface Props {
  model: CommentsModel;
  editor: { current: CommentsEditor | null };
  /** The words selected in the editor, if any. */
  words: Words | null;
}

export function CommentsStacks({ model, editor, words }: Props) {
  const { placed, text, error } = model;
  const [showResolved, setShowResolved] = useState(false);
  // Words picked in the stack for the page as a whole can be left out of the comment.
  const [leftOut, setLeftOut] = useState<string | null>(null);
  const stacks = useMemo(() => (placed && text ? stacksOf(placed, text.sections.length) : null), [placed, text]);

  if (error) return <p className="kasten-comments-empty">The comments could not be read: {error}</p>;
  if (!stacks || !text) return <p className="kasten-comments-empty">Reading the comments…</p>;

  const sections = text.sections.length;
  const several = sections > 1;
  const total = placed?.length ?? 0;
  const resolved = (placed ?? []).filter((item) => item.comment.resolved).length;
  const onShow = (item: PlacedComment) => model.show(item);
  const aboutPage = words && !several && leftOut !== words.quote ? words : null;

  const addOn = (label: string, anchor: () => CommentAnchor) => ({ label, onAdd: (body: string) => model.add(body, anchor()) });

  return (
    <>
      <div className="kasten-comments-top">
        <span>{total === 0 ? "No comments yet" : `${total - resolved} open${resolved > 0 ? `, ${resolved} resolved` : ""}`}</span>
        {resolved > 0 && (
          <button type="button" className="kasten-comments-toggle" aria-pressed={showResolved} onClick={() => setShowResolved((on) => !on)}>
            {showResolved ? "Hide resolved" : "Show resolved"}
          </button>
        )}
      </div>
      <CommentStack
        title={several ? "Whole page" : "This page"}
        items={stacks.page}
        showResolved={showResolved}
        onResolve={(id, done) => void model.resolve(id, done)}
        onShow={onShow}
        add={{
          ...addOn(several ? "Comment on the whole page" : "Comment on this page", () => anchorFor(text, aboutPage ? { words: aboutPage } : {})),
          about: aboutPage?.quote ?? null,
          onAbout: aboutPage ? () => setLeftOut(aboutPage.quote) : undefined,
        }}
      />
      {several &&
        text.sections.map((section, index) => {
          const here = words && sectionAtOffset(text, words.from) === index ? words : null;
          return (
            <CommentStack
              key={`${index}:${section.title}`}
              number={index + 1}
              title={section.title}
              items={stacks.sections[index] ?? []}
              showResolved={showResolved}
              onGo={() => editor.current?.showSection(index)}
              onResolve={(id, done) => void model.resolve(id, done)}
              onShow={onShow}
              add={{ ...addOn(`Comment on section ${index + 1}, ${section.title}`, () => anchorFor(text, here ? { words: here } : { section: index })), about: here?.quote ?? null }}
            />
          );
        })}
      {stacks.detached.length > 0 && (
        <CommentStack
          className="is-detached"
          title="Detached"
          note="The words these comments were about are not on the page any more. Select where they belong and attach them there, or resolve them."
          items={stacks.detached}
          showResolved={showResolved}
          onResolve={(id, done) => void model.resolve(id, done)}
          onShow={onShow}
          onAttach={(item) => void model.attach(item.comment.id, anchorFor(text, words ? { words } : { section: editor.current?.caretSection() ?? null }))}
          attachTitle={words ? `Attach to “${brief(words.quote, 40)}”` : several ? "Attach to the section the cursor is in (select words to attach to them)" : "Attach to the whole page (select words to attach to them)"}
        />
      )}
    </>
  );
}

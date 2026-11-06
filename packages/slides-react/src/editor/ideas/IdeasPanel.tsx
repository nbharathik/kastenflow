import { type JSX, useMemo } from "react";

import { SlideThumb, useImageUrl, useThumbDeck } from "../filmstrip/SlideThumb.tsx";
import { stopAt, walkOptions } from "../panels/format/roving.ts";
import type { EditorSession } from "../session/session.ts";
import type { EditorUi } from "../ui-state.ts";
import { useEditor } from "../useEditor.ts";
import { applyIdea, insertBlock } from "./apply.ts";
import { BLOCKS } from "./blocks.ts";
import { designIdeas } from "./ideas.ts";
import "./ideas.css";

const WIDTH = 124;

/**
 * Design ideas for the slide on the canvas: other ways to lay out what it holds, each drawn small as it would look, and below them
 * the blocks that are ready to drop in (an agenda, a quote, a key number ...). A click does it, as one step of undo.
 */
export function IdeasPanel({ session }: { session: EditorSession; ui: EditorUi }): JSX.Element {
  const state = useEditor(session);
  const imageUrl = useImageUrl(session);
  const deck = useThumbDeck(state.deck);
  const slide = state.deck.slides.find((s) => s.id === state.slideId);
  const ideas = useMemo(() => (slide ? designIdeas(state.deck, slide) : []), [state.deck, slide]);
  const number = Math.max(1, state.deck.slides.findIndex((s) => s.id === state.slideId) + 1);

  return (
    <div className="ks-ideas">
      <section aria-label="Layouts for this slide">
        <h3 className="ks-ideas-head">For this slide</h3>
        {ideas.length === 0 ? (
          <p className="ks-ideas-note">Nothing to rearrange yet. Add a title, some words or a picture, and ideas for how to lay them out appear here.</p>
        ) : (
          <div className="ks-ideas-grid" role="listbox" aria-label="Design ideas" onKeyDown={(event) => walkOptions(event, 2)}>
            {ideas.map((idea, i) => (
              <button
                key={idea.id}
                type="button"
                role="option"
                aria-selected={false}
                aria-label={idea.label}
                title={idea.hint}
                tabIndex={stopAt(i, 0)}
                className="ks-btn ks-ideas-item"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyIdea(session, idea)}
              >
                <SlideThumb deck={deck} slide={idea.preview} number={number} count={state.deck.slides.length} width={WIDTH} imageUrl={imageUrl} />
                <span className="ks-ideas-name">{idea.label}</span>
              </button>
            ))}
          </div>
        )}
      </section>
      <section aria-label="Ready-made blocks">
        <h3 className="ks-ideas-head">Blocks</h3>
        <p className="ks-ideas-note">Each one is dropped on the slide as a group, in the theme's colours, with words to write over.</p>
        <ul className="ks-ideas-blocks">
          {BLOCKS.map((block) => (
            <li key={block.kind}>
              <button type="button" className="ks-btn ks-ideas-block" onMouseDown={(event) => event.preventDefault()} onClick={() => insertBlock(session, block.kind)}>
                <span className="ks-ideas-name">{block.label}</span>
                <span className="ks-ideas-sub">{block.description}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

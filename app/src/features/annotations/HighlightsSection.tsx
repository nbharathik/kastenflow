// The highlights on a page kept from the web, listed in the Details panel:
// click one to go to its words, change its colour or comment, remove it, or
// put one whose words are no longer on the page back on the words selected.

import "../sources/colors.css";
import "../sources/reader/reader-marks.css";
import "./annotations.css";

import { useState, type RefObject } from "react";

import { COLOR_NAMES, colorOf, HIGHLIGHT_COLORS } from "../sources/colors";
import type { Words } from "./anchor";
import { brief } from "./brief";
import { useSelectedWords, type SelectionEditor } from "./use-selected-words";
import { MOST_HIGHLIGHT, type HighlightsModel, type PlacedHighlight } from "./use-text-highlights";

function Item({ item, model, words }: { item: PlacedHighlight; model: HighlightsModel; words: Words | null }) {
  const { highlight: h, range } = item;
  const [comment, setComment] = useState(h.comment ?? "");
  const saveComment = () => {
    if (comment.trim() !== (h.comment ?? "")) void model.edit(h.id, { comment });
  };
  return (
    <li className={`kasten-text-hl-item is-${colorOf(h.color)}${model.current === h.id ? " is-current" : ""}${range ? "" : " is-detached"}`}>
      <div className="kasten-text-hl-row">
        <div className="kasten-hl-colors" role="radiogroup" aria-label="Colour">
          {HIGHLIGHT_COLORS.map((color) => (
            <button key={color} type="button" role="radio" aria-checked={colorOf(h.color) === color} aria-label={COLOR_NAMES[color]} className={`kasten-hl-swatch is-${color}`} onClick={() => color !== h.color && void model.edit(h.id, { color })} />
          ))}
        </div>
        <button type="button" className="kasten-text-hl-remove" onClick={() => void model.remove(h.id)}>
          Remove
        </button>
      </div>
      {range ? (
        <button type="button" className="kasten-text-hl-quote" title="Show these words in the page" onClick={() => model.show(item)}>
          {brief(h.anchor.quote, 160)}
        </button>
      ) : (
        <>
          <p className="kasten-text-hl-quote">{brief(h.anchor.quote, 160)}</p>
          <p className="kasten-text-hl-lost">These words are not on the page any more.</p>
          <button type="button" className="kasten-panel-button" disabled={!words} title={words ? `Move it to “${brief(words.quote, 40)}”` : "Select the words it belongs to first"} onClick={() => words && void model.attach(h.id, words)}>
            Attach here
          </button>
        </>
      )}
      <textarea className="kasten-text-hl-comment" rows={1} value={comment} placeholder="Add a comment…" aria-label={`Comment on “${brief(h.anchor.quote, 30)}”`} onChange={(event) => setComment(event.target.value)} onBlur={saveComment} />
    </li>
  );
}

interface Props {
  model: HighlightsModel;
  editor: RefObject<SelectionEditor | null>;
  ready: number;
}

export function HighlightsSection({ model, editor, ready }: Props) {
  const words = useSelectedWords(editor, ready, MOST_HIGHLIGHT);
  const { placed, error } = model;
  return (
    <section className="kasten-panel-section" aria-label="Highlights">
      <h3 className="kasten-panel-label">
        <span>
          Highlights <span className="kasten-panel-count">{placed?.length ?? 0}</span>
        </span>
      </h3>
      {error ? (
        <p className="kasten-panel-empty">The highlights could not be read: {error}</p>
      ) : !placed ? (
        <p className="kasten-panel-empty">Reading the highlights…</p>
      ) : placed.length === 0 ? (
        <p className="kasten-panel-empty">Select words on this page to highlight them.</p>
      ) : (
        <ul className="kasten-text-hl-list">
          {placed.map((item) => (
            <Item key={item.highlight.id} item={item} model={model} words={words} />
          ))}
        </ul>
      )}
    </section>
  );
}

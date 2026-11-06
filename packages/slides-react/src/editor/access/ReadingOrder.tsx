import type { JSX } from "react";
import { useState } from "react";

import { labelOf } from "../panels/steps/model.ts";
import type { EditorSession } from "../session/session.ts";
import { TextButton } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";
import { useEditor } from "../useEditor.ts";
import { moved, readingOrderOf } from "./reading-order.ts";

/**
 * The order a screen reader goes through the slide shown, first to last. Drag an element to a new place, or move it with its two buttons
 * (the keyboard's way). The slide keeps the order it is given; "Usual order" goes back to rows from top to bottom, each left to right.
 */
export function ReadingOrder({ session }: { session: EditorSession }): JSX.Element {
  const state = useEditor(session);
  const slide = session.slide;
  const elements = readingOrderOf(slide, state.deck.theme);
  const [from, setFrom] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const ids = elements.map((e) => e.id);
  const own = (slide.access?.readingOrder ?? []).length > 0;

  const put = (a: number, b: number): void => {
    if (a !== b) session.access.setOrder(slide.id, moved(ids, a, b));
  };

  return (
    <section className="ks-ac-order" aria-label="Reading order">
      <h4>Reading order of this slide</h4>
      {elements.length < 2 ? (
        <p className="ks-ac-hint">There is nothing to put in order on this slide.</p>
      ) : (
        <>
          <p className="ks-ac-hint">{own ? "A screen reader reads in the order below." : "Top to bottom, left to right. Drag, or use the arrows, to change it."}</p>
          <ol className="ks-ac-order-list">
            {elements.map((element, i) => (
              <li
                key={element.id}
                className={`ks-ac-order-item${over === i && from !== null && from !== i ? " is-over" : ""}${from === i ? " is-dragged" : ""}`}
                draggable
                onDragStart={(event) => {
                  setFrom(i);
                  event.dataTransfer?.setData("text/plain", element.id);
                  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setOver(i);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (from !== null) put(from, i);
                  setFrom(null);
                  setOver(null);
                }}
                onDragEnd={() => {
                  setFrom(null);
                  setOver(null);
                }}
              >
                <span className="ks-ac-grip" aria-hidden="true">
                  <Icon name="grip-vertical" size={14} />
                </span>
                <span className="ks-ac-order-no">{i + 1}</span>
                <button type="button" className="ks-btn ks-ac-order-name" onClick={() => session.select([element.id])} title="Select it on the slide">
                  {labelOf(element)}
                </button>
                <button type="button" className="ks-btn ks-ac-move" aria-label={`Read ${labelOf(element)} earlier`} disabled={i === 0} onClick={() => put(i, i - 1)}>
                  <Icon name="arrow-up" size={14} />
                </button>
                <button type="button" className="ks-btn ks-ac-move" aria-label={`Read ${labelOf(element)} later`} disabled={i === elements.length - 1} onClick={() => put(i, i + 1)}>
                  <Icon name="arrow-down" size={14} />
                </button>
              </li>
            ))}
          </ol>
          <TextButton disabled={!own} onClick={() => session.access.setOrder(slide.id, [])}>
            Usual order
          </TextButton>
        </>
      )}
    </section>
  );
}

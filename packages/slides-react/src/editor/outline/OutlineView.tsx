import { type JSX, Fragment, useEffect, useLayoutEffect, useMemo, useRef } from "react";

import type { EditorSession } from "../session/session.ts";
import { Icon } from "../ui/Icon.tsx";
import type { EditorUi } from "../ui-state.ts";
import { useEditorValue } from "../useEditor.ts";
import { isSelectAllKey } from "../select-all/dom.ts";
import { type OutlineApi, OutlineRow } from "./OutlineRow.tsx";
import { hasSelectedWords, selectAllText, selectedWords } from "./select.ts";
import "./outline.css";

/** The deck as an outline of titles and bullets, edited as text. */
export function OutlineView({ session, ui }: { session: EditorSession; ui: EditorUi }): JSX.Element {
  const deck = useEditorValue(session, (state) => state.deck);
  const shown = useEditorValue(session, (state) => state.slideId);
  const root = useRef<HTMLDivElement>(null);
  // A slide added here gets the caret in its title, once its row is on the page.
  const wanted = useRef<string | null>(null);

  const api = useMemo<OutlineApi>(() => {
    const titleOf = (id: string) => root.current?.querySelector<HTMLElement>(`[data-slide="${id}"] .ks-ol-title`);
    const show = (id: string) => {
      session.goTo(id);
      if (session.state.slideSelection.length !== 1) session.selectSlides([id]);
    };
    return {
      show,
      open(id) {
        show(id);
        ui.setView("edit");
      },
      addAfter(id) {
        // A blank slide, as New slide makes one: the first words typed in its title give it a title box (see `createTitle`).
        const added = session.slides.add({ after: id });
        if (added) wanted.current = added;
      },
      focusTitleAfter(id) {
        const slides = session.state.deck.slides;
        const next = slides[slides.findIndex((slide) => slide.id === id) + 1];
        if (next) titleOf(next.id)?.focus();
      },
    };
  }, [session, ui]);

  useEffect(() => {
    const id = wanted.current;
    if (!id) return;
    wanted.current = null;
    root.current?.querySelector<HTMLElement>(`[data-slide="${id}"] .ks-ol-title`)?.focus();
  }, [deck.slides]);

  // Select all, from the key, the Edit menu or a right click, takes the words of every row.
  useEffect(() => ui.areas.register("outline", () => root.current && selectAllText(root.current)), [ui]);

  // Opening the outline shows the slide that was being edited.
  useLayoutEffect(() => {
    root.current?.querySelector(`[data-slide="${shown}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, []);

  const last = deck.slides[deck.slides.length - 1];
  return (
    <div
      ref={root}
      className="ks-outline-view"
      role="region"
      aria-label="Outline"
      // Holds the focus while words of several rows are selected, so that its keys reach it.
      tabIndex={-1}
      onKeyDown={(event) => {
        if (isSelectAllKey(event.nativeEvent)) {
          // The words of every row, not of the one field that has the focus.
          event.preventDefault();
          selectAllText(event.currentTarget);
        } else if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          // Escape first drops the words selected across rows; failing that it leaves the field, so a press and a drag can begin anywhere.
          const field = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement ? event.target : null;
          if (hasSelectedWords()) {
            event.preventDefault();
            window.getSelection()?.removeAllRanges();
          } else if (field) {
            event.preventDefault();
            field.blur();
            event.currentTarget.focus({ preventScroll: true });
          }
        }
      }}
      onCopy={(event) => {
        // Words selected across rows are copied as the lines they are; a selection inside one field is the browser's.
        if (!hasSelectedWords()) return;
        const words = selectedWords(event.currentTarget).join("\n");
        if (words === "") return;
        event.preventDefault();
        event.clipboardData.setData("text/plain", words);
      }}
    >
      <div className="ks-ol-page">
        {deck.slides.map((slide, index) => (
          <Fragment key={slide.id}>
            <OutlineRow session={session} api={api} slide={slide} index={index} shown={slide.id === shown} />
            <div className="ks-ol-gap">
              <button type="button" className="ks-btn ks-ol-plus" tabIndex={-1} aria-label={`Add a slide after slide ${index + 1}`} title="Add a slide here" onClick={() => api.addAfter(slide.id)} />
            </div>
          </Fragment>
        ))}
        <button type="button" className="ks-btn ks-ol-new" onClick={() => last && api.addAfter(last.id)}>
          <Icon name="plus" size={16} />
          <span>New slide</span>
        </button>
      </div>
    </div>
  );
}

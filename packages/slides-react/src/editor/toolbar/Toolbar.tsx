import { type JSX, type KeyboardEvent, useMemo, useRef } from "react";

import { useChromeValue } from "../chrome/chrome.ts";
import type { EditorSession } from "../session/session.ts";
import type { EditorUi } from "../ui-state.ts";
import { useElementSize } from "../useElementSize.ts";
import { ArrangeTools } from "./ArrangeTools.tsx";
import { DiagramTools } from "./DiagramTools.tsx";
import { type Shown, ShownContext } from "./Group.tsx";
import { HistoryTools, ZoomTool } from "./HistoryTools.tsx";
import { InsertTools } from "./InsertTools.tsx";
import { MoreMenu } from "./MoreMenu.tsx";
import { usePaintBrush } from "./paint.ts";
import { PanelTools } from "./PanelTools.tsx";
import { ShapeTools } from "./ShapeTools.tsx";
import { slotsFor } from "./slots.ts";
import { SlideTools } from "./SlideTools.tsx";
import { TextGroups } from "./TextTools.tsx";
import { TipView, useTips } from "./Tips.tsx";
import { useBarMode } from "./useBarMode.ts";
import { useOverflow } from "./useOverflow.ts";
import "./toolbar.css";

/** Buttons and fields the arrow keys can go between: the ones in the bar itself, not in a menu opened from it. */
function stops(bar: HTMLElement): HTMLElement[] {
  return [...bar.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)")].filter((el) => !el.closest(".ks-popover"));
}

/**
 * The row of tools under the menus: one row, whose groups follow what is selected. With nothing selected it has history, zoom, what to
 * put on the slide and the slide's own settings; with something selected it swaps to the controls for that thing (the font and the words'
 * look for text, the fill and border for a shape, the order and animation for anything), and leaves out what does not apply instead of
 * greying it. A row too narrow for its groups sends the last of them into a "more" menu, and the button for the format options stays at the
 * right edge. Nothing in it takes the focus from a text box that is being edited.
 *
 * The bar follows only the facts that decide its groups; each group follows only what it shows, so a change of selection, a save or a step
 * of undo draws only the groups it concerns, and a marquee dragged over the slide does not draw the bar again for each pixel.
 */
export function Toolbar({ session, ui }: { session: EditorSession; ui: EditorUi }): JSX.Element {
  const mode = useBarMode(session, ui);
  const { selected, text, shape, diagram } = mode;
  const slots = useMemo(() => slotsFor({ selected, text, shape, diagram }), [selected, text, shape, diagram]);
  const bar = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const pinned = useRef<HTMLDivElement>(null);
  const { w } = useElementSize(bar);
  const density = useChromeValue(ui, (state) => state.density);
  const hidden = useOverflow(bar, box, pinned, slots, w, density);
  const here = useMemo<Shown>(() => ({ shows: (id) => !hidden.has(id) }), [hidden]);
  const { tip, handlers } = useTips();
  usePaintBrush(session, ui);

  // Left and Right go from button to button.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    handlers.onKeyDown();
    const element = bar.current;
    const target = event.target;
    if (!element || !(target instanceof HTMLElement) || target.closest(".ks-popover") || target instanceof HTMLInputElement) return;
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    const all = stops(element);
    const to = all[all.indexOf(target) + step];
    if (!to) return;
    event.preventDefault();
    to.focus();
  };

  const groups = (
    <>
      <HistoryTools session={session} ui={ui} />
      <ZoomTool session={session} ui={ui} />
      {mode.selected ? (
        <>
          {mode.text ? <TextGroups session={session} ui={ui} /> : null}
          <ShapeTools session={session} ui={ui} />
          <DiagramTools session={session} ui={ui} />
          <ArrangeTools session={session} ui={ui} />
        </>
      ) : (
        <>
          <InsertTools session={session} ui={ui} />
          <SlideTools session={session} ui={ui} />
        </>
      )}
    </>
  );

  return (
    <div
      ref={bar}
      className="ks-toolbar"
      role="toolbar"
      aria-label="Toolbar"
      onKeyDown={onKeyDown}
      onMouseOver={handlers.onMouseOver}
      onMouseLeave={handlers.onMouseLeave}
      onMouseDown={handlers.onMouseDown}
      onFocus={handlers.onFocus}
      onBlur={handlers.onBlur}
    >
      <div ref={box} className="ks-tb-groups">
        <ShownContext value={here}>{groups}</ShownContext>
        {hidden.size > 0 ? <MoreMenu hidden={hidden}>{groups}</MoreMenu> : null}
      </div>
      <div ref={pinned} className="ks-tb-pinned">
        <PanelTools session={session} ui={ui} />
      </div>
      {tip ? <TipView tip={tip} /> : null}
    </div>
  );
}

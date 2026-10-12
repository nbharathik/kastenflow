import "./present.css";

import { useEffect, useRef, useState, type RefObject } from "react";

import { fillScreen } from "../../../lib/fullscreen";
import { presentAction } from "../../../lib/present-keys";
import { Icon } from "../../../ui/Icon";
import { endPresenting, stepPresenting } from "../editor/sections/registry";
import { usePresenting } from "./use-presenting";

/** What a click, or a key, is meant for rather than for the slide: controls,
 * links, and the live blocks (a whiteboard, a deck, a database) that take clicks themselves. */
const LIVE = "a, button, input, textarea, select, summary, iframe, video, audio, [role='button'], [role='dialog'], [role='menu'], .kasten-board-embed, .kasten-deck-embed, .kasten-db-embed, .kasten-present-hud";
/** Where keys belong to what is being typed or chosen, not to the talk. */
const TYPING = "input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu'], [role='listbox']";

/** How long the progress stays after a slide changes. */
const SHOWN_MS = 1800;

/**
 * A page being presented: the page itself takes the window (its editor shows
 * one section at a time, read-only; `is-presenting` on the page frame does the
 * rest), the screen where it may, and the presenter's keys (lib/present-keys).
 * A click on a slide goes on to the next. A small "3 / 7" shows for a moment
 * after each move. Ending gives the screen back and the page its place.
 */
export function PagePresenter({ root, scroller }: { root: RefObject<HTMLElement | null>; scroller: () => HTMLElement | null }) {
  const info = usePresenting(root);
  // The editor presenting, which the keys and buttons ask to move on or to end.
  const editor = info?.dom ?? null;
  const [shown, setShown] = useState(false);
  // Held for the cleanup, which must run once the page is drawn as it was.
  const place = useRef(0);

  // The screen while presenting, and the page's own place given back at the end.
  useEffect(() => {
    if (!editor) return;
    place.current = scroller()?.scrollTop ?? 0;
    root.current?.focus({ preventScroll: true });
    let over = false;
    let giveBack: (() => void) | null = null;
    void fillScreen(() => endPresenting(editor)).then((back) => (over ? back() : (giveBack = back)));
    return () => {
      over = true;
      giveBack?.();
      const back = () => {
        const pane = scroller();
        if (pane) pane.scrollTop = place.current;
      };
      back();
      requestAnimationFrame(back);
    };
  }, [editor, root, scroller]);

  // Each slide starts at its top; a slide too tall for the screen scrolls inside it.
  const index = info?.index ?? -1;
  useEffect(() => {
    const pane = scroller();
    if (index >= 0 && pane) pane.scrollTop = 0;
  }, [index, scroller]);

  // The progress shows for a moment after the slide changes.
  const count = info?.count ?? 0;
  useEffect(() => {
    if (index < 0) return;
    setShown(true);
    const timer = setTimeout(() => setShown(false), SHOWN_MS);
    return () => clearTimeout(timer);
  }, [index, count]);

  useEffect(() => {
    if (!editor) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest(TYPING)) return;
      const action = presentAction(event);
      if (action === null) return;
      event.preventDefault();
      event.stopPropagation();
      if (action === "end") endPresenting(editor);
      else stepPresenting(editor, action);
    };
    // Before the app's own keys, which would take N and P, Space and the arrows.
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [editor]);

  useEffect(() => {
    const frame = root.current;
    if (!editor || !frame) return;
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element) || event.target.closest(LIVE)) return;
      stepPresenting(editor, event.shiftKey ? "previous" : "next");
    };
    frame.addEventListener("click", onClick);
    return () => frame.removeEventListener("click", onClick);
  }, [editor, root]);

  if (!info || !editor) return null;
  return (
    <div className={`kasten-present-hud${shown ? " is-shown" : ""}`} role="toolbar" aria-label="Presentation" onMouseMove={() => setShown(true)}>
      <button type="button" className="ui-icon-btn" aria-label="Previous slide" title="Previous (←)" disabled={info.index === 0} onClick={() => stepPresenting(editor, "previous")}>
        <Icon name="chevron-left" />
      </button>
      <span className="kasten-present-where" role="status" aria-live="polite">
        {info.index + 1} / {info.count}
      </span>
      <button type="button" className="ui-icon-btn" aria-label="Next slide" title="Next (→ or Space)" disabled={info.index >= info.count - 1} onClick={() => stepPresenting(editor, "next")}>
        <Icon name="chevron" />
      </button>
      <span className="kasten-present-sep" aria-hidden="true" />
      <button type="button" className="ui-icon-btn" aria-label="End the presentation" title="End (Esc)" onClick={() => endPresenting(editor)}>
        <Icon name="close" />
      </button>
    </div>
  );
}

import { type CSSProperties, type JSX, type KeyboardEvent, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { dispatchKey } from "../commands/index.ts";
import { lintOf } from "../lint/service.ts";
import { addSlide } from "../new-slide.ts";
import type { EditorSession } from "../session/session.ts";
import type { EditorUi } from "../ui-state.ts";
import { useEditorValue } from "../useEditor.ts";
import { useUiState } from "../useUi.ts";
import { DragBadge } from "./DragBadge.tsx";
import { collapseSelection, jumpShown, selectEvery, stepShown } from "./keys.ts";
import { BACKUP_W, FRAME, SECTION_H, THUMB_W, entryOf, gapAt, gapShifts, layoutFilmstrip, sectionOf, thumbHeight, visibleIds } from "./model.ts";
import { NewSlideButton } from "./NewSlideButton.tsx";
import { type Drop, type Spot, useReorder } from "./reorder.ts";
import { openSlideMenu, pickSection, pickSlide, slidesOfSection } from "./picking.ts";
import { useGapShifts, useLanding, useRowMotion } from "./row-motion.ts";
import { type RowHandlers, SectionHeader, SlideRow } from "./SlideRow.tsx";
import { useImageUrl, useThumbDeck } from "./SlideThumb.tsx";
import { nearWindow, useScrollWindow } from "./useScrollWindow.ts";
import "./filmstrip.css";

/** Thumbnails are drawn this far (in pixels) beyond the window on either side, so scrolling meets them ready. */
const AHEAD = 600;
/** A drag still counts as over the list this far to either side of it. */
const REACH = 80;

/** The slides down the left, as thumbnails. */
export function Filmstrip({ session, ui }: { session: EditorSession; ui: EditorUi }): JSX.Element {
  const deck = useEditorValue(session, (state) => state.deck);
  const shown = useEditorValue(session, (state) => state.slideId);
  const selection = useEditorValue(session, (state) => state.slideSelection);
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const scroller = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const viewport = useScrollWindow(scroller);
  const prefix = useId();
  const imageUrl = useImageUrl(session);
  const thumbDeck = useThumbDeck(deck);
  const service = useMemo(() => lintOf(session), [session]);
  // Lint flags the slides here only when the person asked for the badges; with them off it does no work at all.
  const badges = useUiState(ui).lintBadges;
  useEffect(() => {
    service.setBackground(badges);
    return () => service.setBackground(false);
  }, [service, badges]);
  const lint = badges ? service : null;

  const layout = useMemo(() => layoutFilmstrip(deck, folded), [deck.slides, deck.sections, deck.size, folded]);
  const latest = useRef(layout);
  latest.current = layout;
  // Where slides that were in the hand were put down, so that the rows do not glide to places they already made room at.
  const landing = useRef<Drop | null>(null);
  // Slides that move go to their new places, and a new slide slides in, unless the motion setting is off.
  useRowMotion(list, scroller, layout, landing);
  // A slide that is gone from the deck leaves its row behind for a moment, folding away; the ids are known before the rows go.
  const known = useRef<readonly string[]>([]);
  const leaving = useRef<ReadonlySet<string>>(new Set());
  const nowIds = new Set(deck.slides.map((slide) => slide.id));
  leaving.current = new Set(known.current.filter((id) => !nowIds.has(id)));
  useLayoutEffect(() => {
    known.current = [...nowIds];
  });
  // Select all, from the Edit menu or a right click, takes every slide that can be seen (a folded section hides its own).
  useEffect(() => ui.areas.register("slides", () => selectEvery(session, visibleIds(latest.current))), [ui, session]);

  const toggleSection = useCallback((key: string) => {
    setFolded((now) => {
      const next = new Set(now);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

  const renameSection = useCallback((at: string, title: string) => session.slides.renameSection(at, title), [session]);
  // The name of a section picks its slides, and the list has the keys from then on (Delete and the copy keys are about the slides).
  const pickInSection = useCallback(
    (key: string) => {
      pickSection(session, key);
      list.current?.focus({ preventScroll: true });
    },
    [session],
  );

  // ---- reordering

  const locate = useCallback(
    (x: number, y: number): Spot | null => {
      const box = list.current?.getBoundingClientRect();
      if (!box || x < box.left - REACH || x > box.right + REACH) return null;
      return { gap: gapAt(latest.current, y - box.top, session.state.deck.slides.length) };
    },
    [session],
  );
  const frameOf = useCallback((id: string) => list.current?.querySelector<HTMLElement>(`.ks-fs-row[data-slide="${id}"] .ks-fs-frame`) ?? null, []);
  const onDrop = useCallback((drop: Drop) => {
    landing.current = drop;
  }, []);
  const reorder = useReorder({ session, locate, scroller, frameOf, onDrop });
  const { drag } = reorder;
  // With slides in the hand over the list, the rows close up where they were taken from and open a gap where they would land.
  const shifts = useMemo(() => (drag?.spot ? gapShifts(layout, new Set(drag.ids), drag.spot.gap) : null), [layout, drag]);
  useGapShifts(list, shifts);
  useLanding(list, landing, drag !== null);

  // ---- following the shown slide

  // A slide that is shown from somewhere else is scrolled to; a section that hides it opens.
  const reveal = useRef(true);
  useLayoutEffect(() => {
    reveal.current = true;
  }, [shown]);
  useLayoutEffect(() => {
    const element = scroller.current;
    const entry = entryOf(layout, shown);
    if (!reveal.current || !element || !entry) return;
    reveal.current = false;
    const room = element.clientHeight;
    if (room <= 0) return;
    const margin = 8;
    if (entry.top < element.scrollTop + margin) element.scrollTop = Math.max(0, entry.top - margin);
    else if (entry.top + entry.height > element.scrollTop + room - margin) element.scrollTop = entry.top + entry.height - room + margin;
  }, [shown, layout]);
  useEffect(() => {
    const section = sectionOf(session.state.deck, shown);
    if (section && folded.has(section.startsAt)) toggleSection(section.startsAt);
  }, [shown]);

  // ---- the pointer

  const handlers = useMemo<RowHandlers>(
    () => ({
      down: (event, id) => reorder.begin(event, id),
      click: (event, id) => {
        if (!reorder.swallowClick()) pickSlide(session, visibleIds(latest.current), event, id);
      },
      menu: (event, id) => {
        event.preventDefault();
        list.current?.focus({ preventScroll: true });
        openSlideMenu(session, ui, id, { x: event.clientX, y: event.clientY });
      },
      leaving,
    }),
    [session, ui, reorder.begin, reorder.swallowClick],
  );

  // ---- the keyboard

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    const seen = visibleIds(layout);
    const stop = () => event.preventDefault();
    if (plain && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      stop();
      stepShown(session, seen, event.key === "ArrowDown" ? 1 : -1, event.shiftKey);
    } else if (plain && (event.key === "Home" || event.key === "End")) {
      stop();
      jumpShown(session, seen, event.key === "Home" ? "first" : "last", event.shiftKey);
    } else if (plain && !event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      // Left folds the section the shown slide is in, and right opens it again.
      const section = sectionOf(session.state.deck, shown);
      if (section && folded.has(section.startsAt) === (event.key === "ArrowRight")) toggleSection(section.startsAt);
      if (section) stop();
    } else if (plain && !event.shiftKey && event.key === "Enter") {
      // As in every slide editor: Enter in the list of slides adds one after the slide shown, and shows it.
      stop();
      addSlide(session, ui, { after: shown });
    } else if (plain && !event.shiftKey && event.key === "Tab") {
      // Tab goes on to the slide itself, as the eye does.
      stop();
      const root = list.current?.closest(".ks-editor") ?? document;
      root.querySelector<HTMLElement>(".ks-stage")?.focus();
    } else if (event.key === "Escape") {
      if (collapseSelection(session)) stop();
    } else if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && (event.key.toLowerCase() === "a" || event.code === "KeyA")) {
      stop();
      selectEvery(session, seen);
    } else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      stop();
      const box = document.getElementById(`${prefix}${shown}`)?.getBoundingClientRect();
      ui.openContextMenu({ kind: "slide", x: (box?.left ?? 0) + 40, y: (box?.top ?? 0) + 20 });
    } else if (dispatchKey(event.nativeEvent, { session, ui }, "filmstrip")) {
      // The command marked the browser's event; mark React's copy of it too, as the keys above do, for any handler further up that reads it.
      event.preventDefault();
    }
  };

  // ---- what is drawn

  // The sizes of a row and its thumbnail are set here once and used by the stylesheet, so they are the numbers the layout was worked out with.
  const sizes = {
    height: layout.height,
    "--fs-row": `${layout.rowHeight}px`,
    "--fs-section": `${SECTION_H}px`,
    "--fs-w": `${THUMB_W + FRAME}px`,
    "--fs-h": `${thumbHeight(deck.size) + FRAME}px`,
    "--fs-bw": `${BACKUP_W + FRAME}px`,
    "--fs-bh": `${thumbHeight(deck.size, BACKUP_W) + FRAME}px`,
  } as CSSProperties;
  const chosen = new Set(selection);
  const moving = drag ? new Set(drag.ids) : null;
  // A header says it is picked when the slides picked are exactly its own, two or more (one slide is only the slide shown).
  const pickedSections = new Set<string>();
  if (chosen.size > 1) {
    for (const entry of layout.entries) {
      if (entry.kind !== "header") continue;
      const own = slidesOfSection(deck, entry.key);
      if (own.length === chosen.size && own.every((id) => chosen.has(id))) pickedSections.add(entry.key);
    }
  }

  return (
    <div
      ref={scroller}
      className="ks-filmstrip"
      onPointerDown={(event) => {
        // Bare space of the list (beside or below the slides) is a press on the list: what was selected on the slide is let go, and the
        // list has the keys. The slides stay as they were picked.
        if (event.button === 0 && (event.target === event.currentTarget || event.target === list.current)) {
          session.select([]);
          list.current?.focus({ preventScroll: true });
        }
      }}
      onDoubleClick={(event) => {
        // Empty space between and below the slides adds one.
        if (event.target === event.currentTarget || event.target === list.current) addSlide(session, ui);
      }}
    >
      <div
        ref={list}
        className={`ks-fs-list${drag ? " is-dragging" : ""}${drag?.spot ? " is-shifted" : ""}`}
        role="listbox"
        aria-label="Slides"
        aria-multiselectable="true"
        aria-activedescendant={entryOf(layout, shown) ? `${prefix}${shown}` : undefined}
        tabIndex={0}
        style={sizes}
        onKeyDown={onKeyDown}
      >
        {layout.entries.map((entry) =>
          entry.kind === "header" ? (
            <SectionHeader
              key={`section-${entry.key}`}
              name={entry.key}
              title={entry.section.title}
              count={entry.count}
              collapsed={entry.collapsed}
              toggle={toggleSection}
              ui={ui}
              rename={renameSection}
              menu={handlers.menu}
              pick={pickInSection}
              picked={pickedSections.has(entry.key)}
            />
          ) : (
            <SlideRow
              key={entry.id}
              slide={entry.slide}
              index={entry.index}
              count={deck.slides.length}
              backup={entry.backup}
              deck={thumbDeck}
              shown={entry.id === shown}
              selected={chosen.has(entry.id)}
              dragging={moving?.has(entry.id) ?? false}
              thumb={nearWindow(viewport, entry.top, entry.height, AHEAD)}
              imageUrl={imageUrl}
              domId={`${prefix}${entry.id}`}
              handlers={handlers}
              lint={lint}
            />
          ),
        )}
        <DragBadge drag={drag} badge={reorder.badge} />
      </div>
      <NewSlideButton session={session} ui={ui} />
    </div>
  );
}

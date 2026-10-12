import { type CSSProperties, type JSX, type KeyboardEvent, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef } from "react";

import { dispatchKey } from "../commands/index.ts";
import { DragBadge } from "../filmstrip/DragBadge.tsx";
import { collapseSelection, jumpShown, selectEvery, stepShown } from "../filmstrip/keys.ts";
import { openSlideMenu, pickSlide } from "../filmstrip/picking.ts";
import { type Spot, planMove, useReorder } from "../filmstrip/reorder.ts";
import { useImageUrl, useThumbDeck } from "../filmstrip/SlideThumb.tsx";
import { nearWindow, useScrollWindow } from "../filmstrip/useScrollWindow.ts";
import type { EditorSession } from "../session/session.ts";
import type { EditorUi } from "../ui-state.ts";
import { useEditorValue } from "../useEditor.ts";
import { useElementSize } from "../useElementSize.ts";
import "./grid.css";
import { GAP_X, GAP_Y, OUTER_W, PAD, geometryOf, lineAt, spotAt, tileAt } from "./layout.ts";
import { Tile, type TileHandlers } from "./Tile.tsx";

/** Thumbnails are drawn this far (in pixels) beyond the window on either side, so scrolling meets them ready. */
const AHEAD = 500;
/** A drag still counts as over the grid this far outside it. */
const REACH = 80;
/** The width assumed of a scroller that reports none, such as one in a test. */
const FALLBACK_WIDTH = 1200;

/** Every slide at once, to reorder and pick from. */
export function GridView({ session, ui }: { session: EditorSession; ui: EditorUi }): JSX.Element {
  const deck = useEditorValue(session, (state) => state.deck);
  const shown = useEditorValue(session, (state) => state.slideId);
  const selection = useEditorValue(session, (state) => state.slideSelection);
  const scroller = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const width = useElementSize(scroller).w;
  const viewport = useScrollWindow(scroller);
  const prefix = useId();
  const imageUrl = useImageUrl(session);
  const thumbDeck = useThumbDeck(deck);

  const order = useMemo(() => deck.slides.map((slide) => slide.id), [deck.slides]);
  const geometry = useMemo(() => geometryOf(deck.size, width || FALLBACK_WIDTH), [deck.size, width]);
  const latest = useRef({ order, geometry });
  latest.current = { order, geometry };

  // ---- reordering

  const locate = useCallback(
    (x: number, y: number): Spot | null => {
      const box = grid.current?.getBoundingClientRect();
      const around = scroller.current?.getBoundingClientRect();
      if (!box || !around || x < around.left - REACH || x > around.right + REACH || y < around.top - REACH || y > around.bottom + REACH) return null;
      return spotAt(x - box.left, y - box.top, latest.current.order.length, latest.current.geometry);
    },
    [],
  );
  // The slides in the hand are copies of their thumbnails, held under the pointer as in the filmstrip.
  const frameOf = useCallback((id: string) => grid.current?.querySelector<HTMLElement>(`[data-slide="${id}"] .ks-gv-frame`) ?? null, []);
  const reorder = useReorder({ session, locate, scroller, frameOf });
  const { drag } = reorder;

  // ---- following the shown slide

  const reveal = useRef(true);
  useLayoutEffect(() => {
    reveal.current = true;
  }, [shown]);
  useLayoutEffect(() => {
    const element = scroller.current;
    const at = order.indexOf(shown);
    if (!reveal.current || !element || at < 0) return;
    reveal.current = false;
    const room = element.clientHeight;
    if (room <= 0) return;
    const from = PAD + tileAt(at, geometry).top;
    const to = from + geometry.tileHeight;
    if (from < element.scrollTop + PAD / 2) element.scrollTop = Math.max(0, from - PAD);
    else if (to > element.scrollTop + room - PAD / 2) element.scrollTop = to - room + PAD;
  }, [shown, order, geometry]);

  // Select all, from the Edit menu or a right click, takes every slide of the grid.
  useEffect(() => ui.areas.register("slides", () => selectEvery(session, latest.current.order)), [ui, session]);

  // Coming here from another view, the keys work at once, unless someone is typing.
  useEffect(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !active.closest("input, textarea, select, [contenteditable='true']")) scroller.current?.focus({ preventScroll: true });
  }, []);

  // ---- the pointer

  const handlers = useMemo<TileHandlers>(
    () => ({
      down: (event, id) => reorder.begin(event, id),
      click: (event, id) => {
        if (!reorder.swallowClick()) pickSlide(session, latest.current.order, event, id);
      },
      open: (id) => {
        session.goTo(id);
        ui.setView("edit");
      },
      menu: (event, id) => {
        event.preventDefault();
        scroller.current?.focus({ preventScroll: true });
        openSlideMenu(session, ui, id, { x: event.clientX, y: event.clientY });
      },
    }),
    [session, ui, reorder.begin, reorder.swallowClick],
  );

  // ---- the keyboard

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    const stop = () => event.preventDefault();
    const across = geometry.columns;
    if (plain && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      stop();
      stepShown(session, order, event.key === "ArrowRight" ? 1 : -1, event.shiftKey);
    } else if (plain && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      stop();
      stepShown(session, order, event.key === "ArrowDown" ? across : -across, event.shiftKey);
    } else if (plain && (event.key === "Home" || event.key === "End")) {
      stop();
      jumpShown(session, order, event.key === "Home" ? "first" : "last", event.shiftKey);
    } else if (plain && !event.shiftKey && event.key === "Enter") {
      stop();
      handlers.open(session.state.slideId);
    } else if (event.key === "Escape") {
      if (collapseSelection(session)) stop();
    } else if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && (event.key.toLowerCase() === "a" || event.code === "KeyA")) {
      stop();
      selectEvery(session, order);
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

  // The sizes of a tile and its thumbnail are set here once and used by the stylesheet, so they are the numbers the layout was worked out with.
  const sizes = {
    width: geometry.width,
    gridTemplateColumns: `repeat(${geometry.columns}, ${OUTER_W}px)`,
    gridAutoRows: `${geometry.tileHeight}px`,
    columnGap: GAP_X,
    rowGap: GAP_Y,
    "--gv-w": `${OUTER_W}px`,
    "--gv-h": `${geometry.tileHeight}px`,
    "--gv-frame": `${geometry.frameHeight}px`,
  } as CSSProperties;
  const chosen = new Set(selection);
  const moving = drag ? new Set(drag.ids) : null;
  const line = drag?.spot && planMove(order, drag.ids, drag.spot.gap).changed ? lineAt(drag.spot, order.length, geometry) : null;

  return (
    <div
      ref={scroller}
      className="ks-grid-view"
      role="listbox"
      aria-label="Slides"
      aria-multiselectable="true"
      aria-activedescendant={order.includes(shown) ? `${prefix}${shown}` : undefined}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        // Bare space (round the tiles and between them) is a press on the grid itself: the slides picked go back to the one shown.
        if (event.button === 0 && (event.target === event.currentTarget || event.target === grid.current)) {
          session.select([]);
          scroller.current?.focus({ preventScroll: true });
        }
      }}
    >
      <div
        ref={grid}
        className={`ks-gv-grid${drag ? " is-dragging" : ""}`}
        style={sizes}
      >
        {deck.slides.map((slide, index) => (
          <Tile
            key={slide.id}
            slide={slide}
            index={index}
            count={order.length}
            backup={slide.backup === true && index > 0}
            deck={thumbDeck}
            shown={slide.id === shown}
            selected={chosen.has(slide.id)}
            dragging={moving?.has(slide.id) ?? false}
            thumb={nearWindow(viewport, PAD + tileAt(index, geometry).top, geometry.tileHeight, AHEAD)}
            imageUrl={imageUrl}
            domId={`${prefix}${slide.id}`}
            handlers={handlers}
          />
        ))}
        {line ? <div className="ks-gv-drop" style={{ left: line.left, top: line.top, height: geometry.frameHeight }} aria-hidden="true" /> : null}
      </div>
      <DragBadge drag={drag} badge={reorder.badge} />
    </div>
  );
}

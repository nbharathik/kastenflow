// The presenter's view: the slide as it is on the audience's screen at the step it is at, the next step or slide, the
// speaker notes (their type size changes with Ctrl + and Ctrl -), how long the talk has gone on, the time, and where in the
// slide's steps the talk is. It shows the deck it is given and follows the position it is given; a key or a button here asks for
// a move, and the caller sends it on, so the presenter's window can drive the audience's as well as follow it.

import type { Deck } from "@kasten-slides/wasm";
import { type JSX, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SlideView } from "../render/index.ts";
import type { ImageUrl } from "../render/index.ts";
import type { InkStore } from "./ink/store.ts";
import { LazyLiveLayer } from "./LazyLiveLayer.tsx";
import type { MediaChannel } from "./media.ts";
import { Notes } from "./notes.tsx";
import { type Direction, type Position, type Spot, move, planOf, samePosition, spotAt } from "./plan.ts";
import { Fit } from "./presenter-layout/Fit.tsx";
import { SIDE_MAX, SIDE_MIN, handleOfSplit, handleRange, splitOfHandle, tracks } from "./presenter-layout/layout.ts";
import { Splitter } from "./presenter-layout/Splitter.tsx";
import { useLayout } from "./presenter-layout/useLayout.ts";
import { PresenterClock } from "./PresenterClock.tsx";
import { target, usePresenterKeys } from "./presenter-keys.ts";
import { stopwatchFrom, toggled } from "./stopwatch.ts";
import { type RehearsalSetup, useRehearsal } from "./useRehearsal.ts";
import "./presenter.css";
import "./presenter-layout/layout.css";

// The ink tools and the run-through's bar and summary come up after the slide and the notes do.
const InkTools = lazy(async () => ({ default: (await import("./ink/PresenterInk.tsx")).InkTools }));
const InkLayer = lazy(async () => ({ default: (await import("./ink/InkLayer.tsx")).InkLayer }));
const InkKeys = lazy(async () => ({ default: (await import("./ink/PresenterInk.tsx")).InkKeys }));
const LayoutMenu = lazy(async () => ({ default: (await import("./presenter-layout/LayoutMenu.tsx")).LayoutMenu }));
const RehearsalBar = lazy(async () => ({ default: (await import("./RehearsalBar.tsx")).RehearsalBar }));
const RehearsalSummary = lazy(async () => ({ default: (await import("./RehearsalSummary.tsx")).RehearsalSummary }));

export interface PresenterProps {
  deck: Deck;
  imageUrl: ImageUrl;
  /** Where the audience is. */
  position: Position;
  /** The black screen is up on the audience's screen. */
  paused: boolean;
  /** When the talk began, in milliseconds. */
  since: number;
  /** Asks for the audience to be taken to a position, and to have its black screen up or down. */
  onGo(position: Position, paused?: boolean): void;
  /** Escape was pressed with nothing else to put away: the show is to end. */
  onEnd?: () => void;
  /** The presenter closed the view. */
  onClose?: () => void;
  /** The presenter asked for the show and this view to change screens. A button appears when it is given. */
  onSwapScreens?: () => void;
  /** Where rehearsals are kept. With it the view can time a run-through; without it there are no rehearsal controls. */
  rehearsal?: RehearsalSetup;
  /** The ink on the slide: with it the view draws, shows the ink of the audience's screen, and has the pen, the highlighter and the laser. */
  ink?: InkStore;
  /** The videos' link to the audience's window: with it the slide's embeds and videos are live here (muted) and play together with that window's. */
  media?: MediaChannel;
}

const NOTES_SIZES = [12, 13, 14, 16, 18, 20, 24, 28, 32, 40, 48];
const SIZE_KEY = "kasten-slides-presenter-notes-size";

function savedSize(): number {
  try {
    const stored = Number(localStorage.getItem(SIZE_KEY));
    return NOTES_SIZES.includes(stored) ? stored : 18;
  } catch {
    return 18;
  }
}

export { elapsedText } from "./PresenterClock.tsx";
export { moveOfKey } from "./presenter-keys.ts";

/** The deck's wording for "step 2 of 5". */
export function stepText(deck: Deck, step: number, steps: number): string {
  return deck.present.stepLabel.replaceAll("{n}", String(step)).replaceAll("{total}", String(steps));
}

export function Presenter({ deck, imageUrl, position, paused, since, onGo, onEnd, onClose, onSwapScreens, rehearsal, ink, media }: PresenterProps): JSX.Element {
  const plan = useMemo(() => planOf(deck), [deck]);
  const spot = spotAt(plan, position);
  // The ink goes with the slide, as it does in the show.
  const slideId = spot?.slide.id ?? null;
  useEffect(() => {
    ink?.setSlide(slideId);
  }, [ink, slideId]);
  // Esc puts the pen or the laser down before it asks to end the show.
  const putDown = useCallback((): boolean => {
    const held = ink?.getSnapshot();
    if (!ink || !held || (held.tool === null && !held.laser)) return false;
    ink.setTool(null);
    ink.setLaser(false);
    return true;
  }, [ink]);
  const ahead = move(plan, position, "right");
  const nextSpot = samePosition(ahead, position) ? null : spotAt(plan, ahead);
  // Timing a run-through: the same position that is on the screen, never a move of its own.
  const rehearsing = useRehearsal(deck, spot ? { slide: spot.slide.id, step: spot.step } : null, rehearsal);
  const [watch, setWatch] = useState(() => stopwatchFrom(since));
  const [size, setSize] = useState(savedSize);
  const root = useRef<HTMLDivElement>(null);
  const bodyBox = useRef<HTMLElement>(null);
  const sideBox = useRef<HTMLElement>(null);
  const controls = useLayout();
  const { layout, narrow } = controls;
  const { show, swap } = layout;
  const toggleTimer = useCallback(() => setWatch((now) => toggled(now, Date.now())), []);
  const resetTimer = useCallback(() => setWatch(stopwatchFrom(Date.now())), []);

  const resize = useCallback((by: number | "reset") => {
    setSize((current) => {
      const at = by === "reset" ? NOTES_SIZES.indexOf(18) : Math.min(Math.max(NOTES_SIZES.indexOf(current) + by, 0), NOTES_SIZES.length - 1);
      const next = NOTES_SIZES[at] ?? 18;
      try {
        localStorage.setItem(SIZE_KEY, String(next));
      } catch {
        // The size is only not kept.
      }
      return next;
    });
  }, []);

  // The window that is opened for the speaker has the keys at once.
  useEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, []);
  const { typed, endArmed } = usePresenterKeys({ plan, position, paused, onGo, onEnd, onResize: resize, onToggleTimer: toggleTimer, onResetTimer: resetTimer, onEscape: putDown });

  const go = (key: Direction) => () => onGo(target(plan, position, key));
  const stepLabel = spot && spot.steps > 0 ? stepText(deck, spot.step, spot.steps) : "No steps";

  // The two steps or slides after the next one, for the "Then" strip.
  const thenSpots: Spot[] = [];
  if (layout.then && nextSpot) {
    let at = ahead;
    for (let i = 0; i < 2; i++) {
      const after = move(plan, at, "right");
      const found = samePosition(after, at) ? null : spotAt(plan, after);
      if (!found) break;
      thenSpots.push(found);
      at = after;
    }
  }
  const thumb = (of: Spot) => <SlideView deck={deck} slide={of.slide} number={plan.numbers.get(of.slide.id) ?? 0} count={plan.count} step={of.steps > 0 ? of.step : undefined} mode="thumbnail" imageUrl={imageUrl} />;

  const showSide = show.next || show.notes;
  const together = show.now && showSide;
  const nowPanel = show.now ? (
    <section key="now" className="ks-pv-now" aria-label="Slide now">
      <Fit deck={deck}>
        {spot ? (
          <div className="ks-show-slide" style={{ width: deck.size.w, height: deck.size.h }}>
            <SlideView deck={deck} slide={spot.slide} number={plan.numbers.get(spot.slide.id) ?? 0} count={plan.count} step={spot.steps > 0 ? spot.step : undefined} mode="present" imageUrl={imageUrl} />
            {media ? <LazyLiveLayer deck={deck} slide={spot.slide} step={spot.step} imageUrl={imageUrl} media={media} /> : null}
            {ink ? (
              <Suspense fallback={null}>
                <InkLayer store={ink} aspect={deck.size.h / deck.size.w} />
              </Suspense>
            ) : null}
          </div>
        ) : null}
      </Fit>
    </section>
  ) : null;
  const nextPanel = show.next ? (
    <section key="next" className="ks-pv-next" aria-label="Next">
      <h2 className="ks-pv-heading">{nextSpot ? (nextSpot.slide.id === spot?.slide.id ? "Next step" : "Next slide") : "End of the talk"}</h2>
      {nextSpot ? <Fit deck={deck}>{thumb(nextSpot)}</Fit> : null}
      {thenSpots.length > 0 ? (
        <div className="ks-pv-then" aria-label="Then">
          <span className="ks-pv-then-label">Then…</span>
          {thenSpots.map((of) => (
            <Fit key={`${of.slide.id}:${of.step}`} deck={deck} strip>
              {thumb(of)}
            </Fit>
          ))}
        </div>
      ) : null}
    </section>
  ) : null;
  const notesPanel = show.notes ? (
    <section key="notes" className="ks-pv-notes" aria-label="Speaker notes">
      <div className="ks-pv-notes-head">
        <h2 className="ks-pv-heading">Notes</h2>
        <span className="ks-pv-sizes">
          <button type="button" className="ks-pv-button is-small" onClick={() => resize(-1)} title="Smaller (Ctrl -)" aria-label="Smaller notes">
            A−
          </button>
          <button type="button" className="ks-pv-button is-small" onClick={() => resize(1)} title="Larger (Ctrl +)" aria-label="Larger notes">
            A+
          </button>
        </span>
      </div>
      <div className="ks-pv-notes-text" style={{ fontSize: size }}>
        {spot?.slide.notes && spot.slide.notes.trim() !== "" ? <Notes markdown={spot.slide.notes} /> : <p className="ks-pv-none">No notes on this slide.</p>}
      </div>
    </section>
  ) : null;

  const sideBar =
    show.next && show.notes ? (
      <Splitter key="side-bar" orientation="horizontal" label="Resize the next slide and the notes" value={layout.side} min={SIDE_MIN} max={SIDE_MAX} container={sideBox} onChange={controls.setSide} onReset={() => controls.resetSplitter("side")} />
    ) : null;
  const side = showSide ? (
    <aside key="side" ref={sideBox} className="ks-pv-side" style={{ gridTemplateRows: tracks(sideBar ? layout.side : null) }}>
      {nextPanel}
      {sideBar}
      {notesPanel}
    </aside>
  ) : null;
  const [lo, hi] = handleRange(layout);
  const bar = together ? (
    <Splitter
      key="bar"
      orientation={narrow ? "horizontal" : "vertical"}
      label={narrow ? "Resize the slide and the rest" : "Resize the slide and the side column"}
      value={handleOfSplit(layout)}
      min={lo}
      max={hi}
      container={bodyBox}
      onChange={(handle) => controls.setSplit(splitOfHandle(layout, handle))}
      onReset={() => controls.resetSplitter("split")}
    />
  ) : null;
  const first = swap ? 1 - layout.split : layout.split;
  const bodyTracks = narrow ? { gridTemplateRows: tracks(together ? first : null) } : { gridTemplateColumns: tracks(together ? first : null) };

  return (
    <div ref={root} className="ks-presenter" tabIndex={-1}>
      <header className="ks-pv-head">
        <h1 className="ks-pv-title">{deck.title}</h1>
        <span className="ks-pv-fact" data-fact="slide">
          Slide {spot ? (plan.numbers.get(spot.slide.id) ?? 0) : 0} / {plan.count}
        </span>
        <span className="ks-pv-fact" data-fact="step">
          {stepLabel}
        </span>
        {show.clock ? <PresenterClock watch={watch} onToggle={toggleTimer} onReset={resetTimer} /> : null}
        {typed !== "" ? (
          <span className="ks-pv-fact ks-pv-jump" role="status">
            Go to slide {typed}  ↵
          </span>
        ) : null}
        {endArmed ? (
          <span className="ks-pv-fact ks-pv-jump" role="status">
            Press Esc again to end the show
          </span>
        ) : null}
        <Suspense fallback={null}>
          <LayoutMenu controls={controls} />
        </Suspense>
        {onSwapScreens ? (
          <button type="button" className="ks-pv-button" onClick={onSwapScreens}>
            Swap screens
          </button>
        ) : null}
        {onClose ? (
          <button type="button" className="ks-pv-button" onClick={onClose}>
            Close
          </button>
        ) : null}
      </header>

      <main ref={bodyBox} className={narrow ? "ks-pv-body is-stacked" : "ks-pv-body"} style={bodyTracks}>
        {swap ? [side, bar, nowPanel] : [nowPanel, bar, side]}
      </main>
      <footer className="ks-pv-foot">
        <div className="ks-pv-controls">
          <button type="button" className="ks-pv-button" onClick={go("left")} disabled={samePosition(target(plan, position, "left"), position)}>
            Back
          </button>
          <button type="button" className="ks-pv-button is-primary" onClick={go("right")} disabled={samePosition(ahead, position)}>
            Next
          </button>
          <button type="button" className="ks-pv-button" aria-pressed={paused} onClick={() => onGo(position, !paused)}>
            {paused ? "Show the slide" : "Black screen"}
          </button>
        </div>
        <Suspense fallback={null}>
          {ink ? <InkTools store={ink} pickers always /> : null}
          {rehearsing ? <RehearsalBar rehearsing={rehearsing} /> : null}
        </Suspense>
      </footer>
      <Suspense fallback={null}>{ink ? <InkKeys store={ink} /> : null}</Suspense>
      {rehearsing?.finished ? (
        <Suspense fallback={null}>
          <RehearsalSummary deck={deck} record={rehearsing.finished.record} comparison={rehearsing.finished.comparison} saved={rehearsing.finished.saved} error={rehearsing.finished.error} onSave={rehearsing.save} onDiscard={rehearsing.discard} />
        </Suspense>
      ) : null}
    </div>
  );
}

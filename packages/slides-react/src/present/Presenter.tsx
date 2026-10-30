// The presenter's view: the slide as it is on the audience's screen at the step it is at, the next step or slide, the
// speaker notes (their type size changes with Ctrl + and Ctrl -), how long the talk has gone on, the time, and where in the
// slide's steps the talk is. It shows the deck it is given and follows the position it is given; a key or a button here asks for
// a move, and the caller sends it on, so the presenter's window can drive the audience's as well as follow it.

import type { Deck } from "@kasten-slides/wasm";
import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SlideView } from "../render/index.ts";
import type { ImageUrl } from "../render/index.ts";
import { Notes } from "./notes.tsx";
import { type Direction, type Position, move, planOf, samePosition, spotAt } from "./plan.ts";
import { PresenterClock } from "./PresenterClock.tsx";
import { target, usePresenterKeys } from "./presenter-keys.ts";
import { RehearsalBar } from "./RehearsalBar.tsx";
import { RehearsalSummary } from "./RehearsalSummary.tsx";
import { Scaled } from "./ScrollView.tsx";
import { stopwatchFrom, toggled } from "./stopwatch.ts";
import { type RehearsalSetup, useRehearsal } from "./useRehearsal.ts";
import "./presenter.css";
import "./rehearsal.css";

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

export function Presenter({ deck, imageUrl, position, paused, since, onGo, onEnd, onClose, onSwapScreens, rehearsal }: PresenterProps): JSX.Element {
  const plan = useMemo(() => planOf(deck), [deck]);
  const spot = spotAt(plan, position);
  const ahead = move(plan, position, "right");
  const nextSpot = samePosition(ahead, position) ? null : spotAt(plan, ahead);
  // Timing a run-through: the same position that is on the screen, never a move of its own.
  const rehearsing = useRehearsal(deck, spot ? { slide: spot.slide.id, step: spot.step } : null, rehearsal);
  const [watch, setWatch] = useState(() => stopwatchFrom(since));
  const [size, setSize] = useState(savedSize);
  const root = useRef<HTMLDivElement>(null);
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
  const { typed, endArmed } = usePresenterKeys({ plan, position, paused, onGo, onEnd, onResize: resize, onToggleTimer: toggleTimer, onResetTimer: resetTimer });

  const go = (key: Direction) => () => onGo(target(plan, position, key));
  const stepLabel = spot && spot.steps > 0 ? stepText(deck, spot.step, spot.steps) : "No steps";

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
        <PresenterClock watch={watch} onToggle={toggleTimer} onReset={resetTimer} />
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

      <main className="ks-pv-body">
        <section className="ks-pv-now" aria-label="Slide now">
          <Scaled deck={deck}>
            {spot ? <SlideView deck={deck} slide={spot.slide} number={plan.numbers.get(spot.slide.id) ?? 0} count={plan.count} step={spot.steps > 0 ? spot.step : undefined} mode="present" imageUrl={imageUrl} /> : null}
          </Scaled>
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
          {rehearsing ? <RehearsalBar rehearsing={rehearsing} /> : null}
        </section>

        <aside className="ks-pv-side">
          <section className="ks-pv-next" aria-label="Next">
            <h2 className="ks-pv-heading">{nextSpot ? (nextSpot.slide.id === spot?.slide.id ? "Next step" : "Next slide") : "End of the talk"}</h2>
            {nextSpot ? (
              <Scaled deck={deck}>
                <SlideView deck={deck} slide={nextSpot.slide} number={plan.numbers.get(nextSpot.slide.id) ?? 0} count={plan.count} step={nextSpot.steps > 0 ? nextSpot.step : undefined} mode="thumbnail" imageUrl={imageUrl} />
              </Scaled>
            ) : null}
          </section>
          <section className="ks-pv-notes" aria-label="Speaker notes">
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
        </aside>
      </main>
      {rehearsing?.finished ? (
        <RehearsalSummary deck={deck} record={rehearsing.finished.record} comparison={rehearsing.finished.comparison} saved={rehearsing.finished.saved} error={rehearsing.finished.error} onSave={rehearsing.save} onDiscard={rehearsing.discard} />
      ) : null}
    </div>
  );
}

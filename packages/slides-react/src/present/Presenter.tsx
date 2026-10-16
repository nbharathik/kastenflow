// The presenter's view: the slide as it is on the audience's screen at the step it is at, the next step or slide, the
// speaker notes (their type size changes with Ctrl + and Ctrl -), how long the talk has gone on, the time, and where in the
// slide's steps the talk is. It shows the deck it is given and follows the position it is given; a key or a button here asks for
// a move, and the caller sends it on, so the presenter's window can drive the audience's as well as follow it.

import type { Deck } from "@kasten-slides/wasm";
import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SlideView } from "../render/index.ts";
import type { ImageUrl } from "../render/index.ts";
import { Notes } from "./notes.tsx";
import { type Direction, type Plan, type Position, firstPosition, lastPosition, move, planOf, samePosition, spotAt } from "./plan.ts";
import { RehearsalBar } from "./RehearsalBar.tsx";
import { RehearsalSummary } from "./RehearsalSummary.tsx";
import { Scaled } from "./ScrollView.tsx";
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
  /** The presenter closed the view. */
  onClose?: () => void;
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

/** The clock's time and how long the talk has gone on, refreshed each second. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  return now;
}

const two = (n: number): string => String(n).padStart(2, "0");

/** `12:03` or `1:12:03`. */
export function elapsedText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h > 0 ? `${h}:${two(m)}:${two(total % 60)}` : `${two(m)}:${two(total % 60)}`;
}

/** The deck's wording for "step 2 of 5". */
export function stepText(deck: Deck, step: number, steps: number): string {
  return deck.present.stepLabel.replaceAll("{n}", String(step)).replaceAll("{total}", String(steps));
}

/** The keys of the presenter's view: the move each stands for. */
export function moveOfKey(event: Pick<KeyboardEvent, "key" | "shiftKey">): Direction | "first" | "last" | null {
  switch (event.key) {
    case "ArrowRight":
    case "PageDown":
    case "n":
    case "N":
      return "right";
    case " ":
      return event.shiftKey ? "left" : "right";
    case "ArrowLeft":
    case "PageUp":
    case "p":
    case "P":
      return "left";
    case "ArrowDown":
      return "down";
    case "ArrowUp":
      return "up";
    case "Home":
      return "first";
    case "End":
      return "last";
    default:
      return null;
  }
}

function target(plan: Plan, from: Position, key: Direction | "first" | "last"): Position {
  if (key === "first") return firstPosition();
  if (key === "last") return lastPosition(plan);
  // Up and down are for backup slides; in a deck without any they step like right and left.
  return move(plan, from, key);
}

export function Presenter({ deck, imageUrl, position, paused, since, onGo, onClose, rehearsal }: PresenterProps): JSX.Element {
  const plan = useMemo(() => planOf(deck), [deck]);
  const spot = spotAt(plan, position);
  const ahead = move(plan, position, "right");
  const nextSpot = samePosition(ahead, position) ? null : spotAt(plan, ahead);
  const now = useNow();
  // Timing a run-through: the same position that is on the screen, never a move of its own.
  const rehearsing = useRehearsal(deck, spot ? { slide: spot.slide.id, step: spot.step } : null, rehearsal);
  const [reset, setReset] = useState(since);
  const [size, setSize] = useState(savedSize);
  const root = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    root.current?.focus({ preventScroll: true });
    const keys = (event: KeyboardEvent) => {
      const command = event.ctrlKey || event.metaKey;
      if (command && (event.key === "+" || event.key === "=")) {
        event.preventDefault();
        resize(1);
      } else if (command && (event.key === "-" || event.key === "_")) {
        event.preventDefault();
        resize(-1);
      } else if (command && event.key === "0") {
        event.preventDefault();
        resize("reset");
      } else if (!command && !event.altKey && (event.key === "b" || event.key === "B")) {
        event.preventDefault();
        onGo(position, !paused);
      } else if (!command && !event.altKey) {
        const wanted = moveOfKey(event);
        if (!wanted) return;
        event.preventDefault();
        // In a deck without backup slides the arrows down and up are just as good as right and left.
        const key = !plan.columns.some((column) => column.slides.length > 1) ? (wanted === "down" ? "right" : wanted === "up" ? "left" : wanted) : wanted;
        onGo(target(plan, position, key));
      }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [plan, position, paused, onGo, resize]);

  const go = (key: Direction) => () => onGo(target(plan, position, key));
  const stepLabel = spot && spot.steps > 0 ? stepText(deck, spot.step, spot.steps) : "No steps";
  const clock = new Date(now);

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
        <span className="ks-pv-fact ks-pv-clock" data-fact="clock" aria-label="Time now">
          {two(clock.getHours())}:{two(clock.getMinutes())}
        </span>
        <span className="ks-pv-fact ks-pv-timer" data-fact="timer" role="timer" aria-label="Time spent">
          {elapsedText(now - reset)}
          <button type="button" className="ks-pv-button is-small" onClick={() => setReset(Date.now())} title="Start the timer again">
            Reset
          </button>
        </span>
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

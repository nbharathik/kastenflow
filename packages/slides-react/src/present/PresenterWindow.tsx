// The presenter's window as a page: it asks the audience's window for the deck, shows the presenter's view of it, and passes on
// every move it makes, while following the moves the audience's window makes. It keeps in touch: the show says it is there every
// couple of seconds, and when the show says goodbye or goes quiet the window goes back to waiting for one and asks again.

import type { Deck } from "@kasten-slides/wasm";
import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type Position, type RevealState, fromState, planOf, toState } from "./plan.ts";
import { Presenter } from "./Presenter.tsx";
import { type RehearsalStore, localRehearsals } from "./rehearsal-store.ts";
import type { PresentSync } from "./sync.ts";
import "./presenter.css";

/** The name in the address of the presenter's window: the page is opened with `?presenter=<what joins the two windows>`. */
export const PRESENTER_PARAM = "presenter";

/** What joins the two windows, when the address says this is the presenter's window; null otherwise. */
export function presenterOf(search: string): string | null {
  const value = new URLSearchParams(search).get(PRESENTER_PARAM);
  return value !== null && value !== "" ? value : null;
}

/** How long the show may say nothing before it is taken to be gone (it beats every 2 s). */
export const SILENCE_MS = 5000;

/** How often a window with no show asks for one. */
const ASK_MS = 1500;

interface Talk {
  deck: Deck;
  images: Record<string, string>;
  since: number;
}

export interface PresenterWindowProps {
  sync: PresentSync;
  /** Closes the window, where the page can (a button appears when it is given). */
  onClose?: () => void;
  /** Where rehearsals are kept; the page's own storage when left out. */
  rehearsals?: RehearsalStore;
}

export function PresenterWindow({ sync, onClose, rehearsals }: PresenterWindowProps): JSX.Element {
  const [talk, setTalk] = useState<Talk | null>(null);
  const [state, setState] = useState<RevealState>({ indexh: 0, indexv: 0 });
  const [ended, setEnded] = useState(false);
  const [rehearse, setRehearse] = useState(false);
  const local = useMemo(() => localRehearsals(), []);
  const rehearsal = useMemo(() => ({ store: rehearsals ?? local, autoStart: rehearse }), [rehearsals, local, rehearse]);
  const rehearsing = useRef(false);
  rehearsing.current = rehearse;
  const alive = useRef<ReturnType<typeof setTimeout> | null>(null);
  // When the talk it has began; null with none.
  const having = useRef<number | null>(null);

  // The show is gone (it said goodbye, or went quiet). A window that was timing a rehearsal keeps its view, so that the run is not lost;
  // any other goes back to waiting for a show.
  const lost = useCallback(() => {
    if (alive.current) clearTimeout(alive.current);
    alive.current = null;
    if (rehearsing.current) {
      setEnded(true);
    } else {
      having.current = null;
      setTalk(null);
      setEnded(false);
    }
    sync.post({ type: "hello" });
  }, [sync]);

  // The show was heard from: it is there for another while.
  const heard = useCallback(() => {
    if (alive.current) clearTimeout(alive.current);
    alive.current = setTimeout(lost, SILENCE_MS);
  }, [lost]);

  // Ask until the audience's window answers: it may not be there yet.
  useEffect(() => {
    const stop = sync.subscribe((message) => {
      if (message.type === "deck") {
        heard();
        setEnded(false);
        // The same talk given again (it was asked for twice) is not drawn again, and does not move the window to where the show was.
        if (having.current !== message.since) {
          having.current = message.since;
          // A new talk is no rehearsal until the show says so (it does, right after its deck).
          rehearsing.current = false;
          setRehearse(false);
          setState(message.state);
          setTalk({ deck: message.deck, images: message.images, since: message.since });
        }
      } else if (message.type === "state") {
        heard();
        setState(message.state);
      } else if (message.type === "beat") {
        heard();
        setEnded(false);
        // A show that is there and has not given its deck (the window was reloaded, or the deck went astray): ask for it.
        if (having.current === null) sync.post({ type: "hello" });
      } else if (message.type === "rehearse") {
        heard();
        rehearsing.current = true;
        setRehearse(true);
      } else if (message.type === "bye") {
        lost();
      }
    });
    sync.post({ type: "hello" });
    return () => {
      stop();
      if (alive.current) clearTimeout(alive.current);
      alive.current = null;
      sync.post({ type: "bye" });
    };
  }, [sync, heard, lost]);

  const waiting = talk === null || ended;
  useEffect(() => {
    if (!waiting) return;
    const ask = setInterval(() => sync.post({ type: "hello" }), ASK_MS);
    return () => clearInterval(ask);
  }, [waiting, sync]);

  const plan = useMemo(() => (talk ? planOf(talk.deck) : null), [talk]);
  const images = talk?.images;
  const imageUrl = useCallback((path: string) => images?.[path], [images]);

  const go = useCallback(
    (position: Position, paused?: boolean) => {
      if (!plan) return;
      const next: RevealState = { ...toState(plan, position), paused: paused ?? state.paused ?? false, overview: state.overview ?? false };
      setState(next);
      sync.post({ type: "state", state: next });
    },
    [plan, state.paused, state.overview, sync],
  );
  const end = useCallback(() => sync.post({ type: "end" }), [sync]);

  if (!talk || !plan) {
    return (
      <div className="ks-presenter is-waiting" role="status">
        <p>Waiting for the show…</p>
        {onClose ? (
          <button type="button" className="ks-pv-button" onClick={onClose}>
            Close
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <>
      <Presenter key={talk.since} deck={talk.deck} imageUrl={imageUrl} position={fromState(plan, state)} paused={state.paused ?? false} since={talk.since} onGo={go} onEnd={end} rehearsal={rehearsal} {...(onClose ? { onClose } : {})} />
      {ended ? (
        <p className="ks-pv-ended" role="status">
          The presentation has ended.
        </p>
      ) : null}
    </>
  );
}

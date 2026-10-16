// The presenter's window as a page: it asks the audience's window for the deck, shows the presenter's view of it, and passes on
// every move it makes, while following the moves the audience's window makes.

import type { Deck } from "@kasten-slides/wasm";
import { type JSX, useCallback, useEffect, useMemo, useState } from "react";

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

  // Ask until the audience's window answers: it may not be there yet.
  useEffect(() => {
    const stop = sync.subscribe((message) => {
      if (message.type === "deck") {
        setTalk({ deck: message.deck, images: message.images, since: message.since });
        setState(message.state);
        setEnded(false);
      } else if (message.type === "state") {
        setState(message.state);
      } else if (message.type === "rehearse") {
        setRehearse(true);
      } else if (message.type === "bye") {
        setEnded(true);
      }
    });
    sync.post({ type: "hello" });
    return () => {
      stop();
      sync.post({ type: "bye" });
    };
  }, [sync]);
  const waiting = talk === null;
  useEffect(() => {
    if (!waiting) return;
    const ask = setInterval(() => sync.post({ type: "hello" }), 1500);
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

  if (!talk || !plan) {
    return (
      <div className="ks-presenter is-waiting" role="status">
        <p>Waiting for the presentation to start…</p>
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
      <Presenter deck={talk.deck} imageUrl={imageUrl} position={fromState(plan, state)} paused={state.paused ?? false} since={talk.since} onGo={go} rehearsal={rehearsal} {...(onClose ? { onClose } : {})} />
      {ended ? (
        <p className="ks-pv-ended" role="status">
          The presentation has ended.
        </p>
      ) : null}
    </>
  );
}

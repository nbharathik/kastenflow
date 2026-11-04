// One slide of the show: drawn again at each step it is taken to, with what the step brings in coming in
// by the deck's effect, and its live embeds and videos on top while it is the slide on the screen.

import type { Deck, Effect, Slide } from "@kasten-slides/wasm";
import { type JSX, memo, useContext, useLayoutEffect, useMemo, useRef } from "react";

import { SlideView } from "../render/index.ts";
import type { ImageUrl } from "../render/index.ts";
import { PresentContext } from "./context.ts";
import { InkLayer } from "./ink/InkLayer.tsx";
import { LazyLiveLayer } from "./LazyLiveLayer.tsx";
import { fxPlanOf } from "./fx-plan.ts";
import { fxPlayer } from "./runtime/fx.js";
import { EFFECT_SECONDS, newcomers, playEnter, uncovered } from "./runtime/stepfx.js";

export interface StepSlideProps {
  deck: Deck;
  slide: Slide;
  /** The slide's place among the slides shown, from 1, and how many there are. */
  number: number;
  count: number;
  /** How many steps of the slide show. */
  step: number;
  /** It is the slide on the screen (and not just next to it, or in the overview). */
  live: boolean;
  /** The slide is the next one to come: its videos are mounted early, loaded and paused, so they are there when it arrives. */
  ready?: boolean;
  imageUrl: ImageUrl;
}

/** How a change of state is drawn: the deck's choice, else a fade. */
export const effectOf = (deck: Deck): Effect => deck.present.effect ?? "fade";

function StepSlideImpl({ deck, slide, number, count, step, live, ready = false, imageUrl }: StepSlideProps): JSX.Element {
  const stage = useRef<HTMLDivElement>(null);
  const { ink } = useContext(PresentContext);
  const fresh = useMemo(() => newcomers<HTMLElement>(), []);
  const opened = useMemo(() => uncovered<HTMLElement>(), []);
  const effect = effectOf(deck);
  // The effects the slide names for its steps (an entrance, an exit, a pulse ...), played in place of the deck's usual one.
  const effects = useMemo(() => fxPlayer(fxPlanOf(slide, deck.theme)), [slide, deck.theme]);

  // What this step drew that the one before did not comes in with the effect. A slide that is only being got ready, or has just
  // appeared, is learned and not played: nothing comes in on a slide as it arrives, only as a step is taken.
  useLayoutEffect(() => {
    const root = stage.current;
    if (!root) return;
    const drawn = [...root.querySelectorAll<HTMLElement>(".ks-slide [data-el]:not([data-master]), .ks-slide .ks-highlight")];
    const paragraphs = [...root.querySelectorAll<HTMLElement>(".ks-slide .ks-p")];
    const entering = [...fresh(drawn), ...opened(paragraphs)];
    const named = effects.play(
      drawn.filter((node) => node.hasAttribute("data-el")),
      root.querySelector<HTMLElement>(".ks-slide"),
      step,
      live,
    );
    if (live) playEnter(entering.filter((node) => !named.has(node.getAttribute("data-el") ?? "")), effect, EFFECT_SECONDS);
  }, [step, live, slide, effect, fresh, opened, effects]);

  return (
    <div ref={stage} className="ks-show-slide" role="group" aria-roledescription="slide" aria-label={`Slide ${number} of ${count}`} style={{ width: deck.size.w, height: deck.size.h }}>
      <SlideView deck={deck} slide={slide} number={number} count={count} step={slide.steps ? step : undefined} mode="present" imageUrl={imageUrl} />
      {live || ready ? <LazyLiveLayer deck={deck} slide={slide} step={step} imageUrl={imageUrl} ready={!live} /> : null}
      {live && ink ? <InkLayer store={ink} aspect={deck.size.h / deck.size.w} /> : null}
    </div>
  );
}

export const StepSlide = memo(StepSlideImpl);

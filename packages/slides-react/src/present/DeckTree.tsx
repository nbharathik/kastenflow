// The slides as reveal.js sees them: a section for each slide, a stack for a slide with backup slides under it,
// and a marker for each step, which reveal.js counts as its fragments. reveal.js does the moving between
// slides and steps; what a slide looks like at a step is drawn by the renderer (StepSlide), not by fragments.

import { Slide as RevealSlide, Stack } from "@revealjs/react";
import type { Slide } from "@kasten-slides/wasm";
import { type JSX, memo, useMemo } from "react";

import type { ImageUrl } from "../render/index.ts";
import { type Plan, type Position, stepFor, stepsOf } from "./plan.ts";
import { type Arrivals, arrivalsOf, sectionAttributes } from "./section.ts";
import { StepSlide } from "./StepSlide.tsx";

/** Slides this far from the one on the screen (in columns) are drawn ahead of time; the rest wait until they are near. */
export const DRAW_AHEAD = 2;
/** A deck this short is drawn whole. */
const SHORT_DECK = 24;

/** The markers reveal.js steps through: one for each step of a slide, seen by nobody and read out to those who cannot see. */
function Markers({ steps }: { steps: number }): JSX.Element {
  return (
    <>
      {Array.from({ length: steps }, (_, i) => (
        <span key={i} className="fragment ks-show-step" data-fragment-index={i}>
          Step {i + 1} of {steps}
        </span>
      ))}
    </>
  );
}

interface SectionProps {
  slide: Slide;
  step: number;
  drawn: boolean;
  live: boolean;
  /** The slide is next to the one on the screen, on the way there or back: its videos are mounted early and wait. */
  ready: boolean;
  /** The deck's slides, and the plan they were laid out in. */
  plan: Plan;
  imageUrl: ImageUrl;
  arrivals: Arrivals;
}

const Section = memo(function Section({ slide, step, drawn, live, ready, plan, imageUrl, arrivals }: SectionProps): JSX.Element {
  const { deck } = plan;
  const attributes = sectionAttributes(slide, arrivals.arrival(slide), arrivals.run(slide));
  return (
    <RevealSlide {...attributes}>
      {drawn ? <StepSlide deck={deck} slide={slide} number={plan.numbers.get(slide.id) ?? 0} count={plan.count} step={step} live={live} ready={ready} imageUrl={imageUrl} /> : null}
      <Markers steps={stepsOf(slide)} />
    </RevealSlide>
  );
});

export interface DeckTreeProps {
  plan: Plan;
  position: Position;
  /** The overview is up: every slide is drawn. */
  overview: boolean;
  /** Where the drawing ahead is centred; it may lag behind the position, so that getting to a slide is not held up by the ones near it. */
  around: number;
  imageUrl: ImageUrl;
}

/** The slides and stacks, in order. */
export function DeckTree({ plan, position, overview, around, imageUrl }: DeckTreeProps): JSX.Element {
  const arrivals = useMemo(() => arrivalsOf(plan), [plan]);
  const everything = overview || plan.columns.length <= SHORT_DECK;

  const columns = plan.columns.map((column, h) => {
    const sections = column.slides.map((slide, v) => {
      const here = h === position.h && v === position.v;
      // The column on the screen is drawn whole; the ones near it, at their top; the rest when they come near.
      const drawn = here || everything || h === position.h || (Math.abs(h - around) <= DRAW_AHEAD && v === 0);
      // The slides one move away (along the row, or down and up a column) have their videos mounted already.
      const ready = !here && !overview && ((h === position.h && Math.abs(v - position.v) === 1) || (v === 0 && Math.abs(h - position.h) === 1));
      return (
        <Section
          key={slide.id}
          slide={slide}
          step={stepFor(plan, position, h, v)}
          drawn={drawn}
          live={here && !overview}
          ready={ready}
          plan={plan}
          imageUrl={imageUrl}
          arrivals={arrivals}
        />
      );
    });
    const only = sections[0];
    return sections.length === 1 && only ? only : <Stack key={column.slides[0]?.id ?? h}>{sections}</Stack>;
  });
  return <>{columns}</>;
}

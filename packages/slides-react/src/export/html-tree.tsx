// The slides of the exported web page as markup: the sections reveal.js moves between, each with a layer for every step of the
// slide (the page shows the one for the steps taken), and the speaker notes kept beside it for the page that scrolls.

import type { Deck, Slide } from "@kasten-slides/wasm";
import { type JSX } from "react";

import { Notes } from "../present/notes.tsx";
import { type Plan, stepsOf } from "../present/plan.ts";
import { type Arrivals, arrivalsOf, sectionAttributes } from "../present/section.ts";
import type { ImageUrl } from "../render/index.ts";
import { SlideView } from "../render/index.ts";
import { ExportFrames } from "./html-frames.tsx";

interface SectionProps {
  deck: Deck;
  slide: Slide;
  number: number;
  count: number;
  imageUrl: ImageUrl;
  arrivals: Arrivals;
}

function Section({ deck, slide, number, count, imageUrl, arrivals }: SectionProps): JSX.Element {
  const steps = stepsOf(slide);
  return (
    <section {...sectionAttributes(slide, arrivals.arrival(slide), arrivals.run(slide))}>
      {Array.from({ length: steps + 1 }, (_, step) => (
        <div key={step} className="ks-show-layer" data-step={step} hidden={step !== 0}>
          <div className="ks-show-slide" style={{ width: deck.size.w, height: deck.size.h }}>
            <SlideView deck={deck} slide={slide} number={number} count={count} step={steps > 0 ? step : undefined} mode="present" imageUrl={imageUrl} />
            <ExportFrames deck={deck} slide={slide} step={steps > 0 ? step : -1} />
          </div>
        </div>
      ))}
      {Array.from({ length: steps }, (_, i) => (
        <span key={i} className="fragment ks-show-step" data-fragment-index={i}>
          Step {i + 1} of {steps}
        </span>
      ))}
      {slide.notes && slide.notes.trim() !== "" ? (
        <aside className="ks-show-notes-store" hidden>
          <Notes markdown={slide.notes} />
        </aside>
      ) : null}
    </section>
  );
}

/** The `.reveal` element of the page: all the slides, a stack for each slide with backups. */
export function ExportTree({ plan, imageUrl }: { plan: Plan; imageUrl: ImageUrl }): JSX.Element {
  const { deck } = plan;
  const arrivals = arrivalsOf(plan);
  const section = (slide: Slide) => <Section key={slide.id} deck={deck} slide={slide} number={plan.numbers.get(slide.id) ?? 0} count={plan.count} imageUrl={imageUrl} arrivals={arrivals} />;
  return (
    <div className="reveal ks-show-reveal">
      <div className="slides">
        {plan.columns.map((column) => {
          const [only, ...rest] = column.slides;
          if (only && rest.length === 0) return section(only);
          return <section key={only?.id}>{column.slides.map(section)}</section>;
        })}
      </div>
    </div>
  );
}

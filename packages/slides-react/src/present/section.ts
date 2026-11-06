// What reveal.js is told about a slide: how it arrives, and which slides morph into each other. The show in the app and the
// exported web page both name their sections with this, so a slide arrives the same way in both.

import type { CSSProperties } from "react";

import { type Arrival, type Plan, arrivalOf, morphRuns } from "./plan.ts";
import type { Slide } from "@kasten-slides/wasm";

/**
 * reveal.js's name for how a slide arrives. A morph, when it cannot pair the slides, is a fade. The kinds it has no name for are
 * cut by reveal.js and played by the runtime (`runtime/transitions.js`), which reads `data-ks-fx`.
 */
const REVEAL_TRANSITION = { none: "none", fade: "fade", slide: "slide", morph: "fade", push: "none", wipe: "none", cover: "none", uncover: "none", zoom: "none", flip: "none", dissolve: "none" } as const;

/** The kinds the runtime plays. */
const PLAYED: ReadonlySet<string> = new Set(["push", "wipe", "cover", "uncover", "zoom", "flip", "dissolve"]);

export interface SectionAttributes {
  "data-slide": string;
  "data-transition": string;
  "data-ks-fx"?: string;
  "data-ks-dir"?: string;
  "data-ks-seconds"?: string;
  "data-auto-animate"?: string;
  "data-auto-animate-id"?: string;
  "data-auto-animate-duration"?: string;
  "data-auto-animate-easing"?: string;
  style: CSSProperties;
}

export interface Arrivals {
  arrival(slide: Slide): Arrival;
  /** The run of morphing slides a slide belongs to, if any; a backup slide has none. */
  run(slide: Slide): string | undefined;
}

/** How each slide of a plan arrives, and the runs of morphs. */
export function arrivalsOf(plan: Plan): Arrivals {
  const runs = morphRuns(plan);
  const tops = new Set(plan.columns.map((column) => column.slides[0]?.id));
  const known = new Map(plan.columns.flatMap((column) => column.slides.map((slide) => [slide.id, arrivalOf(plan.deck, slide)] as const)));
  return {
    arrival: (slide) => known.get(slide.id) ?? arrivalOf(plan.deck, slide),
    run: (slide) => (tops.has(slide.id) ? runs.get(slide.id) : undefined),
  };
}

/** The attributes of the section of a slide. */
export function sectionAttributes(slide: Slide, arrival: Arrival, run: string | undefined): SectionAttributes {
  const played = PLAYED.has(arrival.kind);
  const attributes: SectionAttributes = {
    "data-slide": slide.id,
    "data-transition": REVEAL_TRANSITION[arrival.kind],
    // reveal.js only cuts for a kind the runtime plays, so it takes no time of its own.
    style: { transitionDuration: `${arrival.kind === "none" || played ? 0 : Math.max(arrival.duration, 0.01)}s` },
  };
  if (played) {
    attributes["data-ks-fx"] = arrival.kind;
    attributes["data-ks-seconds"] = String(arrival.duration);
    if (arrival.direction) attributes["data-ks-dir"] = arrival.direction;
  }
  if (run !== undefined) {
    attributes["data-auto-animate"] = "";
    attributes["data-auto-animate-id"] = run;
    // How long a morph takes and how it eases is the later slide's to say, whichever way the person is going.
    if (arrival.kind === "morph") {
      attributes["data-auto-animate-duration"] = String(arrival.duration);
      if (arrival.easing) attributes["data-auto-animate-easing"] = arrival.easing;
    }
  }
  return attributes;
}

// The effects of a slide's steps as the runtime plays them: for each step, the elements whose change that step has an effect of its own,
// in the order the slide lists them, and whether each comes in, goes out or only draws the eye. An element that names no effect for a
// step is not here: the deck's usual effect (`stepfx.js`) brings it in.

import type { Element, Slide, StepFx, StepState, Theme } from "@kasten-slides/wasm";

import { colorOf } from "../theme/index.ts";
import type { FxPlan, FxRole, PlayableFx } from "./runtime/fx.js";

/** The state of an element at a step: the entry with the greatest step that is not after it, else normal. */
export function stateAt(element: Pick<Element, "stepStates">, step: number): StepState {
  let found: StepState = "normal";
  let at = -1;
  for (const [key, state] of Object.entries(element.stepStates ?? {})) {
    const n = Number(key);
    if (Number.isFinite(n) && n <= step && n > at && state) {
      at = n;
      found = state;
    }
  }
  return found;
}

/** The effect as the runtime plays it: a theme colour is a CSS colour by now. */
export function playable(fx: StepFx, theme: Theme): PlayableFx {
  return {
    kind: fx.kind,
    direction: fx.direction ?? null,
    duration: fx.duration ?? null,
    delay: fx.delay ?? null,
    start: fx.start ?? null,
    color: fx.color ? colorOf(theme, fx.color, undefined) : null,
    dx: fx.dx ?? null,
    dy: fx.dy ?? null,
  };
}

/** How a change at a step reads from the element's states before and after it. */
export function roleOf(before: StepState, after: StepState): FxRole {
  if (before === "hidden" && after !== "hidden") return "enter";
  if (before !== "hidden" && after === "hidden") return "exit";
  return "emph";
}

/** The plan of a slide: by step, in the order of the slide's elements. A slide with no effects of its own has an empty plan. */
export function fxPlanOf(slide: Slide, theme: Theme): FxPlan {
  const plan: FxPlan = {};
  for (const element of slide.elements) {
    for (const [key, fx] of Object.entries(element.stepFx ?? {})) {
      const step = Number(key);
      if (!Number.isInteger(step) || step < 1 || !fx) continue;
      const role = roleOf(stateAt(element, step - 1), stateAt(element, step));
      (plan[step] ??= []).push({ id: element.id, role, fx: playable(fx, theme) });
    }
  }
  return plan;
}

/** Whether a plan has any effect. */
export const hasFx = (plan: FxPlan): boolean => Object.keys(plan).length > 0;

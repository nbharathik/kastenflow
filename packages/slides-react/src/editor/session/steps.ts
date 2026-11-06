// Steps: how many clicks a slide has and how its elements look at each. The
// Steps panel, the Slide menu and the commands all do it through here.

import type { BuiltSteps, Element, Recipe, StepFx, StepState, Text } from "@kasten-slides/wasm";

import type { EditorSession } from "./session.ts";
import type { EditorState } from "./types.ts";

/** The most clicks a slide can have. */
export const MOST_STEPS = 50;

/** The element with this id on the slide, looking inside groups. */
export function findElement(elements: readonly Element[], id: string): Element | undefined {
  for (const element of elements) {
    if (element.id === id) return element;
    if (element.type === "group") {
      const inside = findElement(element.children, id);
      if (inside) return inside;
    }
  }
  return undefined;
}

/**
 * The elements a build acts on: those selected, or when none are, every element of the
 * slide but its title and what is locked (a title that builds in with the rest is never
 * what a person meant). Clearing steps takes every element when none is selected.
 */
export function buildScope(state: Pick<EditorState, "deck" | "slideId" | "selection">, recipe?: Recipe): string[] {
  const slide = state.deck.slides.find((s) => s.id === state.slideId);
  if (!slide) return [];
  if (state.selection.length > 0) return [...state.selection];
  if (recipe === "clear") return slide.elements.map((e) => e.id);
  return slide.elements.filter((e) => e.placeholder !== "title" && !e.locked).map((e) => e.id);
}

/** The text of an element that can hold list items to build line by line: a text box or a shape. */
export function bodyOf(element: Element): Text | undefined {
  return element.type === "text" ? element.text : element.type === "shape" ? (element.text ?? undefined) : undefined;
}

export class StepCommands {
  constructor(private readonly s: EditorSession) {}

  private get slideId(): string {
    return this.s.state.slideId;
  }

  /** The elements a build would act on now. */
  scope(recipe?: Recipe): string[] {
    return buildScope(this.s.state, recipe);
  }

  /** Gives the slide this many clicks; taking some away moves what they did onto the last one that stays. */
  setSteps(steps: number, slide: string = this.slideId): void {
    const wanted = Math.min(Math.max(Math.trunc(steps), 0), MOST_STEPS);
    if ((this.s.state.deck.slides.find((x) => x.id === slide)?.steps ?? 0) === wanted) return;
    this.s.run(() => this.s.core.apply("set_slide_steps", { slide, steps: wanted }));
  }

  addStep(slide: string = this.slideId): void {
    const now = this.s.state.deck.slides.find((x) => x.id === slide)?.steps ?? 0;
    this.setSteps(now + 1, slide);
  }

  removeStep(slide: string = this.slideId): void {
    const now = this.s.state.deck.slides.find((x) => x.id === slide)?.steps ?? 0;
    if (now > 0) this.setSteps(now - 1, slide);
  }

  /** How an element looks from `step` onward; null takes that step's entry away, so the state before it holds. */
  setState(id: string, step: number, state: StepState | null, slide: string = this.slideId): void {
    this.s.run(() => this.s.core.apply("set_step_states", { slide, id, states: { [String(step)]: state } }));
  }

  /** How the change of an element at `step` is drawn; null takes the effect away, so the deck's usual one plays. The slide gets the step if it lacks it. */
  setFx(id: string, step: number, fx: StepFx | null, slide: string = this.slideId): void {
    this.s.run(() => this.s.core.apply("set_step_fx", { slide, id, fx: { [String(step)]: fx } }));
  }

  /** The step a paragraph of a text appears at; null shows it from the start. The slide gets the step if it lacks it. */
  setParagraphStep(id: string, paragraph: number, step: number | null, slide: string = this.slideId): void {
    const shown = this.s.state.deck.slides.find((x) => x.id === slide);
    const element = shown && findElement(shown.elements, id);
    const body = element && bodyOf(element);
    if (!shown || !body?.paragraphs[paragraph]) return;
    const text = { ...body, paragraphs: body.paragraphs.map((p, i) => (i === paragraph ? { ...p, step } : p)) };
    const change: ["set_rich_text", { slide: string; id: string; text: Text }] = ["set_rich_text", { slide, id, text }];
    const grow = step !== null && step > (shown.steps ?? 0);
    // One step of undo, whether or not the slide needs more steps.
    this.s.run(() => this.s.core.applyBatch(grow ? [change, ["set_slide_steps", { slide, steps: Math.min(step, MOST_STEPS) }]] : [change]));
  }

  /** Builds steps for the elements named, or for the ones in scope (see `buildScope`). */
  build(recipe: Recipe, ids: readonly string[] = this.scope(recipe), slide: string = this.slideId): BuiltSteps | undefined {
    if (ids.length === 0) return undefined;
    return this.s.run(() => this.s.core.apply("build_steps", { slide, ids: [...ids], recipe }))?.output;
  }
}

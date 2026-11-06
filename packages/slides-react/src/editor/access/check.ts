// The accessibility check of a deck: what a person who cannot see the slides, or cannot hear the video, is missing. Pictures without words
// and text without contrast are lint's own rules (`missing-alt`, `contrast`) and are taken from what lint found; the others are looked
// for here, on the deck: a slide with no title, a table with no header row, a video with no captions. Pure.

import type { Deck, Element, Issue, Slide } from "@kasten-slides/wasm";

import { labelOf } from "../panels/steps/model.ts";
import { bodyOf } from "../session/steps.ts";

export type AccessRule = "slide-title" | "missing-alt" | "contrast" | "table-header" | "video-captions";

/** The rules, in the order problems are listed within a slide, with what each is called in the panel. */
export const ACCESS_RULES: readonly { rule: AccessRule; name: string }[] = [
  { rule: "slide-title", name: "Slide titles" },
  { rule: "missing-alt", name: "Alt text" },
  { rule: "contrast", name: "Contrast" },
  { rule: "table-header", name: "Table headers" },
  { rule: "video-captions", name: "Video captions" },
];

export interface AccessProblem {
  /** Unique in a report. */
  key: string;
  rule: AccessRule;
  slide: string;
  /** The slide's place, from 1. */
  number: number;
  /** The element it is about; absent when it is the slide's. */
  element?: string;
  message: string;
  /** How to put it right, in a few words. */
  hint: string;
}

const RULE_OF_LINT = new Set<string>(["missing-alt", "contrast"]);

const hasWords = (element: Element): boolean => (bodyOf(element)?.paragraphs ?? []).some((p) => p.runs.some((r) => r.t.trim() !== ""));

/** Whether a slide has a title: a filled title slot, or a title it keeps without drawing. */
export function hasTitle(slide: Slide): boolean {
  if (slide.access?.title?.trim()) return true;
  return slide.elements.some((e) => e.placeholder === "title" && hasWords(e));
}

function walk(list: readonly Element[], visit: (element: Element) => void): void {
  for (const element of list) {
    visit(element);
    if (element.type === "group") walk(element.children, visit);
  }
}

/** The problems of the deck, slide by slide in the deck's order, and within a slide in the order of `ACCESS_RULES`. `lint` is what lint found, by slide. */
export function checkAccess(deck: Deck, lint: ReadonlyMap<string, readonly Issue[]> = new Map()): AccessProblem[] {
  const order = new Map(ACCESS_RULES.map(({ rule }, i) => [rule, i] as const));
  const found: AccessProblem[] = [];
  deck.slides.forEach((slide, i) => {
    const number = i + 1;
    const here: AccessProblem[] = [];
    if (!hasTitle(slide)) {
      here.push({ key: `${slide.id}|title`, rule: "slide-title", slide: slide.id, number, message: `Slide ${number} has no title.`, hint: "A title lets a screen reader name the slide and gives the outline its heading. Give it a hidden title if it should not show." });
    }
    for (const issue of lint.get(slide.id) ?? []) {
      if (!RULE_OF_LINT.has(issue.rule)) continue;
      here.push({
        key: `${slide.id}|${issue.rule}|${issue.element ?? ""}|${issue.message}`,
        rule: issue.rule as AccessRule,
        slide: slide.id,
        number,
        ...(issue.element ? { element: issue.element } : {}),
        message: issue.message,
        hint: issue.hint ?? "",
      });
    }
    walk(slide.elements, (element) => {
      if (element.type === "table" && !element.headerRow) {
        here.push({ key: `${slide.id}|table-header|${element.id}`, rule: "table-header", slide: slide.id, number, element: element.id, message: `${labelOf(element)} has no header row.`, hint: "Make the first row a header so a screen reader says what each column holds." });
      }
      if (element.type === "video" && !element.captions?.trim()) {
        here.push({ key: `${slide.id}|video-captions|${element.id}`, rule: "video-captions", slide: slide.id, number, element: element.id, message: `${labelOf(element)} has no captions.`, hint: "Add a WebVTT (.vtt) captions file so people who cannot hear it can follow." });
      }
    });
    here.sort((a, b) => (order.get(a.rule) ?? 0) - (order.get(b.rule) ?? 0));
    found.push(...here);
  });
  return found;
}

/** Counts of the problems by rule. */
export function countByRule(problems: readonly AccessProblem[]): Record<AccessRule, number> {
  const counts: Record<AccessRule, number> = { "slide-title": 0, "missing-alt": 0, contrast: 0, "table-header": 0, "video-captions": 0 };
  for (const problem of problems) counts[problem.rule] += 1;
  return counts;
}

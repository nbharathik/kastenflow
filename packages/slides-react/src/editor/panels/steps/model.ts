// What the Steps grid shows: a row for each element of the slide in reading order (a group's
// children under it when it is open, the list items of a text that builds line by line under
// that), and what each cell holds. Pure: the grid draws these and the session changes the deck.

import { type Element, type Slide, type StepState, type Theme, readingOrder } from "@kasten-slides/wasm";

import { stateAt } from "../../../render/steps.ts";
import { withStored } from "../../access/reading-order.ts";
import { boxOf } from "../../../theme/index.ts";
import { bodyOf } from "../../session/steps.ts";
import { describe } from "../format/values.ts";

export const STATES: readonly StepState[] = ["hidden", "dimmed", "normal", "highlighted"];

/** What a state is called, in the grid's tooltips and menu. */
export const STATE_NAMES: Record<StepState, string> = {
  hidden: "Hidden",
  dimmed: "Dimmed",
  normal: "Normal",
  highlighted: "Highlighted",
};

interface RowBase {
  /** Unique in the grid. */
  key: string;
  /** The element the row is about (for a list item, the text that holds it). */
  element: Element;
  /** How far in the row is: 1 for what a group holds. */
  depth: number;
  /** The element of the slide that a click selects: the row's own, or the group round it. */
  top: string;
  label: string;
}

/** An element, and whether it has rows beneath it that can be opened. */
export interface ElementRow extends RowBase {
  kind: "element";
  group: boolean;
  open: boolean;
}

/** A list item of a text that builds line by line: it appears at a step. */
export interface ItemRow extends RowBase {
  kind: "item";
  index: number;
  /** The step it appears at; null when it is there from the start. */
  step: number | null;
}

export type StepRow = ElementRow | ItemRow;

const SNIPPET = 30;

/** The words a person knows an element by: its layer name, else the start of its text, else what kind it is. */
export function labelOf(element: Element): string {
  const named = element.name?.trim();
  if (named) return named;
  const words = snippetOf(element);
  return words ? words : describe([element]);
}

function snippetOf(element: Element): string {
  const body = bodyOf(element) ?? (element.type === "connector" ? element.label : undefined);
  const line = body?.paragraphs.map((p) => p.runs.map((r) => r.t).join("").trim()).find((t) => t !== "");
  if (!line) return "";
  return line.length > SNIPPET ? `${line.slice(0, SNIPPET - 1).trimEnd()}…` : line;
}

/** The paragraphs of a text that have a row of their own: the list items, once any paragraph has a step. */
function itemsOf(element: Element): { index: number; text: string; step: number | null }[] {
  const body = bodyOf(element);
  if (!body?.paragraphs.some((p) => p.step != null)) return [];
  return body.paragraphs.flatMap((p, index) =>
    p.list != null || p.step != null
      ? [{ index, text: p.runs.map((r) => r.t).join("").trim() || "(empty)", step: p.step ?? null }]
      : [],
  );
}

/**
 * The elements in the order a build takes them: rows from top to bottom, each from left to right, unless the slide was given a reading
 * order of its own (`stored`, the ids it names first; Accessibility panel), which the build follows too.
 */
export function inReadingOrder(elements: readonly Element[], theme: Theme, layout: string, stored?: readonly string[]): Element[] {
  const order = readingOrder(elements.map((element) => boxOf(theme, layout, element)));
  return withStored(
    order.flatMap((at) => (elements[at] ? [elements[at]] : [])),
    stored,
  );
}

/** The steps the composites of a slide ask for: a code block with three entries in focus needs three. */
export function stepsNeeded(elements: readonly Element[]): number {
  return elements.reduce((most, element) => Math.max(most, element.type === "code" ? (element.focus?.length ?? 0) : 0, element.type === "group" ? stepsNeeded(element.children) : 0), 0);
}

/** The rows of the grid for a slide. `open` holds the ids of the groups whose children are shown. */
export function rowsOf(slide: Slide, theme: Theme, open: ReadonlySet<string>): StepRow[] {
  const rows: StepRow[] = [];
  const visit = (elements: readonly Element[], depth: number, top: string | null): void => {
    for (const element of inReadingOrder(elements, theme, slide.layout, depth === 0 ? slide.access?.readingOrder : undefined)) {
      const own = top ?? element.id;
      const group = element.type === "group";
      rows.push({ kind: "element", key: element.id, element, depth, top: own, label: labelOf(element), group, open: group && open.has(element.id) });
      if (element.type === "group" && open.has(element.id)) visit(element.children, depth + 1, own);
      for (const item of itemsOf(element)) {
        rows.push({ kind: "item", key: `${element.id}:${item.index}`, element, depth: depth + 1, top: own, label: item.text, index: item.index, step: item.step });
      }
    }
  };
  visit(slide.elements, 0, null);
  return rows;
}

/** What a cell holds: the state at that step, and whether the element says so at that very step (or it is only carried on from before). */
export interface Cell {
  state: StepState;
  set: boolean;
}

export function cellOf(row: StepRow, step: number): Cell {
  if (row.kind === "item") {
    const appears = row.step ?? 0;
    return { state: step < appears ? "hidden" : "normal", set: row.step !== null && step === row.step };
  }
  return { state: stateAt(row.element, step), set: row.element.stepStates?.[step] !== undefined };
}

/** What the entry at a step is: the state the element names for that step, if it does. */
export function entryOf(row: ElementRow, step: number): StepState | undefined {
  return row.element.stepStates?.[step];
}

const CYCLE: readonly (StepState | null)[] = [...STATES, null];

/** The entry after `entry` when a cell is clicked: hidden, dimmed, normal, highlighted, and then none (the state before holds). */
export function nextEntry(entry: StepState | undefined, direction: 1 | -1 = 1): StepState | null {
  const at = entry === undefined ? CYCLE.length - 1 : CYCLE.indexOf(entry);
  return CYCLE[(at + direction + CYCLE.length) % CYCLE.length] ?? null;
}

/** A cell said aloud: "Model, step 2: highlighted, set here". */
export function cellName(row: StepRow, step: number, cell: Cell): string {
  const where = step === 0 ? "step 0, as the slide appears" : `step ${step}`;
  if (row.kind === "item") {
    return `${row.label}, ${where}: ${cell.state === "hidden" ? "not there yet" : "shown"}${cell.set ? ", appears here" : ""}`;
  }
  return `${row.label}, ${where}: ${STATE_NAMES[cell.state].toLowerCase()}${cell.set ? ", set here" : ", from before"}`;
}

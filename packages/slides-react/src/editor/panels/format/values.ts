// What a selection agrees on. A control that shows one value for several
// elements shows "mixed" when they differ, and still works: what is typed or
// picked goes to all of them.

import type { Element, JsonValue, Text } from "@kasten-slides/wasm";

import type { Box } from "../../session/types.ts";

export type Mixed = "mixed";

/** An element of one kind. */
export type Of<K extends Element["type"]> = Extract<Element, { type: K }>;

/** The elements of one kind among these. */
export const only = <K extends Element["type"]>(elements: readonly Element[], type: K): Of<K>[] => elements.filter((e): e is Of<K> => e.type === type);

/** Whether two values are the same, comparing objects by what they hold. */
export const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/** The one value all of them have, `none` for no values, and "mixed" when they differ. Only for values that are never the word "mixed". */
export function agree<T>(values: readonly T[], none: T): T | Mixed {
  if (values.length === 0) return none;
  const first = values[0] as T;
  return values.every((value) => same(value, first)) ? first : "mixed";
}

/** The same, for free text, where any word is a possible value: says separately whether they differ, and then the value is `none`. */
export function shared<T>(values: readonly T[], none: T): { value: T; mixed: boolean } {
  const first = values.length > 0 ? (values[0] as T) : none;
  const mixed = !values.every((value) => same(value, first));
  return { value: mixed ? none : first, mixed };
}

/** The smallest box holding all of them; null for none. */
export function unionOf(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** The text a text box or a shape holds, if it holds any. */
export function textOf(element: Element): Text | null {
  if (element.type === "text") return element.text;
  if (element.type === "shape") return element.text ?? null;
  return null;
}

export const round1 = (n: number): number => Math.round(n * 10) / 10;
export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** A degree count as an angle from 0 up to, not including, 360 (in hundredths, as the deck keeps it). */
export function turnOf(degrees: number): number {
  const angle = round2(((degrees % 360) + 360) % 360);
  return angle >= 360 ? 0 : angle;
}

/** "3 shapes", "a text box": what a selection is, in a few words. */
export function describe(elements: readonly Element[]): string {
  const NAMES: Record<Element["type"], [string, string]> = {
    text: ["Text box", "text boxes"],
    shape: ["Shape", "shapes"],
    line: ["Line", "lines"],
    connector: ["Connector", "connectors"],
    image: ["Image", "images"],
    group: ["Group", "groups"],
    table: ["Table", "tables"],
    raw: ["Imported object", "imported objects"],
    code: ["Code block", "code blocks"],
    math: ["Formula", "formulas"],
    chat: ["Conversation", "conversations"],
    "token-probs": ["Token probabilities", "token probabilities"],
    "card-grid": ["Card grid", "card grids"],
    citation: ["Citation", "citations"],
    "step-label": ["Step label", "step labels"],
    embed: ["Embedded page", "embedded pages"],
    video: ["Video", "videos"],
    chart: ["Chart", "charts"],
    timer: ["Timer", "timers"],
    qr: ["QR code", "QR codes"],
  };
  const first = elements[0];
  if (!first) return "";
  if (elements.length === 1) return NAMES[first.type][0];
  const kinds = new Set(elements.map((e) => e.type));
  return kinds.size === 1 ? `${elements.length} ${NAMES[first.type][1]}` : `${elements.length} elements`;
}

/** A value as plain JSON, for a patch: what is not JSON (an absent field) is dropped. */
export const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value ?? null)) as JsonValue;

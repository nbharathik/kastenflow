// The slots a person puts on a layout: what each kind is called, the role it gets and the element it is while the layout is designed.
// The same rules as slides-core's `design::slots`, which reads the layout back from the slide the editor works on.

import type { Element } from "@kasten-slides/wasm";

export type SlotKind = "title" | "subtitle" | "body" | "text" | "picture" | "caption";

export interface SlotChoice {
  kind: SlotKind;
  /** What a person calls it. */
  label: string;
  /** What it is for, in a few words. */
  hint: string;
}

/** The kinds a menu offers, in the order it lists them. */
export const SLOT_KINDS: readonly SlotChoice[] = [
  { kind: "title", label: "Title", hint: "The slide's heading, set large" },
  { kind: "subtitle", label: "Subtitle", hint: "A line under the title" },
  { kind: "body", label: "Body (bullets)", hint: "A list: what is typed becomes bullets" },
  { kind: "text", label: "Text", hint: "Words without bullets" },
  { kind: "picture", label: "Picture", hint: "A place for an image" },
  { kind: "caption", label: "Caption", hint: "A small line of words" },
];

export const slotLabel = (kind: SlotKind): string => SLOT_KINDS.find((choice) => choice.kind === kind)?.label ?? kind;

/** The role a first slot of this kind has; later ones are numbered. */
const ROLE: Record<SlotKind, string> = { title: "title", subtitle: "subtitle", body: "body", text: "text", picture: "image", caption: "caption" };

/** The text style a slot of this kind starts from. */
const STYLE: Record<SlotKind, string> = { title: "title", subtitle: "subtitle", body: "body", text: "body", picture: "caption", caption: "caption" };

/** A role of this kind that none of `taken` has: `body`, then `body2`, `body3` ... */
export function freeRole(kind: SlotKind, taken: readonly string[]): string {
  const base = ROLE[kind];
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) if (!taken.includes(`${base}${n}`)) return `${base}${n}`;
}

/** The kind a role belongs to, ignoring a number after it (`body2` is a body). Anything unknown is plain text. */
export function kindOfRole(role: string): SlotKind {
  switch (role.replace(/\d+$/, "")) {
    case "title":
    case "number":
      return "title";
    case "subtitle":
    case "label":
      return "subtitle";
    case "body":
    case "code":
      return "body";
    case "image":
      return "picture";
    case "caption":
    case "quote":
      return "caption";
    default:
      return "text";
  }
}

const NOUN: Record<SlotKind, string> = { title: "title", subtitle: "subtitle", body: "text", text: "text", picture: "image", caption: "caption" };

/** What an empty slot of this kind asks for. */
export const promptOf = (kind: SlotKind): string => `Click to add ${NOUN[kind]}`;

interface Frame {
  w: number;
  h: number;
}

/** Where a new slot of this kind starts, as the built-in layouts place theirs (drawn for 960 by 540, stretched to the slide). */
export function boxOfKind(kind: SlotKind, size: Frame): { x: number; y: number; w: number; h: number } {
  const [sx, sy] = [size.w / 960, size.h / 540];
  const at = (x: number, y: number, w: number, h: number) => ({ x: Math.round(x * sx), y: Math.round(y * sy), w: Math.round(w * sx), h: Math.round(h * sy) });
  switch (kind) {
    case "title":
      return at(64, 36, 832, 96);
    case "subtitle":
      return at(64, 140, 832, 56);
    case "body":
    case "text":
      return at(64, 148, 832, 344);
    case "picture":
      return at(480, 148, 416, 344);
    case "caption":
      return at(64, 448, 832, 44);
  }
}

/** The element a slot is while its layout is designed: where the slot is, holding the words it asks for. */
export function slotElement(kind: SlotKind, role: string, box: { x: number; y: number; w: number; h: number }): Element {
  if (kind === "picture") return { type: "image", id: "", src: "", placeholder: role, ...box } as Element;
  const paragraph = { runs: [{ t: promptOf(kind) }], style: STYLE[kind], ...(kind === "body" ? { list: "bullet" } : {}) };
  const valign = kind === "title" ? "middle" : "top";
  return { type: "text", id: "", placeholder: role, ...box, text: { paragraphs: [paragraph], valign } } as Element;
}

/** The text style a paragraph of a slot of this kind starts from (the editor names it on a new slot so it looks as it will). */
export const styleOfKind = (kind: SlotKind): string => STYLE[kind];

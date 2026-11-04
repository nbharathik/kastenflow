// A code picture is an image element that keeps the program that draws it in its `generator` field (a field
// the element does not list and every build keeps, as `x-diagram` is). The picture it drew is an ordinary
// picture in the host's image store, so PowerPoint and PDF export and older builds see just a picture. This
// reads and checks that block, and works out what a run changes.

import type { Deck, Element, GeneratorInput, GeneratorInputKind, GeneratorOutput, PictureGenerator } from "@kasten-slides/wasm";

import { findElement } from "../session/scope.ts";
import type { EditorState } from "../session/types.ts";
import { type InputText, LANGUAGE, type Program } from "./types.ts";

/** The field of an image element that holds its program. */
export const GENERATOR_KEY = "generator";
/** The longest code a picture keeps, and the most inputs it may declare. */
export const MOST_CODE_BYTES = 128 * 1024;
export const MOST_INPUTS = 16;

const KINDS: readonly GeneratorInputKind[] = ["asset", "note", "data"];
const INPUT_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const THEME_TOKENS = ["text1", "text2", "bg1", "bg2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6"] as const;

const bytesOf = (text: string): number => new TextEncoder().encode(text).length;

function asInput(raw: unknown): GeneratorInput[] {
  if (!raw || typeof raw !== "object") return [];
  const o = raw as Record<string, unknown>;
  const kind = KINDS.find((k) => k === o["kind"]);
  if (typeof o["name"] !== "string" || typeof o["value"] !== "string" || !kind) return [];
  return [{ name: o["name"], kind, value: o["value"] }];
}

/** A program read from whatever the field holds; undefined when it is not one. */
export function asGenerator(raw: unknown): PictureGenerator | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o["code"] !== "string") return undefined;
  const last = o["lastRun"];
  const run = last && typeof last === "object" ? (last as Record<string, unknown>) : undefined;
  return {
    language: typeof o["language"] === "string" ? o["language"] : LANGUAGE,
    code: o["code"],
    inputs: Array.isArray(o["inputs"]) ? o["inputs"].flatMap(asInput) : [],
    output: o["output"] === "png" ? "png" : "svg",
    ...(run && typeof run["hash"] === "string" && typeof run["at"] === "number" ? { lastRun: { hash: run["hash"], at: run["at"] } } : {}),
    ...(typeof o["madeBy"] === "string" && o["madeBy"] !== "" ? { madeBy: o["madeBy"] } : {}),
  };
}

/** The program behind a picture, when it has one. */
export function generatorOf(element: Element | undefined): PictureGenerator | undefined {
  if (element?.type !== "image") return undefined;
  return asGenerator((element as unknown as Record<string, unknown>)[GENERATOR_KEY]);
}

/** The selected picture and its program, when exactly one code picture is selected. */
export function selectedCodePicture(state: EditorState): { id: string; slideId: string; generator: PictureGenerator } | undefined {
  const id = state.selection.length === 1 ? state.selection[0] : undefined;
  const slide = state.deck.slides.find((s) => s.id === state.slideId);
  const generator = id && slide ? generatorOf(findElement(slide.elements, id)) : undefined;
  return id && generator ? { id, slideId: state.slideId, generator } : undefined;
}

/** A code picture found in a deck. */
export interface Found {
  slideId: string;
  id: string;
  generator: PictureGenerator;
}

function collect(slideId: string, elements: readonly Element[], into: Found[]): void {
  for (const element of elements) {
    const generator = generatorOf(element);
    if (generator) into.push({ slideId, id: element.id, generator });
    if (element.type === "group") collect(slideId, element.children, into);
  }
}

/** Every code picture of the deck, in reading order. */
export function codePictures(deck: Deck): Found[] {
  const found: Found[] = [];
  for (const slide of deck.slides) collect(slide.id, slide.elements, found);
  return found;
}

/** The program of the code picture `id` on the slide `slideId`, when it still has one. */
export function findCodePicture(deck: Deck, slideId: string, id: string): PictureGenerator | undefined {
  const slide = deck.slides.find((s) => s.id === slideId);
  return generatorOf(slide ? findElement(slide.elements, id) : undefined);
}

/** What is wrong with a program, said as what to change; undefined when it is fine to run. */
export function problemOf(program: Program): string | undefined {
  if (program.language !== LANGUAGE) return `Code pictures are written in JavaScript ("${LANGUAGE}"), not "${program.language.slice(0, 20)}".`;
  if (program.code.trim() === "") return "The code is empty.";
  if (bytesOf(program.code) > MOST_CODE_BYTES) return `The code is longer than ${MOST_CODE_BYTES / 1024} KB.`;
  if (program.inputs.length > MOST_INPUTS) return `A picture may have at most ${MOST_INPUTS} inputs.`;
  for (const [i, input] of program.inputs.entries()) {
    if (!INPUT_NAME.test(input.name)) return `"${input.name.slice(0, 20)}" cannot name an input: use letters, digits and _, starting with a letter.`;
    if (program.inputs.slice(0, i).some((other) => other.name === input.name)) return `Two inputs are called ${input.name}.`;
  }
  return undefined;
}

/** The deck's colours by token, for the drawing kit; a colour that is not a plain `#hex` is left out. */
export function themeOf(deck: Deck): Record<string, string> {
  const colors = deck.theme.colors as unknown as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const token of THEME_TOKENS) {
    const value = colors[token];
    if (typeof value === "string" && HEX.test(value)) out[token] = value;
  }
  return out;
}

const OFFSET = 0xcbf29ce484222325n;
const PRIME = 0x100000001b3n;
const MASK = 0xffffffffffffffffn;

/** FNV-1a over the UTF-8 bytes of `text`, as sixteen hex digits: the hash slides-core and the agent tools use, so a picture run here and one run there agree. */
export function fnv(text: string): string {
  let hash = OFFSET;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * PRIME) & MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

/** Names what a run read besides its code: the inputs' text and the deck's colours. */
export function inputsHash(inputs: readonly InputText[], theme: Readonly<Record<string, string>>): string {
  let basis = "";
  for (const input of inputs) basis += `${input.name}\u0000${bytesOf(input.text)}\u0000${input.text}\u0001`;
  for (const token of Object.keys(theme).sort()) basis += `${token}\u0000${theme[token]}\u0002`;
  return fnv(basis);
}

/** Names a run: the code, what it read and the kind of picture. The same text always has the same hash. */
export function runHash(code: string, read: string, output: GeneratorOutput): string {
  return fnv(`${code}\u0000${read}\u0000${output}`);
}

/** The words a picture's file is named with: the start of the run's hash keeps one file for one result. */
export const fileNameFor = (hash: string, output: GeneratorOutput): string => `code-${hash.slice(0, 8)}.${output}`;

export interface Rectangle {
  x: number;
  y: number;
  w: number;
  h: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * The box a new picture takes in the place of the old one: nothing (null) when the proportions are the same,
 * else the largest box of the new proportions that fits in the old one, centred in it.
 */
export function refit(old: Rectangle, width: number, height: number): Rectangle | null {
  if (!(old.w > 0 && old.h > 0 && width > 0 && height > 0)) return null;
  const aspect = width / height;
  if (Math.abs(old.w / old.h - aspect) / aspect < 0.01) return null;
  let w = old.w;
  let h = old.w / aspect;
  if (h > old.h) {
    h = old.h;
    w = h * aspect;
  }
  return { x: round(old.x + (old.w - w) / 2), y: round(old.y + (old.h - h) / 2), w: round(w), h: round(h) };
}

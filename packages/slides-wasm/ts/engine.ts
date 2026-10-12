// The typed way into slides-core in the browser. The generated glue in
// ../pkg (built by scripts/build-wasm.mjs) is imported here and in references.ts, and nowhere else.

import init, { type InitInput, SlidesEngine, builtInLayouts as layoutNames, expandElement, formatVersion, pageSizes as sizes, readingOrder as orderOf, specs, themeNames, warmUp as warm } from "../pkg/slides_wasm.js";
import { applyChanges } from "./changes.ts";
import { SlidesError } from "./errors.ts";
import { type ExportOptions, type ExportWarning, type PptxExport, packPictures } from "./export.ts";
import type { Changes, Deck, Element, Measures, OpMap, OpName, Probe, Report, Theme } from "./generated/index.ts";
import { type LintOptions, lintArguments } from "./lint.ts";
import { referencesVersion } from "./references.ts";

let ready: Promise<void> | null = null;

/**
 * Loads the WebAssembly module once. In a browser, call it with no argument:
 * the bundler finds the .wasm file beside the glue code. Where there is no
 * fetch to it (tests, a worker with the bytes at hand), pass the bytes or a
 * compiled module.
 */
export function loadSlides(source?: InitInput | Promise<InitInput>): Promise<void> {
  ready ??= init(source === undefined ? undefined : { module_or_path: source }).then(() => undefined);
  return ready;
}

/** What an operation does: what it returned, and what changed. */
export interface Applied<K extends OpName = OpName> {
  output: OpMap[K]["output"];
  changes: Changes;
}

/** An operation's description for a person or an agent: its purpose and JSON Schemas. */
export interface OpSpec {
  name: OpName;
  about: string;
  input: unknown;
  output: unknown;
}

export type Listener = (deck: Deck, changes: Changes) => void;

/** What a new deck is made of besides its title and theme. */
export interface NewDeckOptions {
  /** The size of its slides in slide units (1/96 inch); 960 by 540 when left out. */
  size?: { w: number; h: number };
  /** Start with the theme's example slides (a title, a section, a list, two columns, a picture beside words, a quote and a closing slide) instead of a title slide alone. */
  examples?: boolean;
}

const randomSeed = (): number => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);

function guard<T>(run: () => T): T {
  try {
    return run();
  } catch (thrown) {
    throw SlidesError.from(thrown);
  }
}

/**
 * A deck being edited. It keeps a plain copy of the deck up to date from the
 * changes each operation reports, so reading it costs nothing.
 */
export class DeckEngine {
  private readonly raw: SlidesEngine;
  private current: Deck;
  private readonly listeners = new Set<Listener>();

  private constructor(raw: SlidesEngine) {
    this.raw = raw;
    this.current = JSON.parse(guard(() => raw.deck())) as Deck;
  }

  /** A new deck with a title slide, or with the theme's example slides and a page size of its own when `options` say so. Call `loadSlides` first. */
  static create(title: string, theme = "Light", seed = randomSeed(), options?: NewDeckOptions): DeckEngine {
    if (!options) return new DeckEngine(guard(() => SlidesEngine.create(title, theme, seed)));
    const given = { title, theme, width: options.size?.w, height: options.size?.h, examples: options.examples === true };
    return new DeckEngine(guard(() => SlidesEngine.createWith(JSON.stringify(given), seed)));
  }

  /** Opens the text of a `.deck` file. Call `loadSlides` first. */
  static open(text: string, seed = randomSeed()): DeckEngine {
    return new DeckEngine(guard(() => SlidesEngine.open(text, seed)));
  }

  /**
   * A new deck from a template (the text of a `.deck` file whose look is the point): its theme and page size under a new id and
   * `title`, with the template's slides when `examples`, or one title slide that says the title. Call `loadSlides` first.
   */
  static fromTemplate(template: string, title: string, examples = true, seed = randomSeed()): DeckEngine {
    return new DeckEngine(guard(() => SlidesEngine.createFromTemplate(template, title, examples, seed)));
  }

  /**
   * The text of a template made of this deck, called `title`: its theme and page size and, with `keepSlides`, its slides as
   * examples; otherwise one empty title slide and none of the deck's words. It is a deck file of its own.
   */
  templateText(title: string, keepSlides: boolean, seed = randomSeed()): string {
    return guard(() => this.raw.templateText(title, keepSlides, seed));
  }

  /** The text of the one-slide deck that the layout `name` is designed on (open it with `DeckEngine.open`). */
  layoutDesign(name: string): string {
    return guard(() => this.raw.layoutDesign(name));
  }

  /** The deck as it is now. A new object after every change; slides that did not change are the same objects. */
  get deck(): Deck {
    return this.current;
  }

  /** The deck as a Markdown outline: a heading for each slide, its text, and its notes. */
  outline(): string {
    return guard(() => this.raw.outline());
  }

  /** The text to write to the `.deck` file. */
  save(): string {
    return guard(() => this.raw.save());
  }

  /** Calls `listener` after every change made through this engine, undo and redo included. Returns a function that stops it. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private take(changes: Changes): void {
    this.current = applyChanges(this.current, changes);
    for (const listener of this.listeners) listener(this.current, changes);
  }

  /** Applies an operation by name. Throws a `SlidesError` and changes nothing if it cannot be done. */
  apply<K extends OpName>(op: K, input: OpMap[K]["input"]): Applied<K> {
    const applied = JSON.parse(guard(() => this.raw.apply(op, JSON.stringify(input)))) as Applied<K>;
    this.take(applied.changes);
    return applied;
  }

  /**
   * Applies an operation as part of the last step of undo when that step already covers what the operation changes, so one
   * undo takes both back (a text box and its first words are one step). Call it only right after making that step; otherwise
   * it is a step of its own, as `apply` makes it.
   */
  applyIntoLast<K extends OpName>(op: K, input: OpMap[K]["input"]): Applied<K> {
    const applied = JSON.parse(guard(() => this.raw.applyIntoLast(op, JSON.stringify(input)))) as Applied<K>;
    this.take(applied.changes);
    return applied;
  }

  /** Applies several operations as one step: all take effect or none does, and one undo takes them all back. */
  applyBatch(operations: { [K in OpName]: [K, OpMap[K]["input"]] }[OpName][]): Applied[] {
    const applied = JSON.parse(guard(() => this.raw.applyBatch(JSON.stringify(operations)))) as Applied[];
    if (applied.length > 0) {
      const merged = applied.reduce<Changes>((all, a) => ({ ...all, ...a.changes, slides: { ...all.slides, ...a.changes.slides } }), { slides: {} });
      this.take(merged);
    }
    return applied;
  }

  undo(): Changes | null {
    const text = guard(() => this.raw.undo());
    if (text === undefined || text === null) return null;
    const changes = JSON.parse(text) as Changes;
    this.take(changes);
    return changes;
  }

  redo(): Changes | null {
    const text = guard(() => this.raw.redo());
    if (text === undefined || text === null) return null;
    const changes = JSON.parse(text) as Changes;
    this.take(changes);
    return changes;
  }

  get canUndo(): boolean {
    return this.raw.canUndo();
  }

  get canRedo(): boolean {
    return this.raw.canRedo();
  }

  /** The operation an undo would take back. */
  get undoLabel(): string | undefined {
    return this.raw.undoLabel() ?? undefined;
  }

  get redoLabel(): string | undefined {
    return this.raw.redoLabel() ?? undefined;
  }

  /**
   * The deck as an editable PowerPoint file. `pictures` holds the bytes of the
   * pictures the deck names, by the path it names them with (see `picturePaths`);
   * one that is missing is a grey box and a warning.
   */
  exportPptx(pictures: ReadonlyMap<string, Uint8Array> = new Map(), options: ExportOptions = {}): PptxExport {
    const packed = packPictures(pictures);
    const file = guard(() => this.raw.exportPptx(JSON.stringify(options), packed.names, packed.bytes, packed.lengths));
    try {
      return { bytes: file.bytes, warnings: JSON.parse(file.warnings) as ExportWarning[] };
    } finally {
      file.free();
    }
  }

  /** The works the deck cites, in the order of their numbers: the same list `citationOrder` works out from the deck. */
  citationOrder(): string[] {
    return JSON.parse(guard(() => this.raw.citationOrder())) as string[];
  }

  /** The texts of a slide a page is asked to measure so that lint can tell whether they fit their boxes, as the slide draws them: a citation is the work of the page's bibliography (`setReferences`), not its key. */
  lintProbes(slide: string): Probe[] {
    return JSON.parse(guard(() => this.raw.lintProbes(slide))) as Probe[];
  }

  /** The sizes the engine works out for the texts of a slide, for a page that cannot lay them out: hand them to `lintSlide` as `measures`. */
  lintEstimate(slide: string): Measures {
    return JSON.parse(guard(() => this.raw.lintEstimate(slide))) as Measures;
  }

  /** The problems of one slide. Rules that need what `options` leaves out are named in the report's `skipped`. */
  lintSlide(slide: string, options: LintOptions = {}): Report {
    const [measures, refs] = lintArguments(options);
    return JSON.parse(guard(() => this.raw.lintSlide(slide, measures, refs))) as Report;
  }

  /** The problems of every slide. */
  lintDeck(options: LintOptions = {}): Report {
    const [measures, refs] = lintArguments(options);
    return JSON.parse(guard(() => this.raw.lintDeck(measures, refs))) as Report;
  }

  /** Frees the WebAssembly memory. The engine cannot be used afterwards. */
  dispose(): void {
    this.raw.free();
  }
}

/** Every operation, described. */
export function operationSpecs(): OpSpec[] {
  return JSON.parse(guard(() => specs())) as OpSpec[];
}

/** The built-in themes' names. */
export function builtInThemes(): string[] {
  return JSON.parse(guard(() => themeNames())) as string[];
}

/** The names of the layouts every built-in theme has; a layout that is not among them is one someone made. */
export function builtInLayouts(): string[] {
  return JSON.parse(guard(() => layoutNames())) as string[];
}

/** The page sizes offered by name (16:9, 16:10, 4:3, 1:1), in slide units: what `set_page_size` takes as a preset. */
export function pageSizes(): { name: string; w: number; h: number }[] {
  return JSON.parse(guard(() => sizes())) as { name: string; w: number; h: number }[];
}

/** The deck format version this build reads and writes. */
export function supportedFormatVersion(): number {
  return formatVersion();
}

/**
 * The order to read boxes in, as places in the list given: rows from top to bottom and each
 * row from left to right. A box that is null (an element with no place) comes last.
 * This is the order `build_steps` takes elements in, so a view that lists them in reading
 * order lists them as a build will take them.
 */
export function readingOrder(boxes: readonly ({ x: number; y: number; w: number; h: number } | null)[]): number[] {
  const flat = boxes.map((box) => (box ? [box.x, box.y, box.w, box.h] : null));
  return JSON.parse(guard(() => orderOf(JSON.stringify(flat)))) as number[];
}

/** What an expansion was made for, and what it came to. */
interface Expansion {
  theme: Theme;
  layout: string;
  group: Element | null;
  version: number;
  order: readonly string[] | undefined;
}

/** By the element object: the quick way to know an element was already expanded. */
const expansions = new WeakMap<Element, Expansion>();
/** By what the element says, for each theme: an element that is a new object with the same content (every element of a slide is, after any change to the slide) is not expanded again. */
const byContent = new WeakMap<Theme, Map<string, Expansion>>();
/** The most expansions kept for one theme; the ones asked for longest ago go first. */
const MOST_KEPT = 400;
let expanded = 0;

/** How many times the engine has been asked to expand a composite, in WebAssembly: what a drag or an edit costs, for tests and budgets. */
export function expansionCount(): number {
  return expanded;
}

/**
 * A composite element (code, math, a chat ...) as the group of primitives it is
 * drawn with, in slide coordinates; null for an element that is not a composite
 * or has no box. Kept for as long as the theme, the layout and the content of
 * the element are the same, so drawing a slide again, or a slide that was
 * changed somewhere else, costs nothing.
 *
 * A citation is written from the page's bibliography (`setReferences`) and, with `order`, numbered as the
 * deck numbers its works (see `citationOrder`); a citation drawn again after either changes is written again.
 */
export function expandComposite(theme: Theme, layout: string, element: Element, order?: readonly string[]): Element | null {
  const cites = element.type === "citation";
  const version = cites ? referencesVersion() : 0;
  const kept = expansions.get(element);
  if (kept && kept.theme === theme && kept.layout === layout && kept.version === version && (!cites || kept.order === order || sameKeys(kept.order, order))) return kept.group;
  const numbering = cites && order ? order : undefined;
  const key = `${layout}\u0000${version}\u0000${numbering?.join("\u0001") ?? ""}\u0000${JSON.stringify(element)}`;
  let memo = byContent.get(theme);
  if (!memo) byContent.set(theme, (memo = new Map()));
  const same = memo.get(key);
  if (same) {
    expansions.set(element, same);
    memo.delete(key);
    memo.set(key, same);
    return same.group;
  }
  expanded += 1;
  const text = guard(() => expandElement(JSON.stringify(theme), layout, JSON.stringify(element), numbering ? JSON.stringify(numbering) : undefined));
  const group = text === undefined || text === null ? null : (JSON.parse(text) as Element);
  const made: Expansion = { theme, layout, group, version, order };
  expansions.set(element, made);
  memo.set(key, made);
  if (memo.size > MOST_KEPT) memo.delete(memo.keys().next().value as string);
  return group;
}

/**
 * Does the slow first-use work of drawing a code block (loading the syntax definitions and building the
 * grammar of Python, the language a new block starts in) on a throw-away snippet, so that the first slide
 * with code that a person opens does not wait for it: from 60 ms on a quiet machine to most of a second
 * on a busy one. Call it when the page is idle, once the module is loaded. It changes nothing, and doing
 * it again costs next to nothing. The other languages still build theirs when a block first uses them.
 */
export function warmUp(): void {
  guard(() => warm());
}

function sameKeys(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  return a !== undefined && b !== undefined && a.length === b.length && a.every((key, i) => key === b[i]);
}

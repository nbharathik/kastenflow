// Slide commands: what the filmstrip and the Slide menu do.

import type { Background, Deck, Transition } from "@kasten-slides/wasm";

import type { EditorSession } from "./session.ts";
import type { EditorState } from "./types.ts";

/** Layouts a new slide does not repeat: after a title slide comes a title and body. */
const OPENING = new Set(["title", "section"]);

/** The layout a new slide has when none is asked for: nothing on it, no boxes to fill or to delete. */
export const BLANK = "blank";

/**
 * The layout of a slide with no boxes in a theme: `blank`, or failing that any layout without placeholders (a theme brought
 * from another file may call it something else); undefined when the theme has none.
 */
export function blankLayoutOf(deck: Deck): string | undefined {
  const { layouts } = deck.theme;
  return (layouts.find((layout) => layout.name === BLANK) ?? layouts.find((layout) => layout.placeholders.length === 0))?.name;
}

/** What a new section is called until the person names it. */
export const NEW_SECTION = "Untitled section";

/** The slide the section commands go by: the first of those picked in the filmstrip, in the deck's order, or else the slide shown. */
export function anchorOf(state: Pick<EditorState, "deck" | "slideSelection" | "slideId">): string {
  return state.deck.slides.find((slide) => state.slideSelection.includes(slide.id))?.id ?? state.slideId;
}

export class SlideCommands {
  constructor(private readonly s: EditorSession) {}

  /** The slides a command acts on: those selected in the filmstrip. */
  private get chosen(): string[] {
    return [...this.s.state.slideSelection];
  }

  /**
   * Adds a slide after the current one, and shows it. It is blank unless a layout is named; `likeCurrent` has it on the layout
   * of the slide shown instead (a title and body after an opening layout).
   */
  add(options: { layout?: string; after?: string; backup?: boolean; content?: Record<string, string>; likeCurrent?: boolean } = {}): string | undefined {
    const { deck, slideId } = this.s.state;
    const here = deck.slides.find((slide) => slide.id === slideId);
    const same = here && !OPENING.has(here.layout) ? here.layout : "title-body";
    // Words for slots need a layout that has them.
    const layout = options.layout ?? (options.likeCurrent || options.content ? same : (blankLayoutOf(deck) ?? same));
    const done = this.s.run(() =>
      this.s.core.apply("add_slide", {
        layout,
        after: options.after ?? (slideId || null),
        ...(options.backup ? { backup: true } : {}),
        ...(options.content ? { content: options.content } : {}),
      }),
    );
    if (!done) return undefined;
    this.s.goTo(done.output.slide);
    return done.output.slide;
  }

  duplicate(ids: string[] = this.chosen): string[] {
    const done = this.s.run(() => this.s.core.apply("duplicate_slides", { ids }));
    if (!done) return [];
    this.s.selectSlides(done.output.slides);
    return done.output.slides;
  }

  /** Deletes slides. They can be brought back with undo. */
  remove(ids: string[] = this.chosen): void {
    this.s.run(() => this.s.core.apply("delete_slides", { ids }));
  }

  /** Moves the slides so the first of them is at index `to` among those that stay. */
  move(ids: string[], to: number): void {
    this.s.run(() => this.s.core.apply("move_slides", { ids, to }));
  }

  /** Moves the selected slides `delta` places, keeping them in step with one another. */
  moveBy(delta: number, ids: string[] = this.chosen): void {
    const slides = this.s.state.deck.slides;
    const order = slides.map((slide) => slide.id);
    const picked = order.filter((id) => ids.includes(id));
    const first = order.indexOf(picked[0] ?? "");
    if (first < 0) return;
    const staying = order.length - picked.length;
    const to = Math.min(Math.max(first + delta, 0), staying);
    if (to !== first) this.move(picked, to);
  }

  setFlags(flags: { hidden?: boolean; backup?: boolean }, ids: string[] = this.chosen): void {
    this.s.run(() => this.s.core.apply("set_slide_flags", { ids, ...flags }));
  }

  /** How the slides arrive; null takes the transition away. The slides shown in the filmstrip, unless others are named. */
  setTransition(transition: Transition | null, ids: string[] = this.chosen): void {
    this.s.run(() => this.s.core.apply("set_transition", { ids, transition }));
  }

  /**
   * How every slide arrives that names no transition of its own: the deck's default. A transition of kind `none` takes it away.
   * It is one step of undo and does not touch the slides.
   */
  setDeckTransition(transition: Transition): void {
    const now = this.s.state.deck.present.transition ?? null;
    const wanted = transition.kind === "none" ? null : transition;
    if (JSON.stringify(now) === JSON.stringify(wanted)) return;
    this.s.run(() => this.s.core.apply("set_present", { transition }));
  }

  /** Changes the size of every slide, refitting what is on them and the theme: a preset (`16:9`, `4:3` ...) or a width and height in slide units. */
  setPageSize(size: { preset: string } | { w: number; h: number }): void {
    this.s.run(() => this.s.core.apply("set_page_size", size));
  }

  setLayout(layout: string, slide: string = this.s.state.slideId): void {
    this.s.run(() => this.s.core.apply("set_layout", { slide, layout }));
  }

  setNotes(notes: string, slide: string = this.s.state.slideId): void {
    if ((this.s.state.deck.slides.find((s) => s.id === slide)?.notes ?? "") === notes) return;
    this.s.run(() => this.s.core.apply("set_notes", { slide, notes }));
  }

  /** A colour or image behind the slide; null puts the theme's back. */
  setBackground(background: Background | null, slide: string = this.s.state.slideId): void {
    this.s.run(() => this.s.core.apply("set_background", { slide, background }));
  }

  /** Starts a section at a slide (the anchor, unless one is named), called "Untitled section" until it is renamed. Gives the slide, or nothing when a section already starts there. */
  addSection(at: string = anchorOf(this.s.state), title = NEW_SECTION): string | undefined {
    if (!at || (this.s.state.deck.sections ?? []).some((section) => section.startsAt === at)) return undefined;
    return this.s.run(() => this.s.core.apply("add_section", { at, title })) ? at : undefined;
  }

  /** Gives the section that starts at a slide another name; a name that is empty or the same changes nothing. */
  renameSection(at: string, title: string): void {
    const name = title.trim();
    const now = (this.s.state.deck.sections ?? []).find((section) => section.startsAt === at);
    if (name && now && name !== now.title) this.s.run(() => this.s.core.apply("rename_section", { at, title: name }));
  }

  /** Takes the header of the section that starts at a slide away. Its slides stay. */
  removeSection(at: string): void {
    if ((this.s.state.deck.sections ?? []).some((section) => section.startsAt === at)) this.s.run(() => this.s.core.apply("remove_section", { at }));
  }

  applyTheme(name: string): void {
    this.s.run(() => this.s.core.apply("apply_theme", { name }));
  }

  /** Shows or hides the slide number the theme draws on every slide: the deck's choice, in the editor, when presenting and in a file. */
  setSlideNumbers(on: boolean): void {
    if (this.s.state.deck.present.slideNumbers === on) return;
    this.s.run(() => this.s.core.apply("set_present", { slideNumbers: on }));
  }

  setTitle(title: string): void {
    if (title.trim() && title !== this.s.state.deck.title) this.s.run(() => this.s.core.apply("set_title", { title }));
  }
}

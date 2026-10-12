// What the layout dialogs do to the deck: each is one operation of the engine, so each is one step of undo, and a refusal is
// told to the person (the session's `run`) and answers nothing.

import type { Slide, Theme } from "@kasten-slides/wasm";

import type { EditorSession } from "../session/session.ts";

export interface SaveAsLayout {
  /** What people call the layout. */
  label: string;
  /** Which elements are slots: element id to kind (`title`, `subtitle`, `body`, `text`, `picture`, `caption`). The rest of the slide is decoration. */
  roles: Record<string, string>;
  /** Put the slide on the new layout (on unless said otherwise). */
  useForSlide?: boolean;
  /** Make it the layout new slides start from. */
  newSlideDefault?: boolean;
  /** The slide to save; the one shown when left out. */
  slide?: string;
}

/** Saves a slide as a layout; answers the name of the new layout. */
export function saveSlideAsLayout(session: EditorSession, input: SaveAsLayout): string | undefined {
  const { slide = session.state.slideId, label, roles, useForSlide = true, newSlideDefault = false } = input;
  const done = session.run(() => session.core.apply("save_layout", { slide, label, roles, useForSlide, newSlideDefault }));
  return done?.output.layout;
}

/** Adds a layout, empty or as a copy of `from`; answers its name. */
export function addLayout(session: EditorSession, label: string, from?: string): string | undefined {
  const done = session.run(() => session.core.apply("add_layout", { label, ...(from ? { from } : {}) }));
  return done?.output.layout;
}

/** Renames a layout, hides the master on it, or makes it the one new slides start from. */
export function editLayout(session: EditorSession, name: string, change: { label?: string; hideMaster?: boolean; defaultForNew?: boolean }): void {
  session.run(() => session.core.apply("edit_layout", { name, ...change }));
}

export function moveLayout(session: EditorSession, name: string, to: number): void {
  session.run(() => session.core.apply("move_layout", { name, to }));
}

/** Deletes a layout; the slides that use it go to `moveTo`. Answers whether it was done. */
export function deleteLayout(session: EditorSession, name: string, moveTo?: string): boolean {
  return session.run(() => session.core.apply("delete_layout", { name, ...(moveTo ? { moveTo } : {}) })) !== undefined;
}

/** Puts the slots of slides back where their layout has them. The slides shown in the filmstrip unless others are named. */
export function resetSlides(session: EditorSession, ids?: readonly string[]): void {
  const { slideSelection, slideId } = session.state;
  const wanted = ids ?? (slideSelection.length > 0 ? slideSelection : [slideId]);
  session.run(() => session.core.apply("reset_slides", { ids: [...wanted] }));
}

/** Sets a layout from the slide it was designed on. Answers the ids of what filled a slot that is gone. */
export function setLayoutDesign(session: EditorSession, name: string, design: Slide, hideMaster?: boolean): string[] | undefined {
  const done = session.run(() => session.core.apply("set_layout_design", { name, design, ...(hideMaster === undefined ? {} : { hideMaster }) }));
  return done?.output.detached;
}

/** Puts a template's look on the deck: its theme and, when `resize`, its page size. The words and elements of every slide stay. */
export function applyTemplateTheme(session: EditorSession, template: { theme: Theme; size: { w: number; h: number } }, resize: boolean): boolean {
  return session.run(() => session.core.apply("apply_template", { theme: template.theme, size: template.size, ...(resize ? { resize } : {}) })) !== undefined;
}

/** How many slides use a layout. */
export const slidesOn = (session: EditorSession, name: string): number => session.deck.slides.filter((slide) => slide.layout === name).length;

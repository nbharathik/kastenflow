// What New slide makes. A slide added with no layout named is blank; the person can ask for the layout of the slide shown instead
// (View > New slides, or the choice under the filmstrip's arrow), and that choice is kept in this browser with the other
// window preferences. Every way of adding a slide without naming a layout comes through here.

import { myDefaultLayout } from "./layouts/default-layout.ts";
import type { EditorSession } from "./session/session.ts";
import type { EditorUi } from "./ui-state.ts";

export interface NewSlideOptions {
  /** A layout of the deck's theme: the slide is on it whatever the preference says. */
  layout?: string;
  /** The slide to add it after; the slide shown when absent. */
  after?: string;
}

/** The layouts a new slide can start from: the theme's, in the order it lists them. */
export function newSlideLayouts(session: EditorSession): { name: string; label: string }[] {
  return session.deck.theme.layouts.map(({ name, label }) => ({ name, label }));
}

/**
 * Adds a slide the way the person asked for: blank, on the layout of the slide shown, or on the deck's own default layout (the one
 * marked "default for new slides", blank when none is). Shows it and answers its id.
 */
export function addSlide(session: EditorSession, ui: EditorUi, options: NewSlideOptions = {}): string | undefined {
  const mine = ui.state.newSlides === "mine" && !options.layout ? myDefaultLayout(session.deck) : undefined;
  return session.slides.add({ ...options, ...(mine ? { layout: mine } : {}), likeCurrent: ui.state.newSlides === "same" });
}

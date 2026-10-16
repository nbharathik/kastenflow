// How the outline changes a deck: words go in as Markdown through the engine's
// `set_text`, one operation for each change and so one step of undo. The first
// title typed into an empty slide first gives the slide the layout of a title
// alone, which makes the box. Nothing else in the outline writes to the deck.

import type { Deck, Slide } from "@kasten-slides/wasm";

import type { EditorSession } from "../session/session.ts";
import { guardStart, textToMarkdown, titleMarkdown } from "./markdown.ts";
import { bodyElement, titleElement } from "./titles.ts";

export type Field = "title" | "body";

/** The layout of a title alone, which a title typed into an empty slide is made in: `title-only`, else any layout whose one box is a title. */
export function titleLayoutOf(deck: Deck): string | undefined {
  const { layouts } = deck.theme;
  return (layouts.find((layout) => layout.name === "title-only") ?? layouts.find((layout) => layout.placeholders.length === 1 && layout.placeholders[0]?.role === "title"))?.name;
}

/** Whether a title can be typed into this slide from the outline: it has nothing on it at all, and the theme has a layout for a title alone. */
export const canStartTitle = (deck: Deck, slide: Slide): boolean => slide.elements.length === 0 && titleLayoutOf(deck) !== undefined;

/** Replaces the words of a text with Markdown. Answers whether it was done (the slide or the text may have gone). */
export function setMarkdown(session: EditorSession, slide: string, id: string, markdown: string): boolean {
  const there = session.state.deck.slides.find((s) => s.id === slide)?.elements.some((element) => element.id === id);
  if (!there) return false;
  return session.run(() => session.core.apply("set_text", { slide, id, markdown })) !== undefined;
}

/** The Markdown a slide's title or body holds now, as the outline shows it; empty when the slide has no such text. */
export function readField(session: EditorSession, slide: string, field: Field): string {
  const found = session.state.deck.slides.find((s) => s.id === slide);
  const element = found && (field === "title" ? titleElement(found) : bodyElement(found));
  if (!element) return "";
  return field === "title" ? titleMarkdown(element.text) : textToMarkdown(element.text);
}

/** Words without the space at the ends of the lines or the text, which say nothing. */
const plain = (words: string): string =>
  words
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();

/**
 * The first words typed as the title of a slide with nothing on it: the slide is given the layout of a title alone, which puts the title
 * box where that layout has it, and the words go in it. One step of undo. Answers whether a title was made.
 */
export function createTitle(session: EditorSession, slide: string, typed: string): boolean {
  const found = session.state.deck.slides.find((s) => s.id === slide);
  const layout = titleLayoutOf(session.state.deck);
  const words = guardStart(typed.replace(/\s*\n\s*/g, " "));
  if (!found || !layout || found.elements.length > 0 || plain(words) === "") return false;
  if (session.run(() => session.core.apply("set_layout", { slide, layout })) === undefined) return false;
  const made = session.state.deck.slides.find((s) => s.id === slide);
  const title = made ? titleElement(made) : undefined;
  // The words are part of the step that made the box, so one undo takes both away.
  if (title) session.run(() => session.core.applyIntoLast("set_text", { slide, id: title.id, markdown: words }));
  return true;
}

/**
 * Writes what was typed in the title or the body of a slide, unless the slide
 * already says it. A title is one line of Markdown, whose start is kept from
 * being taken for a list.
 */
export function writeField(session: EditorSession, slide: string, id: string, field: Field, typed: string): void {
  const element = session.state.deck.slides.find((s) => s.id === slide)?.elements.find((e) => e.id === id);
  if (!element || element.type !== "text") return;
  const now = field === "title" ? titleMarkdown(element.text) : textToMarkdown(element.text);
  const next = field === "title" ? guardStart(typed.replace(/\s*\n\s*/g, " ")) : typed;
  if (plain(next) === plain(now)) return;
  setMarkdown(session, slide, id, next);
}

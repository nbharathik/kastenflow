// Slides made from Markdown: the words of the Markdown cut at its headings into a slide each, put after the slide shown, as one step of
// undo. The engine does the cutting (`add_page_slides`, the operation the Insert › Page dialog uses for a page of the host); the words may
// be pasted, read from a file, or come from a page the host picks.

import { pageBody } from "@kasten-slides/wasm";

import type { EditorSession } from "../session/session.ts";

/** The heading level a slide starts at; 0 lets the Markdown's own shape decide. */
export type SplitLevel = 0 | 1 | 2 | 3;

/** What a file is called, without its ending: the title of the slide that holds the words before the first heading. */
export function titleOfFile(name: string): string {
  const title = name.replace(/\.(md|markdown|txt)$/i, "").trim();
  return title === "" ? "Imported Markdown" : title;
}

/** Whether there is anything to make slides from: words other than a frontmatter block and blank lines. */
export const hasWords = (markdown: string): boolean => pageBody(markdown).trim() !== "";

/** Puts the Markdown on slides after the one shown and goes to the first; answers how many were made, or 0 when none were. */
export function slidesFromMarkdown(session: EditorSession, markdown: string, title: string, split: SplitLevel = 0): number {
  const body = pageBody(markdown);
  if (body.trim() === "") return 0;
  const done = session.run(() => session.core.apply("add_page_slides", { markdown: body, title: titleOfFile(title), split, sizes: {}, after: session.state.slideId }));
  const made = done?.output.slides ?? [];
  const [first] = made;
  if (first) session.goTo(first);
  return made.length;
}

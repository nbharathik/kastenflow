// A text box made by the text tool or by the T key starts empty and open for
// typing. Closed with nothing typed it is of no use: nothing shows of it, and
// only a rectangle dragged round it would find it again. So it is taken away,
// as Google Slides and PowerPoint do; once words are typed it is a box like any
// other. Only a box made just now is treated so, never one the person opens.

import type { Element, Text } from "@kasten-slides/wasm";

import type { EditorSession } from "../session/session.ts";

interface Mark {
  id: string;
  /** The slide it was made on: it can only be taken from there. */
  slide: string;
  /** The count of changes to the deck just after it was made; the same count later means nothing has happened to the deck since. */
  revision: number;
}

const marks = new WeakMap<EditorSession, Mark>();

/** Notes that a text box has just been made and opened, to be settled when its editing ends. */
export function markFresh(session: EditorSession, id: string): void {
  marks.set(session, { id, slide: session.state.slideId, revision: session.state.revision });
}

/**
 * Whether the box was made just now on that slide and nothing has been done to the deck since: the words typed into it then
 * join the step that made it, so one undo takes the box and its words back together.
 */
export function isUntouched(session: EditorSession, id: string, slide: string): boolean {
  const mark = marks.get(session);
  return mark !== undefined && mark.id === id && mark.slide === slide && mark.revision === session.state.revision && session.state.undoLabel === "add_elements";
}

const isBlank = (text: Text): boolean => text.paragraphs.every((paragraph) => paragraph.runs.every((run) => run.t === "" && !run.field));

/** A fill or an outline is something to see even where there are no words. */
const shows = (element: Element): boolean => element.style?.fill != null || element.style?.stroke != null;

/**
 * Called when the editing of a box has ended and what was typed is in the deck. A box that was just made and still has
 * nothing in it goes: by undo when nothing else has happened since, which leaves the history as it was, else as a step
 * of its own that undo can take back. A box with anything of its own to see stays.
 */
export function settleFresh(session: EditorSession, id: string): void {
  const mark = marks.get(session);
  // Still open: the text layer is only being set up again (as a development build does on purpose), not closed.
  if (!mark || mark.id !== id || session.state.editing === id) return;
  marks.delete(session);
  if (mark.slide !== session.state.slideId) return;
  const element = session.slide.elements.find((e) => e.id === id);
  if (!element || element.type !== "text" || !isBlank(element.text) || shows(element)) return;
  if (session.state.revision === mark.revision && session.state.undoLabel === "add_elements") session.undo();
  else session.elements.remove([id]);
}

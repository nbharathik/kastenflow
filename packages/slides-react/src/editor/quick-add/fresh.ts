// A text box made by the text tool, the T key, the Insert menu or the gallery starts empty and open for typing. It stays where it was put
// even if it is closed with nothing typed (it shows a prompt and a faint outline in the editor, and the check of the deck reports it
// while it is empty), as in Keynote. What is remembered here is only which box was made just now, so that the first words typed into it
// are one step of undo with the box: one Undo takes the box and its words back together.

import type { EditorSession } from "../session/session.ts";

interface Mark {
  id: string;
  /** The slide it was made on: the words can only join the step from there. */
  slide: string;
  /** The count of changes to the deck just after it was made; the same count later means nothing has happened to the deck since. */
  revision: number;
}

const marks = new WeakMap<EditorSession, Mark>();

/** Notes that a text box has just been made and opened. */
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

/**
 * Called when the editing of a box has ended and what was typed is in the deck: the box is no longer the one made just now, so words
 * typed into it later are a step of their own. A box still open (the text layer being set up again, as a development build does on
 * purpose) keeps its mark. Nothing is ever removed here.
 */
export function spendFresh(session: EditorSession, id: string): void {
  const mark = marks.get(session);
  if (mark && mark.id === id && session.state.editing !== id) marks.delete(session);
}

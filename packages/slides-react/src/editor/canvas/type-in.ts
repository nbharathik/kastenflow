// Typing a character with a text box selected (not open) opens it, and the character is the first thing in it, as in PowerPoint and
// Keynote. The box takes the key before the slide's one-letter shortcuts do, because a person who selected a box and types means to write.

import type { Text } from "@kasten-slides/wasm";

import { isUntouched } from "../quick-add/fresh.ts";
import type { EditorSession } from "../session/session.ts";

/** The keys of a key press that matter here (a `KeyboardEvent` has them all). */
export interface TypedKey {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
}

/** Whether the key is a character that would be typed: one visible character with no chord, and not Space (which holds the hand tool on the slide). */
export function isTyping(event: TypedKey): boolean {
  return !event.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1 && event.key !== " ";
}

/** The words with `char` at their end, in the style of the last run. */
function withCharacter(text: Text, char: string): Text {
  const paragraphs = text.paragraphs.map((paragraph) => ({ ...paragraph, runs: [...paragraph.runs] }));
  const last = paragraphs[paragraphs.length - 1];
  if (!last) return { ...text, paragraphs: [{ runs: [{ t: char }] }] };
  const run = last.runs[last.runs.length - 1];
  if (run && !run.field) last.runs[last.runs.length - 1] = { ...run, t: run.t + char };
  else last.runs.push({ t: char });
  return { ...text, paragraphs };
}

/**
 * Opens the one selected text box with `event.key` as its last character. Answers whether it did; false leaves the key to whatever
 * else wants it (a shape, a table, several things selected, a locked box, a tool in hand).
 */
export function typeIntoSelection(session: EditorSession, event: TypedKey): boolean {
  const { selection, tool, editing, slideId } = session.state;
  if (!isTyping(event) || tool !== "select" || editing !== null || selection.length !== 1) return false;
  const element = session.scope.find((e) => e.id === selection[0]);
  if (element?.type !== "text" || element.locked) return false;
  session.elements.setText(element.id, withCharacter(element.text, event.key), slideId, isUntouched(session, element.id, slideId));
  session.startEditing(element.id);
  return true;
}

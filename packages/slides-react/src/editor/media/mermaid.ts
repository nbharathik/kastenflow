// A Mermaid flowchart written as text, drawn as native shapes and arrows (the engine's `add_mermaid`), held in one group that keeps the text so
// the chart can be edited as text and laid out again.

import type { Element } from "@kasten-slides/wasm";

import type { EditorSession } from "../session/session.ts";

/** What a new chart starts as: something to look at and change. */
export const SAMPLE_MERMAID = ["flowchart LR", "  A[Idea] --> B{Worth it?}", "  B -->|yes| C[Build]", "  B -->|no| D[Park it]", "  C --> E((Ship))"].join("\n");

/** The Mermaid text a group was made from; null for anything else. The text rides on the group as the field `mermaid`. */
export function mermaidOf(element: Element | undefined): string | null {
  if (!element || element.type !== "group") return null;
  const text = (element as unknown as { mermaid?: unknown }).mermaid;
  return typeof text === "string" ? text : null;
}

/** The chart that is selected, when exactly one group made from Mermaid text is. */
export function selectedChart(session: EditorSession): { id: string; source: string } | null {
  const [only, ...rest] = session.elements.find();
  if (!only || rest.length > 0) return null;
  const source = mermaidOf(only);
  return source === null ? null : { id: only.id, source };
}

/** Draws a chart on the shown slide and selects it: one step of undo. Resolves to the id of its group, or undefined when the text was refused (the person is told). */
export function addMermaid(session: EditorSession, source: string): string | undefined {
  const done = session.run(() => session.core.apply("add_mermaid", { slide: session.state.slideId, source }));
  const group = done?.output.group;
  if (group) session.select([group]);
  return group;
}

/** Writes the text of a chart again and lays it out afresh in the same place: one step of undo. False when the text was refused. */
export function updateMermaid(session: EditorSession, id: string, source: string): boolean {
  const done = session.run(() => session.core.apply("update_mermaid", { slide: session.state.slideId, id, source }));
  if (done) session.select([id]);
  return done !== undefined;
}

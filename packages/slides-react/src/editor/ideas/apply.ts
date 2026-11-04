// Doing an idea, and putting a block on the slide: each is one engine call, so each is one step of undo.

import type { EditorSession } from "../session/session.ts";
import { freeBox } from "../insert-composite.ts";
import { type BlockKind, blockElement, blockSpec } from "./blocks.ts";
import type { Idea } from "./ideas.ts";

/** Lays the idea on the slide it was worked out for. Answers whether it was done. */
export function applyIdea(session: EditorSession, idea: Idea): boolean {
  const done = session.run(() => session.core.applyBatch(idea.operations));
  return done !== undefined;
}

/** Puts a block on the shown slide in the largest free place, selected; answers the id of the group. */
export function insertBlock(session: EditorSession, kind: BlockKind): string | undefined {
  const spec = blockSpec(kind);
  const { w, h } = session.deck.size;
  const box = freeBox(session, { w: Math.round(w * spec.size.w), h: Math.round(h * spec.size.h) });
  return session.elements.insert([blockElement(kind, box, w)])[0];
}

// What the chat is about when a tab is in front: the chip it follows and the
// thing a chat can be tied to. A page is tied by its id (a rename does not
// touch it); a deck, whiteboard, diagram or LaTeX document by its path.

import type { NoteMeta } from "../../../lib/vault/types";
import { titleOf } from "../../workspace/names";
import { noteAt } from "../../workspace/tree";
import type { Binding } from "../agent-types";
import { boardChip, diagramChip, latexChip, noteChip } from "../context";
import type { ActiveTarget } from "../open-pages";
import type { Chip } from "../thread";

/** The file's name without its folder or extension. */
export const stemOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "") || path;

/** The file's name with its ending (a LaTeX file is told by it: `main.tex`). */
const fileNameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1) || path;

/** The thing a chat is tied to for this target. */
export function bindingOf(target: ActiveTarget, notes: readonly NoteMeta[]): Binding {
  if (target.kind === "page") {
    const id = noteAt(notes, target.path)?.id;
    return { kind: "page", path: target.path, ...(id ? { id } : {}) };
  }
  return { kind: target.kind, path: target.path };
}

/** The chip that follows this target, or none while it cannot be made (the page is not in the list yet). A LaTeX file's chip is named by its file; the backend reads its text and the last build's errors when a message is sent. */
export function followChip(target: ActiveTarget | null, notes: readonly NoteMeta[], boards: readonly { path: string; title: string }[]): Chip | null {
  if (!target) return null;
  switch (target.kind) {
    case "page": {
      const note = noteAt(notes, target.path);
      return note ? noteChip(note) : null;
    }
    case "board":
      return boardChip({ path: target.path, title: boards.find((b) => b.path === target.path)?.title ?? stemOf(target.path) });
    case "deck":
      return { kind: "deck", label: stemOf(target.path), ref: [target.path] };
    case "diagram":
      return diagramChip({ path: target.path, title: stemOf(target.path) });
    case "latex":
      return latexChip({ path: target.path, title: fileNameOf(target.path) });
    default:
      return null;
  }
}

/** The page's title for the binding chip in a chat's header. */
export function bindingTitle(binding: Binding, notes: readonly NoteMeta[]): string {
  const note = binding.kind === "page" ? (binding.id ? notes.find((n) => n.id === binding.id) : undefined) ?? noteAt(notes, binding.path) : undefined;
  return note ? titleOf(note) : stemOf(binding.path);
}

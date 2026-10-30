// What a chat is grounded in: chips for a page, cards, a
// board, a tag view or search results. The backend reads what each stands
// for when a message is sent.

import type { BoardInfo, NoteMeta, TagView } from "../../lib/vault/types";
import { titleOf } from "../workspace/names";
import type { Chip } from "./thread";

export function noteChip(note: NoteMeta): Chip {
  return { kind: "note", label: titleOf(note), ref: [note.path] };
}

export function cardsChip(notes: readonly NoteMeta[]): Chip {
  const label = notes.length === 1 ? titleOf(notes[0]!) : `${notes.length} cards`;
  return { kind: "cards", label, ref: notes.map((n) => n.path) };
}

export function boardChip(board: Pick<BoardInfo, "path" | "title">): Chip {
  return { kind: "board", label: board.title, ref: [board.path] };
}

/** A tag's notes as one of its views shows them. */
export function tagChip(tag: string, view: TagView | null): Chip {
  return { kind: "tag", label: view ? `#${tag} · ${view.name}` : `#${tag}`, ref: view ? [tag, view.name] : [tag] };
}

export function searchChip(query: string): Chip {
  const q = query.trim();
  return { kind: "search", label: `“${q}”`, ref: [q] };
}

/** A diagram as the tools would describe it: its cells with their ids and the checks' findings. `page` names one page of a diagram that has several. */
export function diagramChip(diagram: { path: string; title: string }, page?: string): Chip {
  return { kind: "diagram", label: diagram.title, ref: page ? [diagram.path, page] : [diagram.path] };
}

/** A LaTeX file as the tools would read it: its text with the hash a change must bring back, and what the document's last build said (each error with its file and line). The selected passage rides along as a selection chip. */
export function latexChip(file: { path: string; title: string }): Chip {
  return { kind: "latex", label: file.title, ref: [file.path] };
}

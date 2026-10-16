// What the store does with an event besides folding it into its thread: tell
// lists and open pages what a tool wrote, and say what a turn's end is to
// someone who was elsewhere.

import { boardFilesChanged } from "../boards/events";
import { diagramFilesChanged } from "../diagrams/store";
import { deckFilesChanged } from "../slides/events";
import { useWorkspace } from "../workspace/store";
import type { ChatEvent } from "./types";
import type { Outcome } from "./unread";

/** Notes and boards a tool wrote, so lists and open pages show them. */
export function touched(paths: string[]): void {
  const notes = paths.filter((p) => p.endsWith(".md"));
  if (notes.length > 0) void useWorkspace.getState().filesChanged(notes);
  boardFilesChanged(paths);
  // An open deck takes in what a tool changed in it, and so does an open diagram.
  deckFilesChanged(paths);
  diagramFilesChanged(paths);
}

/** What a turn's end is to someone who was elsewhere: it finished, stopped for them, or failed. A stop is none of these. */
export const outcomeOf = (event: ChatEvent): Outcome | null => (event.kind === "paused" ? "needs" : event.kind === "error" ? "failed" : event.kind === "done" && !event.stopped ? "done" : null);

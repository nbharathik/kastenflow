// SyncTeX both ways. Forward: a line of the source to its place in the PDF
// (the button, the palette, Ctrl/Cmd+click in the text); the place is scrolled
// to and marked for a moment. Inverse: a place in the PDF to its line in the
// source (double-click in the PDF, or Enter on the page column), opening the
// file it belongs to. The window around supplies the pieces, so the logic is
// tested without one.

import { sentence } from "./backend";
import type { DocFile, SyncHit, SyncSpot } from "./types";

export interface ForwardDeps {
  /** Where `line` of `path` is in the PDF (the first box), or null. */
  where(path: string, line: number): Promise<SyncHit | null>;
  /** Scrolls to the box and marks it; resolves when it is shown, or false when no PDF is on screen. */
  show(hit: SyncHit): Promise<unknown>;
  say(text: string): void;
}

/** Shows a source line in the PDF; says why in a sentence when it cannot. */
export async function syncForward(deps: ForwardDeps, path: string | null, line: number): Promise<boolean> {
  if (!path) return false;
  try {
    const hit = await deps.where(path, line);
    if (!hit) {
      deps.say("There is no place in the PDF for that line yet. Build the document first.");
      return false;
    }
    await deps.show(hit);
    return true;
  } catch (err) {
    deps.say(sentence(err));
    return false;
  }
}

export interface InverseDeps {
  folder: string;
  files(): readonly DocFile[];
  /** Asks the app which source line a point of a page was typeset from. */
  inverse(page: number, x: number, y: number): Promise<SyncSpot>;
  /** Opens the file (if it is not open) and puts the caret on the line. */
  goTo(path: string, line: number): void;
  say(text: string): void;
}

/** Jumps from a point of the PDF to its source line. */
export async function syncInverse(deps: InverseDeps, point: { page: number; x: number; y: number }): Promise<boolean> {
  let spot: SyncSpot;
  try {
    spot = await deps.inverse(point.page, point.x, point.y);
  } catch (err) {
    deps.say(sentence(err));
    return false;
  }
  const path = `${deps.folder}/${spot.file}`;
  const file = deps.files().find((f) => f.path === path);
  if (!file?.editable) {
    deps.say(`That part of the PDF comes from ${spot.file}, which cannot be edited here.`);
    return false;
  }
  deps.goTo(path, spot.line);
  return true;
}

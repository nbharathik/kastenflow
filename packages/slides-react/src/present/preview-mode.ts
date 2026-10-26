// How a deck's web page preview opens: over the slide (the default), beside it, or over the whole window. The last way the person chose
// is kept for the deck, in this browser; storage that is missing or refused just means the default every time.

import type { PreviewMode } from "../editor/web-preview-host.ts";
import { readChoice, writeChoice } from "../editor/ui-prefs.ts";

const MODES = ["center", "side", "full"] as const satisfies readonly PreviewMode[];

const keyOf = (deckId: string): string => `ks-web-preview-mode:${deckId}`;

/** The way this deck's pages last opened; over the slide when none was chosen. */
export const readPreviewMode = (deckId: string, fallback: PreviewMode = "center"): PreviewMode => readChoice(keyOf(deckId), MODES, fallback);

export const writePreviewMode = (deckId: string, mode: PreviewMode): void => writeChoice(keyOf(deckId), mode);

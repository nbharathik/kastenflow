// Sound for a slide: a file the person chose is kept with the deck's files (the store pictures and videos go to), and an audio element is
// made from the path it has there. A web address of an audio file is kept as it is.

import type { Element } from "@kasten-slides/wasm";

import { insertPlaced } from "../insert-composite.ts";
import { pickFiles } from "../files.ts";
import type { EditorSession } from "../session/session.ts";

/** The file kinds the chooser offers. */
export const AUDIO_ACCEPT = "audio/*,.mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.flac";

/** How big the chip of a new sound is, and so how big its click target is in a show. */
export const AUDIO_SIZE = { w: 160, h: 140 };

const EXTENSION = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba)(?:[?#].*)?$/i;

/**
 * The source of a sound, from what was typed: a web address (any `http` or `https` one), or the name of an audio file the deck's store
 * holds. Null for nothing, for a script or mail address, and for a name that is not an audio file.
 */
export function audioSource(input: string): string | null {
  const typed = input.trim();
  if (typed === "" || /\p{Cc}/u.test(typed)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(typed)) return /^https?:\/\//i.test(typed) ? typed : null;
  return EXTENSION.test(typed) ? typed : null;
}

/** Asks for an audio file and keeps it. Resolves to the path it has in the deck's files, or null (the person is told why when the host would not keep it). */
export async function importAudioFile(session: EditorSession): Promise<string | null> {
  const [file] = await pickFiles(AUDIO_ACCEPT);
  if (!file) return null;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return await session.host.addImage(file.name, bytes, { source: "file" });
  } catch (error) {
    session.host.notify?.(error instanceof Error && error.message ? error.message : `“${file.name}” could not be kept with the deck.`);
    return null;
  }
}

/** Puts a sound on the shown slide, in a free corner at the bottom, selected: one step of undo. Resolves to its id. */
export function insertAudio(session: EditorSession, src: string): string | undefined {
  return insertPlaced(session, { type: "audio", id: "", src } as Element, AUDIO_SIZE, "bottom-right");
}

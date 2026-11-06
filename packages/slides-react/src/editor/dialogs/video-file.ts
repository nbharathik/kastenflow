// A video file the person chose: it is kept with the deck's files (the same store pictures go to), and the video is made from the path it
// has there. Storing only the file's name, as this once did, meant the video played only on the computer that had the file beside the deck.

import { pickFiles } from "../files.ts";
import type { EditorSession } from "../session/session.ts";

/**
 * Asks for a video file and keeps it. Resolves to the path it has in the deck's files, or to null when nothing was chosen or the host
 * would not keep it (too big, or not a kind of file it keeps); the person is told why in that case.
 */
export async function importVideoFile(session: EditorSession): Promise<string | null> {
  const [file] = await pickFiles("video/*");
  if (!file) return null;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return await session.host.addImage(file.name, bytes, { source: "file" });
  } catch (error) {
    session.host.notify?.(error instanceof Error && error.message ? error.message : `“${file.name}” could not be kept with the deck.`);
    return null;
  }
}

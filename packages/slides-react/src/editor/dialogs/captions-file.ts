// A captions file the person chose (WebVTT): it is kept with the deck's files, by the same path a picture or a video file goes, and the
// video names the path it has there.

import { pickFiles } from "../files.ts";
import type { EditorSession } from "../session/session.ts";

/** Whether the text is a WebVTT file: it starts with `WEBVTT` (after a byte order mark). */
export function isWebVtt(text: string): boolean {
  const bare = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return /^WEBVTT(?:[ \t\r\n]|$)/.test(bare);
}

/**
 * Asks for a captions file and keeps it. Resolves to the path it has in the deck's files, or to null when nothing was chosen, the file is
 * not WebVTT, or the host would not keep it; the person is told why in the last two cases.
 */
export async function importCaptionsFile(session: EditorSession): Promise<string | null> {
  const [file] = await pickFiles(".vtt,text/vtt");
  if (!file) return null;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isWebVtt(new TextDecoder().decode(bytes.subarray(0, 64)))) {
      session.host.notify?.(`“${file.name}” is not a WebVTT captions file: it should start with WEBVTT.`);
      return null;
    }
    return await session.host.addImage(file.name, bytes, { source: "file" });
  } catch (error) {
    session.host.notify?.(error instanceof Error && error.message ? error.message : `“${file.name}” could not be kept with the deck.`);
    return null;
  }
}

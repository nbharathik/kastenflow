// The picture of a video embed. A YouTube or Vimeo link has a thumbnail on the web; when an embed of one is made the host fetches it and
// the editor keeps it with the deck's pictures (`addImage`), and sets it as the embed's poster. With it the slide is never a blank panel,
// and a PDF, a PowerPoint file and a show that is offline have the picture too. Nothing here is the person's to be told about when it
// fails: the embed works without a poster, and one can be chosen in the format options.

import { posterSourceOf } from "../embed/embed-url.ts";
import type { EditorSession } from "./session/session.ts";

/**
 * Fetches the thumbnail of the video `address` names, keeps it as a picture of the deck, and makes it the poster of the embed `id`, as
 * one step. Resolves to the path of the picture, or to null when there was nothing to do or it could not be had. The embed keeps a
 * poster it has by then (the person chose one while this was on its way).
 */
export async function addEmbedPoster(session: EditorSession, id: string, address: string): Promise<string | null> {
  const { host } = session;
  const source = posterSourceOf(address);
  if (!source || !host.fetchPoster) return null;
  try {
    const picture = await host.fetchPoster(source);
    if (!picture) return null;
    const path = await host.addImage(picture.name, picture.bytes, { source: "file" });
    const [element] = session.elements.find([id]);
    // The embed may be gone by now, or the person may have chosen a poster of their own.
    if (!element || element.type !== "embed" || (element.poster ?? "") !== "") return path;
    session.elements.patch({ poster: path }, [id]);
    return path;
  } catch {
    // A poster is a nicety: no thumbnail on the web, no network, or a picture the store would not keep, and the embed still plays.
    return null;
  }
}

// A picture of a diagram that changed after the picture was drawn. The deck keeps
// with each picture the version of its diagram it came from; the host says what
// version the diagram is at now. Where they differ the picture is out of date:
// the canvas badges it, and Refresh draws the diagram again and swaps the new
// picture in as one step of undo. A picture the person worked on (cropped,
// described) is not overwritten without asking: Refresh can keep that work.

import type { Element } from "@kasten-slides/wasm";

import { diagramOf, editedLocally, pictureName, replaceDiagram, replaceDiagramKeeping, revisionOf } from "./diagrams.ts";
import type { EditorSession } from "./session/session.ts";

/** A picture on the shown slide whose diagram has changed since it was drawn. */
export interface StaleDiagram {
  /** The picture's element id. */
  id: string;
  /** The diagram it is of, as the host names diagrams. */
  source: string;
  /** What the diagram is called. */
  name: string;
  /** The person cropped it or wrote its description: a new picture would lose that. */
  edited: boolean;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Every image on the slide, also inside groups. */
function images(elements: readonly Element[]): Element[] {
  return elements.flatMap((element) => (element.type === "group" ? images(element.children) : element.type === "image" ? [element] : []));
}

/**
 * The pictures of diagrams on the shown slide that are out of date. A picture that kept no version (drawn before decks kept them),
 * a diagram the host cannot find and a host that cannot say are not listed: nothing is claimed that is not known. The host is asked
 * once for each diagram.
 */
export async function staleDiagrams(session: EditorSession): Promise<StaleDiagram[]> {
  const ask = session.host.diagramRevision;
  if (!ask) return [];
  const pictures = images(session.slide.elements).flatMap((element) => {
    const source = diagramOf(element);
    const rev = revisionOf(element);
    return source && rev ? [{ element, source, rev }] : [];
  });
  const now = new Map<string, string | undefined>();
  await Promise.all(
    [...new Set(pictures.map((p) => p.source))].map(async (source) => {
      try {
        now.set(source, await ask.call(session.host, source));
      } catch {
        now.set(source, undefined);
      }
    }),
  );
  return pictures
    .filter(({ source, rev }) => {
      const current = now.get(source);
      return current !== undefined && current !== rev;
    })
    .map(({ element, source }) => ({ id: element.id, source, name: pictureName(element, source), edited: editedLocally(element) }));
}

/**
 * Draws the picture's diagram again and puts the new picture on the slide: `replace` as Edit diagram does (a new crop-free picture
 * with the generated description), `keep` leaving the person's crop and description. Resolves to whether the slide changed; says
 * why through the host when it did not.
 */
export async function refreshDiagram(session: EditorSession, slideId: string, id: string, how: "replace" | "keep"): Promise<boolean> {
  const { host } = session;
  const [element] = session.elements.find([id]);
  const source = diagramOf(element);
  if (!host.drawDiagram || !source) return false;
  try {
    const picture = await host.drawDiagram(source);
    if (!picture) return false;
    const done = how === "keep" ? await replaceDiagramKeeping(session, slideId, id, picture) : await replaceDiagram(session, slideId, id, picture);
    if (!done) host.notify?.("The slide changed while the picture was drawn, so it was not replaced here.");
    return done;
  } catch (err) {
    host.notify?.(message(err));
    return false;
  }
}

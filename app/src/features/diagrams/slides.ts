// Diagrams in Slides: the two hooks of the Slides host (kasten-host.ts). A
// slide holds a picture, never the diagram: the diagram is drawn as a PNG
// (PowerPoint, PDF and the HTML export all carry that; the diagram's own SVG
// draws its labels with HTML, which they do not) and kept in assets/, and the
// deck names the diagram beside the picture so it can be edited again.

import type { DiagramPicture } from "@kasten-slides/react";

import type { VaultClient } from "../../lib/vault/types";
import { editDiagramAndWait, useDiagramHost } from "./host-store";
import { stemOfPath, titleOfPath } from "./names";
import { diagramPng } from "./picture";
import { onDiagramChanged } from "./store";

/** The longest side of a slide's picture, in pixels: a big diagram is drawn smaller rather than as a huge file. */
const MAX_SIDE = 4096;

/** The version the diagram at `source` is at now: its file's hash, which changes with every save. Undefined when it cannot be read. */
export async function diagramRevision(client: VaultClient, source: string): Promise<string | undefined> {
  try {
    return (await client.diagram(source)).hash;
  } catch {
    return undefined;
  }
}

/** A picture of the diagram at `path`, kept in assets/ as a 2x PNG, and what a slide needs to name it and to tell when it is out of date. */
export async function pictureOf(client: VaultClient, path: string): Promise<DiagramPicture> {
  // Read before it is drawn: a diagram changed while the picture is drawn leaves the picture marked as out of date, which it is.
  const rev = await diagramRevision(client, path);
  const png = await diagramPng(client, path, { scale: 2, maxSide: MAX_SIDE });
  const name = titleOfPath(path);
  const added = await client.addAsset(`${stemOfPath(path)}.png`, png, { source: "file", caption: `Diagram: ${name}`, tags: ["diagram"] });
  const { width, height } = added.asset;
  return { path: added.path, source: path, name, ...(width && height ? { width, height } : {}), ...(rev ? { rev } : {}) };
}

/** Refresh on a slide: the picture of the diagram as it is now, drawn without opening its editor (a hidden editor draws it). */
export const drawDiagramPicture = pictureOf;

/** Hears of each diagram that changes (saved in its editor, edited elsewhere); returns how to stop. */
export function watchDiagrams(onChange: () => void): () => void {
  return onDiagramChanged(() => onChange());
}

/** Insert → Diagram: the person chooses a diagram (a new one opens in the editor first) and gets its picture; null when they chose none, or drew nothing in a new one. */
export async function pickDiagramPicture(client: VaultClient, deck?: string): Promise<DiagramPicture | null> {
  const picked = await useDiagramHost.getState().pick(deck ? { deck } : undefined);
  if (!picked) return null;
  if (picked.created) {
    const blank = (await client.diagram(picked.path)).hash;
    await editDiagramAndWait(picked.path);
    if ((await client.diagram(picked.path)).hash === blank) return null;
  }
  return pictureOf(client, picked.path);
}

/** Edit diagram: the editor opens over the slide; when it is closed a diagram that changed comes back as a new picture, one that did not as null (a PNG drawn again is not always the very same bytes, and nothing should change on the slide for nothing). */
export async function editDiagramPicture(client: VaultClient, source: string): Promise<DiagramPicture | null> {
  const before = (await client.diagram(source)).hash;
  await editDiagramAndWait(source);
  if ((await client.diagram(source)).hash === before) return null;
  return pictureOf(client, source);
}

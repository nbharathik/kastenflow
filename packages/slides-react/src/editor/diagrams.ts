// Diagrams on a slide: a picture the host drew from a diagram it can edit. The deck keeps the diagram's name with the picture
// (`x-diagram` on the image element, a field the model does not list and every build keeps, as it keeps any it does not know),
// so the picture can be edited again: the host opens its editor, and the new picture replaces the old through the ordinary
// operations, one step of undo. A host without diagrams never offers either.

import type { Element } from "@kasten-slides/wasm";

import { image } from "./factory.ts";
import { naturalSize, preferredBox, spotFor } from "./gallery/place.ts";
import type { DiagramPicture, HostImage } from "./host.ts";
import type { Patch } from "./session/elements.ts";
import { findElement } from "./session/scope.ts";
import type { EditorSession } from "./session/session.ts";
import type { EditorState } from "./session/types.ts";

/** The field of an image element that names the diagram it is a picture of. */
export const DIAGRAM_KEY = "x-diagram";
/** The field that names which version of the diagram the picture was drawn from (the host's word for a version). */
export const REVISION_KEY = "x-diagram-rev";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The diagram a picture is of, when it came from one. */
export function diagramOf(element: Element | undefined): string | undefined {
  if (element?.type !== "image") return undefined;
  const source = (element as unknown as Record<string, unknown>)[DIAGRAM_KEY];
  return typeof source === "string" && source !== "" ? source : undefined;
}

/** The version of its diagram a picture was drawn from, when the deck kept one. */
export function revisionOf(element: Element | undefined): string | undefined {
  if (element?.type !== "image") return undefined;
  const rev = (element as unknown as Record<string, unknown>)[REVISION_KEY];
  return typeof rev === "string" && rev !== "" ? rev : undefined;
}

/** The selected picture and its diagram, when exactly one picture of a diagram is selected. */
export function selectedDiagram(state: EditorState): { id: string; source: string } | undefined {
  const id = state.selection.length === 1 ? state.selection[0] : undefined;
  const slide = state.deck.slides.find((s) => s.id === state.slideId);
  const source = id && slide ? diagramOf(findElement(slide.elements, id)) : undefined;
  return id && source ? { id, source } : undefined;
}

const altOf = (picture: { name: string }) => `Diagram: ${picture.name}`;

/** The words the editor gives a picture of a diagram (`Diagram: Login flow`); any other description is the person's own. */
const GENERATED_ALT = /^Diagram: /;

/** Whether the person worked on a picture of a diagram: they cropped it, or wrote its description. A new picture put over it would lose that. */
export function editedLocally(element: Element): boolean {
  if (element.type !== "image") return false;
  const alt = element.alt ?? "";
  return Boolean(element.crop) || (alt !== "" && !GENERATED_ALT.test(alt));
}

/** What a picture of a diagram is called, from its description (`Diagram: Login flow`), else from its diagram's file name. */
export function pictureName(element: Element, source: string): string {
  const alt = element.type === "image" ? (element.alt ?? "") : "";
  return GENERATED_ALT.test(alt) ? alt.replace(GENERATED_ALT, "") : source.replace(/^.*\//, "").replace(/\.drawio(\.svg)?$/i, "");
}

const heldAs = (picture: DiagramPicture): HostImage => ({ path: picture.path, name: picture.name, ...(picture.width && picture.height ? { width: picture.width, height: picture.height } : {}) });

/** Puts the picture of a diagram on the shown slide in the largest free place, as a picture that can be edited. Resolves to its id. */
export async function insertDiagram(session: EditorSession, picture: DiagramPicture): Promise<string | undefined> {
  const preferred = preferredBox(await naturalSize(session, heldAs(picture)), session.deck.size);
  const box = spotFor(session, { w: preferred.w, h: preferred.h });
  const element: Element = Object.assign(image(picture.path, box, altOf(picture)), { [DIAGRAM_KEY]: picture.source }, picture.rev ? { [REVISION_KEY]: picture.rev } : {});
  return session.elements.insert([element])[0];
}

/** Replaces the picture of the element `id` (on the slide `slideId`) with a new picture of its diagram, keeping its place and width. */
export async function replaceDiagram(session: EditorSession, slideId: string, id: string, picture: DiagramPicture): Promise<boolean> {
  if (session.state.slideId !== slideId) return false;
  const [element] = session.elements.find([id]);
  if (element?.type !== "image") return false;
  // The diagram did not change: the same picture comes back, and the slide has nothing to do.
  if (element.src === picture.path && diagramOf(element) === picture.source && revisionOf(element) === picture.rev) return true;
  const natural = await naturalSize(session, heldAs(picture));
  // The width stays; the height follows the new picture's shape, so a diagram that grew is not squeezed.
  const patch: Patch = { src: picture.path, alt: altOf(picture), crop: null, [DIAGRAM_KEY]: picture.source, [REVISION_KEY]: picture.rev ?? null };
  if (element.w && element.h) patch.h = Math.max(1, Math.round((element.w * natural.h) / natural.w));
  session.elements.patch(patch, [id]);
  return true;
}

/**
 * Like `replaceDiagram`, but what the person did to the picture stays: its crop and its description. The place and width stay as they
 * are; the height follows the new picture's shape only when there is no crop (a crop is a part of the picture, and so a part of the box).
 */
export async function replaceDiagramKeeping(session: EditorSession, slideId: string, id: string, picture: DiagramPicture): Promise<boolean> {
  if (session.state.slideId !== slideId) return false;
  const [element] = session.elements.find([id]);
  if (element?.type !== "image") return false;
  if (element.src === picture.path && diagramOf(element) === picture.source && revisionOf(element) === picture.rev) return true;
  const patch: Patch = { src: picture.path, [DIAGRAM_KEY]: picture.source, [REVISION_KEY]: picture.rev ?? null };
  if (!element.crop && element.w && element.h) {
    const natural = await naturalSize(session, heldAs(picture));
    patch.h = Math.max(1, Math.round((element.w * natural.h) / natural.w));
  }
  session.elements.patch(patch, [id]);
  return true;
}

/** Insert → Diagram: the host lets the person choose one, and its picture goes on the slide. */
export async function chooseDiagram(session: EditorSession): Promise<void> {
  const { host } = session;
  if (!host.pickDiagram) return;
  try {
    const picture = await host.pickDiagram();
    if (picture) await insertDiagram(session, picture);
  } catch (err) {
    host.notify?.(message(err));
  }
}

/** Edit diagram: the host opens the selected picture's diagram, and what it comes back with replaces the picture. */
export async function editDiagram(session: EditorSession): Promise<void> {
  const { host } = session;
  const picked = selectedDiagram(session.state);
  if (!host.editDiagram || !picked) return;
  const slideId = session.state.slideId;
  try {
    const picture = await host.editDiagram(picked.source);
    if (!picture) return;
    if (!(await replaceDiagram(session, slideId, picked.id, picture))) host.notify?.("The slide changed while the diagram was open, so its picture was not replaced here.");
  } catch (err) {
    host.notify?.(message(err));
  }
}

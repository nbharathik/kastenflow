// Zooming the page of the embed that is selected: Ctrl plus, minus and zero, the wheel with Ctrl, and the buttons of its chip. The zoom is
// saved on the element, so it is what the slide shows and what is presented. A burst of steps is one step of undo.

import type { Element } from "@kasten-slides/wasm";

import type { EditorSession } from "../editor/session/session.ts";
import { isPageEmbedElement } from "./kinds.ts";
import { DEFAULT_DESIGN, PAGE_DESIGN, type View, clampZoom, frameFor, stepZoom, viewOf } from "./scale.ts";
import type { ZoomWord } from "./zoom-keys.ts";

type Embed = Extract<Element, { type: "embed" }>;

/** How long after a step the next one still belongs to the same step of undo, in milliseconds. */
const BURST_MS = 800;

const last = new WeakMap<object, { id: string; revision: number; at: number }>();

export interface SelectedEmbed {
  element: Embed;
  box: { x: number; y: number; w: number; h: number };
  view: View;
}

/** The embed that is the whole of the selection, with where it is and how its page is seen; null when the selection is anything else. */
export function selectedEmbed(session: EditorSession): SelectedEmbed | null {
  const [id, ...others] = session.state.selection;
  if (id === undefined || others.length > 0) return null;
  const [element] = session.elements.find([id]);
  if (element?.type !== "embed") return null;
  const box = session.elements.boxOf(element);
  if (!box) return null;
  return { element, box, view: viewOf(element, isPageEmbedElement(element) ? PAGE_DESIGN : DEFAULT_DESIGN) };
}

/** The scale the selected embed's page is drawn at, for the chip. */
export const scaleOfSelected = (found: SelectedEmbed): number => frameFor(found.box, found.view).scale;

/** Sets the zoom of an embed (`null` is Fit), joining a burst of steps into one step of undo. */
export function setEmbedZoom(session: EditorSession, id: string, zoom: number | null): void {
  const slide = session.state.slideId;
  const input = { slide, patches: [{ id, patch: { zoom: zoom === null ? null : Math.round(clampZoom(zoom)! * 100) / 100 } }] };
  const now = Date.now();
  const before = last.get(session);
  const joined = before !== undefined && before.id === id && before.revision === session.state.revision && now - before.at < BURST_MS;
  session.run(() => (joined ? session.core.applyIntoLast("patch_elements", input) : session.core.apply("patch_elements", input)));
  last.set(session, { id, revision: session.state.revision, at: now });
}

/** What a zoom key, a wheel turn or a chip button asks of the selected embed. Answers whether there was an embed to ask it of. */
export function zoomSelectedEmbed(session: EditorSession, word: ZoomWord): boolean {
  const found = selectedEmbed(session);
  if (!found || found.element.locked) return false;
  if (word === "fit") {
    if (found.element.zoom != null) setEmbedZoom(session, found.element.id, null);
    return true;
  }
  const next = stepZoom(found.box, found.view, word === "in" ? 1 : -1);
  if (next !== null) setEmbedZoom(session, found.element.id, next);
  return true;
}

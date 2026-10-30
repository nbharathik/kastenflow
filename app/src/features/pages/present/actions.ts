// What the page menu and the palette do with a page's sections: present it,
// draw it as cards, make a deck of it. Each acts on a page that is open.

import type { NoteMeta } from "../../../lib/vault/types";
import { pageFor } from "../../workspace/page/open-page";
import { setLayout, usePageLayouts } from "../../workspace/page/page-layout";
import { useWorkspace } from "../../workspace/store";
import { presentPage } from "../editor/sections/registry";
import { setSmartSide, type SmartSide } from "../../smart/use-smart-side";

/** What the editor knows a page by: its note id, or its path while it is a draft. */
export const pageKeyOf = (note: NoteMeta): string => note.id || note.path;

/** Presents `note` from its first slide; says how to make slides when there is nothing to show. */
export function presentThisPage(note: NoteMeta): void {
  // A smart page is shown as it is, full screen; there are no sections to step through.
  const session = pageFor(note.path);
  if (session && usePageLayouts.getState().of.get(session)?.layout === "smart") {
    void import("../../smart/author/flows").then((m) => m.togglePresentSmart());
    return;
  }
  if (presentPage(pageKeyOf(note)) === 0) useWorkspace.getState().toast("Nothing to present yet. Each section is a slide: a line of --- starts the next one.");
}

/** Whether `path`'s page draws its sections as cards, kept up to date for the menu. */
export function useSmartLayout(path: string): boolean {
  const session = pageFor(path);
  return usePageLayouts((s) => (session ? s.of.get(session)?.layout === "sections" : false));
}

/** Draws the sections of `note` as cards, or as the plain page: its `layout` key, which nothing else in the file depends on. */
export function toggleSmartLayout(note: NoteMeta): void {
  const session = pageFor(note.path);
  if (!session) return;
  const on = usePageLayouts.getState().of.get(session)?.layout === "sections";
  setLayout(session, "layout", on ? null : "sections");
}

/** Whether `path`'s page is a smart page (`layout: smart`), kept up to date for the menu. */
export function useSmartPage(path: string): boolean {
  const session = pageFor(path);
  return usePageLayouts((s) => (session ? s.of.get(session)?.layout === "smart" : false));
}

/** Makes `note` a smart page or an ordinary one again: its `layout` key, which nothing else in the file depends on. A page with no view of its own yet says so, with its notes one click away. */
export function toggleSmartPage(note: NoteMeta): void {
  const session = pageFor(note.path);
  if (!session) return;
  const on = usePageLayouts.getState().of.get(session)?.layout === "smart";
  setLayout(session, "layout", on ? null : "smart");
  setSmartSide(pageKeyOf(note), "smart");
}

/** Switches a smart page between its smart view, its notes and the history of its code. */
export function showSmartSide(note: NoteMeta, side: SmartSide): void {
  const session = pageFor(note.path);
  if (session && usePageLayouts.getState().of.get(session)?.layout === "smart") setSmartSide(pageKeyOf(note), side);
}

/** Makes a deck of the sections of `note` (loaded when first asked, with the slide engine). */
export function sectionsToDeck(note: NoteMeta): void {
  void import("./to-deck").then((m) => m.turnSectionsIntoDeck(note));
}

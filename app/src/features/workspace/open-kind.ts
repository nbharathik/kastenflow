// Which view a file opens in, by its name. One place for what used to be four
// chains of extension checks; a plugin that handles an extension is asked first.

import { fileHandlerFor } from "../../plugins/contributions";
import { DIAGRAMS_VIEW } from "../../plugins/diagrams/manifest";
import type { ViewId } from "./tabs";

/** The view that opens the file at `path`: a plugin's if one handles its extension, else a whiteboard, deck, diagram or PDF reader by extension, else a page. A journal day is a page here; the store sends it to the journal. */
export function openKind(path: string): ViewId {
  const plugin = fileHandlerFor(path);
  if (plugin) return plugin;
  if (path.endsWith(".canvas")) return "boards";
  if (path.endsWith(".deck")) return "slides";
  // The diagrams plugin handles this when it is on; the view is named here so a .drawio never opens as a page.
  if (path.endsWith(".drawio")) return DIAGRAMS_VIEW;
  if (/\.pdf$/i.test(path)) return "highlights";
  return "page";
}

/** Whether a view is a deck, diagram or a plugin's: opened as a tab of its own, never in the side stack or a peek. */
export const isStandaloneView = (view: ViewId): boolean => view === "slides" || view.startsWith("plugin:");

/** Whether the file at `path` is a whiteboard, deck, diagram or something a plugin opens: not a page for the side stack. */
export const opensBesideStack = (path: string): boolean => {
  const view = openKind(path);
  return view === "boards" || isStandaloneView(view);
};

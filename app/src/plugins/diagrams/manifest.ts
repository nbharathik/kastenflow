// What the catalogue says about the diagrams plugin. Kept apart from the
// contributions so the catalogue (read at start-up) pulls in none of its code.

import type { PluginManifest, PluginViewId } from "../types";

/** The id of the view the plugin adds, and of its sidebar row. */
export const DIAGRAMS_VIEW: PluginViewId = "plugin:diagrams";

export const DIAGRAMS_MANIFEST: PluginManifest = {
  id: "diagrams",
  name: "Diagrams",
  summary: "Draw flowcharts and sketches in a diagram file.",
  offName: "draw.io",
  icon: "diagram",
  version: "1.2.3",
  defaultOn: true,
  scope: "vault",
};

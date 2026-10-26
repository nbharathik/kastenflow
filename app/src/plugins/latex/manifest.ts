// What the catalogue says about the LaTeX plugin. Kept apart from the
// contributions so the catalogue (read at start-up) pulls in none of its code.
// Off until turned on; the program that builds (Tectonic) is a download the
// app manages, listed by the app with its size.

import type { PluginManifest, PluginViewId } from "../types";

/** The id of the view the plugin adds, and of its sidebar row. */
export const LATEX_VIEW: PluginViewId = "plugin:latex";

export const LATEX_MANIFEST: PluginManifest = {
  id: "latex",
  name: "LaTeX",
  summary: "Write pages in LaTeX and get a PDF.",
  icon: "sigma",
  version: "1.2.2",
  defaultOn: false,
  scope: "vault",
};

// The plugins this build knows. Each is listed with its manifest and a
// dynamic import, so a plugin's code is fetched only once it is turned on.

import { BROWSER_MANIFEST } from "./browser/manifest";
import { DIAGRAMS_MANIFEST } from "./diagrams/manifest";
import { LATEX_MANIFEST } from "./latex/manifest";
import { SMART_MANIFEST } from "./smart/manifest";
import type { CatalogEntry } from "./types";

export const CATALOG: readonly CatalogEntry[] = [
  // Diagrams are on for a vault that has not chosen; the editor itself is a download the app manages.
  { manifest: DIAGRAMS_MANIFEST, load: () => import("./diagrams").then((m) => m.diagramsContributions) },
  // LaTeX is off until turned on; Tectonic, which builds, is a download the app lists with its size.
  { manifest: LATEX_MANIFEST, load: () => import("./latex").then((m) => m.latexContributions) },
  // Smart pages are off until turned on, per vault; there is nothing to download and nothing to load, so the window's own code reads the switch.
  { manifest: SMART_MANIFEST, load: async () => ({}) },
  // The browser is this computer's choice (the app's settings, not the vault's); off until turned on.
  { manifest: BROWSER_MANIFEST, load: () => import("./browser").then((m) => m.browserContributions) },
];

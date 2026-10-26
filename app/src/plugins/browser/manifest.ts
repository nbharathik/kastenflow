// What the catalogue says about the browser plugin. Kept apart from the
// contributions so the catalogue (read at start-up) pulls in none of its code.
// Its switch is this computer's, not the vault's: it governs native web views
// and a local port for the extension, not anything in the vault.

import type { PluginManifest } from "../types";

export const BROWSER_MANIFEST: PluginManifest = {
  id: "browser",
  name: "Browser",
  summary: "Open web pages in a tab of their own, and show a web page beside a slide.",
  icon: "globe",
  version: "1.2.2",
  defaultOn: false,
  scope: "computer",
};

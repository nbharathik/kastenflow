// What the catalogue says about the smart pages plugin. It is off until a
// person turns it on, for each vault; a project can say its own (on or off) in
// its settings. It adds nothing to the window by itself: the places that make
// a smart page (the "+ New" menus, the palette, a page's menu, the AI actions)
// ask `smartAvailable` (features/smart/availability.ts), which reads this
// plugin's switch and the project's.

import type { PluginManifest } from "../types";

export const SMART_MANIFEST: PluginManifest = {
  id: "smart",
  name: "Smart pages",
  summary: "Pages with a small app of their own, such as a tracker or a dashboard, that work with your notes.",
  icon: "code",
  version: "1.2.3",
  defaultOn: false,
  scope: "vault",
};

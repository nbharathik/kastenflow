// The starters the app ships, as the "+ New" menus list them without asking
// the app (the picker asks, and adds the person's own templates). The names
// match `app/src-tauri/src/smart/starters.rs`, which has the files.

import type { HomeAction } from "../../home/actions";

export const STARTERS = [
  { id: "dashboard", name: "Dashboard", words: "counts chart table summary" },
  { id: "tracker", name: "Tracker", words: "table status todo progress" },
  { id: "gallery", name: "Gallery", words: "pictures photos images grid" },
  { id: "map", name: "Map", words: "places pins world location" },
  { id: "timeline", name: "Timeline", words: "dates schedule history" },
] as const;

const flows = () => import("./flows");
const picker = () => import("./starter-picker");

/** The rows of a "New smart page" menu: one per starter, then the longer list with the person's own templates. */
export function smartChoices(): HomeAction[] {
  return [
    ...STARTERS.map((s) => ({
      id: `smart-${s.id}`,
      label: `Smart page: ${s.name}`,
      icon: "code" as const,
      words: `smart page ${s.words}`,
      run: () => void flows().then((m) => m.newSmartPage(s.id)),
    })),
    { id: "smart-more", label: "Smart page: more…", icon: "code" as const, words: "smart page your templates own", run: () => void picker().then((m) => m.chooseStarter()) },
  ];
}

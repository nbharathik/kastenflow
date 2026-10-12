// Opening Settings at a group, a row in it, or a search, as the palette, a
// link from another view and a toast's button do. The target waits here until
// the Settings window is drawn (or, when it already is, is taken at once).
// Names it understands: a group's title or id ("History and backup",
// "history"), a path ("settings/ai", "kasten:settings/appearance/appearance.zoom")
// or a setting's entry id.

import { create } from "zustand";

import { useWorkspace, type OpenHow } from "../../store";
import { settingsTarget, type SettingsTarget } from "./index";

export const useSettingsJump = create<{ target: SettingsTarget | null }>(() => ({ target: null }));

/** Opens Settings where `where` says. A name it does not know opens Settings as it is. */
export function openSettingsAt(where: string | SettingsTarget, how: OpenHow = "here"): void {
  const target = typeof where === "string" ? settingsTarget(where) : where;
  useSettingsJump.setState({ target });
  const { place, go } = useWorkspace.getState();
  if (place.view === "settings" && how === "here") return;
  go({ view: "settings" }, how);
}

/** The target Settings should show first, once. */
export function takeSettingsJump(): SettingsTarget | null {
  const { target } = useSettingsJump.getState();
  useSettingsJump.setState({ target: null });
  return target;
}

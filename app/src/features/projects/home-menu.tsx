// "Show project home" / "Hide project home" in a project's menus: the page
// menu and the sidebar row's; and the template its new pages start from.

import type { NoteMeta } from "../../lib/vault/types";
import { Icon } from "../../ui/Icon";
import { projectHome } from "./home";
import { saveHome } from "./home-actions";
import { pageTemplateOf, setPageTemplate } from "./page-template";
import { askToSaveSetup } from "./setups/request";
import { useShell } from "../../lib/store";

/** The menu item that shows a project's home again, or hides it. */
export function homeItem(note: NoteMeta) {
  const home = projectHome(note.props);
  return {
    label: home.shown ? "Hide project home" : "Show project home",
    icon: <Icon name={home.shown ? "eye-off" : "dashboard"} className="size-4" />,
    onSelect: () => void saveHome(note, { ...home, shown: !home.shown }),
  };
}

/** "Save as a setup…": the dialog that keeps this project's starting pages, tags and properties for new projects. */
export function saveSetupItem(project: string | null | undefined) {
  return {
    label: "Save as a setup…",
    icon: <Icon name="template" className="size-4" />,
    onSelect: () => askToSaveSetup(project ?? null),
  };
}

/** "Template for new pages…", and a way back to blank pages when one is set. */
export function templateItems(note: NoteMeta) {
  const chosen = pageTemplateOf(note);
  const pick = {
    label: chosen ? "Change the template for new pages…" : "Template for new pages…",
    icon: <Icon name="template" className="size-4" />,
    onSelect: () => useShell.getState().openGallery({ onPick: (template: string) => void setPageTemplate(note, template) }),
  };
  if (!chosen) return [pick];
  return [pick, { label: "New pages start blank", icon: <Icon name="page" className="size-4" />, onSelect: () => void setPageTemplate(note, null) }];
}

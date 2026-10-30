// "Show project home" / "Hide project home" in a project's menus: the page
// menu and the sidebar row's; and the template its new pages start from.

import { inTauri } from "../../lib/api";
import type { NoteMeta } from "../../lib/vault/types";
import type { MenuEntry } from "../../shell/menu-types";
import { Icon } from "../../ui/Icon";
import type { ProjectSmart } from "../smart/backend";
import { projectChoice, setProjectSmart } from "../smart/availability";
import { useWorkspace } from "../workspace/store";
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

/**
 * "Smart pages" in a project's menu: use the vault's choice, or say on or off
 * for this project's pages. Only in the desktop app, which keeps the choice in
 * the project's page (one change in History that Undo takes back).
 */
export function smartProjectItems(note: NoteMeta): MenuEntry[] {
  const folder = note.project;
  if (!folder || !inTauri()) return [];
  const chosen = projectChoice(folder);
  const pick = (setting: ProjectSmart) => () =>
    void setProjectSmart(folder, setting).then((done) => {
      if (!done) useWorkspace.getState().toast("Smart pages could not be changed for this project. Try again.");
    });
  return [
    {
      label: "Smart pages",
      icon: <Icon name="code" className="size-4" />,
      submenu: [
        { label: "Use the vault's choice", checked: chosen === "vault", onSelect: pick("vault") },
        { label: "On in this project", checked: chosen === "on", onSelect: pick("on") },
        { label: "Off in this project", checked: chosen === "off", onSelect: pick("off") },
      ],
    },
  ];
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

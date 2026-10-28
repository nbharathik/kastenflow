// Whether the places that make a smart page (the "+ New" menus, the palette, a
// page's menu, the AI actions) are offered. Smart pages are a plugin that is
// off until a person turns it on for the vault (Settings → Plugins); a project
// can say its own, on or off, and a page outside any project follows the
// vault. The app checks the same thing before it makes a page or runs a
// frame; this only keeps the entries out of sight.

import { useEffect } from "react";
import { create } from "zustand";

import { inTauri } from "../../lib/api";
import { usePlugins } from "../../plugins/registry";
import { tauriSmartBackend, type ProjectSmart, type SmartBackend } from "./backend";
import { forgetPageAnswers } from "./run-switch";

interface ProjectSettings {
  /** What each project says of its own, by folder name; one that follows the vault is not listed. */
  projects: Record<string, "on" | "off">;
  /** The app has been asked. */
  known: boolean;
}

export const useProjectSmart = create<ProjectSettings>()(() => ({ projects: {}, known: false }));

let asking: Promise<void> | null = null;

/** Reads what the projects say from the app, once. */
export function loadProjectSmart(backend: SmartBackend = tauriSmartBackend): Promise<void> {
  asking ??= Promise.resolve()
    .then(() => backend.projectSettings())
    .then(
      (projects) => useProjectSmart.setState({ projects, known: true }),
      () => useProjectSmart.setState({ known: true }),
    );
  return asking;
}

/** The project folder a page's path is in (`projects/<folder>/…`), or null for the library. */
export function projectOfPath(path: string): string | null {
  return /^projects\/([^/]+)\//i.exec(path)?.[1] ?? null;
}

/** Forgets what was heard (tests, and a vault switch). */
export function forgetProjectSmart(): void {
  asking = null;
  useProjectSmart.setState({ projects: {}, known: false });
}

/** Sets a project's own choice (`vault` follows the vault). Resolves false when the app refused. */
export async function setProjectSmart(project: string, setting: ProjectSmart, backend: SmartBackend = tauriSmartBackend): Promise<boolean> {
  try {
    await backend.setProjectSetting(project, setting);
  } catch {
    return false;
  }
  useProjectSmart.setState((s) => {
    const projects = { ...s.projects };
    if (setting === "vault") delete projects[project];
    else projects[project] = setting;
    return { projects, known: true };
  });
  forgetPageAnswers();
  return true;
}

/** The project's own choice, or `vault` when it says nothing. */
export function projectChoice(project: string | null | undefined): ProjectSmart {
  return (project ? useProjectSmart.getState().projects[project] : undefined) ?? "vault";
}

const resolve = (vault: boolean, own: "on" | "off" | undefined): boolean => (own === "on" ? true : own === "off" ? false : vault);

/** Whether smart pages are on for a page in `project` (its folder; none for the library): the project's choice, else the vault's plugin. */
export function smartAvailable(project?: string | null): boolean {
  const state = useProjectSmart.getState();
  // A project's choice is read from the app the first time one is asked about; until then the vault's plugin answers.
  if (project && !state.known && inTauri()) void loadProjectSmart();
  return resolve(usePlugins.getState().on.smart === true, project ? state.projects[project] : undefined);
}

/** The same, drawn again when the plugin or the project's choice changes. */
export function useSmartAvailable(project?: string | null): boolean {
  const vault = usePlugins((s) => s.on.smart === true);
  const own = useProjectSmart((s) => (project ? s.projects[project] : undefined));
  const known = useProjectSmart((s) => s.known);
  useEffect(() => {
    if (project && !known && inTauri()) void loadProjectSmart();
  }, [project, known]);
  return resolve(vault, own);
}

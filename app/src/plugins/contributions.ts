// What the window asks the plugins for. Each selector flattens one kind of
// contribution over the plugins that are on, in the order they were turned on;
// with none on, each answers with an empty list.

import type { Choice } from "../features/pages/editor/menus/catalog";
import type { HomeAction } from "../features/home/actions";
import type { Command } from "../features/workspace/overlays/commands";
import type { MenuItem } from "../shell/menu-types";
import { usePlugins } from "./registry";
import type { PluginAiAction, PluginChatChip, PluginContributions, PluginSelectionTool, PluginSettingsSection, PluginSidebarRow, PluginTreeRows, PluginView, PluginViewId } from "./types";

/** The contributions of the plugins that are on, in order. */
function active(): PluginContributions[] {
  const { enabled, loaded } = usePlugins.getState();
  return enabled.map((id) => loaded[id]).filter((c): c is PluginContributions => c !== undefined);
}

const collect = <K extends keyof PluginContributions, T>(key: K, pick: (value: NonNullable<PluginContributions[K]>) => T[]): T[] =>
  active().flatMap((c) => (c[key] === undefined ? [] : pick(c[key] as NonNullable<PluginContributions[K]>)));

export const views = (): PluginView[] => collect("views", (v) => v);

/** The view a plugin added, by id. */
export const viewById = (id: string): PluginView | undefined => views().find((v) => v.id === id);

const dotted = (ext: string): string => (ext.startsWith(".") ? ext : `.${ext}`).toLowerCase();

/** The plugin view that opens the file at `path`, if a plugin handles its extension; the longest matching extension wins (".drawio.svg" over ".svg"). */
export function fileHandlerFor(path: string): PluginViewId | undefined {
  const name = path.toLowerCase();
  let best: { view: PluginViewId; length: number } | undefined;
  for (const handler of collect("fileHandlers", (h) => h)) {
    if (handler.when && !handler.when(path)) continue;
    for (const ext of handler.ext.map(dotted)) {
      if (name.endsWith(ext) && ext.length > (best?.length ?? 0)) best = { view: handler.view, length: ext.length };
    }
  }
  return best?.view;
}

export const commands = (): Command[] => collect("commands", (c) => c);
export const slashItems = (): Choice[] => collect("slash", (s) => s);
export const newItems = (): HomeAction[] => collect("newItems", (n) => n);
export const sidebarRows = (): PluginSidebarRow[] => collect("sidebar", (s) => s);
export const pageMenuItems = (): MenuItem[] => collect("pageMenu", (m) => m);
/** What plugins draw in the sidebar's tree (under a project, in Favourites). */
export const treeRows = (): PluginTreeRows[] => collect("tree", (t) => [t]);
export const chatChips = (): PluginChatChip[] => collect("chatChips", (c) => c);
export const aiActions = (): PluginAiAction[] => collect("aiActions", (a) => a);
export const selectionTools = (): PluginSelectionTool[] => collect("selectionTools", (t) => t);

/** The Settings sections plugins add, with the plugin each belongs to. */
export function settingsSections(): (PluginSettingsSection & { plugin: string })[] {
  const { enabled, loaded } = usePlugins.getState();
  return enabled.flatMap((id) => {
    const section = loaded[id]?.settingsSection;
    return section ? [{ ...section, plugin: id }] : [];
  });
}

// A plugin that is off, as the places that still show its files need to know
// it. Off means the app (or the person) said so: before the app has answered,
// and in the browser preview, a plugin is not off, so nothing flashes a
// "turn on" row while the real choice is on its way.

import { CATALOG } from "./catalog";
import { usePlugins } from "./registry";

/** Whether plugin `id` was turned off (not merely not loaded yet). */
export const pluginOff = (id: string): boolean => usePlugins.getState().on[id] === false;

/** The same, drawn again when the choice changes. */
export const usePluginOff = (id: string): boolean => usePlugins((s) => s.on[id] === false);

/** What people call the plugin in a sentence about turning it on: "draw.io" for the diagrams plugin. */
export function pluginLabel(id: string): string {
  const manifest = CATALOG.find((e) => e.manifest.id === id)?.manifest;
  return manifest?.offName ?? manifest?.name ?? id;
}

/** "Turn on the draw.io plugin to open this". */
export const turnOnSentence = (id: string): string => `Turn on the ${pluginLabel(id)} plugin to open this`;

/** Turns plugin `id` on from a place that stopped for want of it; resolves to the reason when it could not. */
export async function turnPluginOn(id: string): Promise<string | null> {
  await usePlugins.getState().setEnabled(id, true);
  return usePlugins.getState().problem[id] || null;
}

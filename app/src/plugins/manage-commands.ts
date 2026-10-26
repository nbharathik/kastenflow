// The palette's commands for plugins themselves: open their settings, and turn
// each one on or off. Which plugins there are comes from the app (or, with no
// app to ask, this build's catalogue).

import { openSettingsAt } from "../features/workspace/views/settings/jump";
import { useWorkspace } from "../features/workspace/store";
import type { Command } from "../features/workspace/overlays/commands";
import { CATALOG } from "./catalog";
import { usePlugins } from "./registry";

/** Id and name of every plugin there is. */
function known(): { id: string; name: string }[] {
  const { info } = usePlugins.getState();
  return info.length > 0 ? info.map((p) => ({ id: p.id, name: p.name })) : CATALOG.map((e) => ({ id: e.manifest.id, name: e.manifest.name }));
}

const isOn = (id: string): boolean => {
  const s = usePlugins.getState();
  return s.on[id] ?? s.enabled.includes(id);
};

/** Turns a plugin on; one that has to download first says so, since the palette shows no progress. */
async function turnOn(id: string, name: string): Promise<void> {
  const store = usePlugins.getState();
  const needsDownload = store.info.find((p) => p.id === id)?.payload != null && !store.payload[id]?.installed;
  const say = useWorkspace.getState().toast;
  if (needsDownload) say(`Downloading ${name}…`, { label: "See progress", run: () => openSettingsAt({ group: "plugins" }) });
  await store.setEnabled(id, true);
  const after = usePlugins.getState();
  const problem = after.problem[id] || (after.payload[id]?.phase === "failed" ? after.payload[id]?.error || "The download did not finish." : "");
  if (problem) say(`${name} did not turn on: ${problem}`, { label: "Open settings", run: () => openSettingsAt({ group: "plugins" }) });
  else if (needsDownload && after.payload[id]?.installed) say(`${name} is on`);
}

export function pluginManageCommands(): Command[] {
  const all = known();
  if (all.length === 0) return [];
  return [
    { id: "plugins-settings", label: "Plugins: open settings", words: "extensions add-ons extras switch on off", run: () => openSettingsAt({ group: "plugins" }) },
    ...all.flatMap(({ id, name }): Command[] => [
      { id: `plugin-on-${id}`, label: `Turn on ${name}`, words: "plugin enable add extension", when: () => !isOn(id), run: () => void turnOn(id, name) },
      { id: `plugin-off-${id}`, label: `Turn off ${name}`, words: "plugin disable remove extension", when: () => isOn(id), run: () => void usePlugins.getState().setEnabled(id, false) },
    ]),
  ];
}

// Keeps the browser's two readings of "is it on" in step: the plugin registry's
// (what the Plugins page, the palette's "Turn on" commands and the app's plugin
// list say) and the browser's own (`useBrowserPrefs.enabled`, which the sidebar,
// the Slides preview card and Vault health read). Both come from the computer's
// switch in the app's settings; nothing here touches the vault.

import { useBrowserPrefs } from "../../features/browser/prefs";
import { usePlugins } from "../registry";

/** Copies the registry's answer onto the browser's own reading. */
function follow(on: boolean | undefined): void {
  if (on === undefined) return;
  if (useBrowserPrefs.getState().enabled !== on || !useBrowserPrefs.getState().known) useBrowserPrefs.setState({ enabled: on, known: true });
}

let started = false;

/** Starts following the registry (once), and takes its current answer at once. */
export function startBrowserLink(): void {
  follow(usePlugins.getState().on.browser);
  if (started) return;
  started = true;
  usePlugins.subscribe((state, before) => {
    if (state.on.browser !== before.on.browser) follow(state.on.browser);
  });
}

/** After the switch in Settings → Browser changed the computer's choice: tells the registry, which loads or drops the plugin. */
export async function reflectBrowser(on: boolean): Promise<void> {
  const store = usePlugins.getState();
  usePlugins.setState({ on: { ...store.on, browser: on } });
  if (on) await store.enable("browser");
  else store.disable("browser");
}

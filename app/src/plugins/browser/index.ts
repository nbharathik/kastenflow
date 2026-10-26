// The browser plugin: what the shell used to wire by hand for the browser (the
// palette's browser commands and its Settings page), given to the registry as
// contributions. The switch is this computer's (the app's settings), so the
// plugin is on or off for every vault at once. Off still means no web tab, no
// slide previews and the extension's port closed; the app enforces that.
//
// Not moved, and why: the view stays the app's own `web` view (saved tab sets,
// the pane code and the page-link opener name it), its sidebar row and the
// "+" menu item are read from the same switch (`shell/nav.ts`), and Ctrl+T
// stays the app's "New tab" command, which makes a browser tab only beside a
// browser tab, so it cannot act while the browser is off.

import { browserOn, onBrowserTab, runBrowserCommand } from "../../features/browser/commands";
import { BrowserSettings } from "../../features/browser/BrowserSettings";
import { useWorkspace } from "../../features/workspace/store";
import type { PluginContributions } from "../types";
import { startBrowserLink } from "./link";

startBrowserLink();

export const browserContributions: PluginContributions = {
  commands: [
    { id: "browser", label: "Open browser", words: "web internet site page search google capture clip", when: browserOn, run: () => useWorkspace.getState().go({ view: "web" }) },
    { id: "browser-address", label: "Browser: go to the address box", words: "web url search location bar", when: onBrowserTab, run: () => runBrowserCommand("address") },
    { id: "browser-capture-page", label: "Browser: capture the page", words: "web clip save keep bookmark", when: onBrowserTab, run: () => runBrowserCommand("capture-page") },
    { id: "browser-capture-selection", label: "Browser: capture the selection", words: "web clip save keep quote highlight", when: onBrowserTab, run: () => runBrowserCommand("capture-selection") },
    { id: "browser-save-paper", label: "Browser: save the page as a paper", words: "web reference bibliography citation article doi arxiv journal cite", when: onBrowserTab, run: () => runBrowserCommand("save-paper") },
  ],
  settingsSection: { title: "Browser", render: BrowserSettings },
};

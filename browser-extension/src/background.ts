// The right-click menu: a click sends what was clicked to where the last capture
// went, and says how it went on the toolbar button (a tick, or a mark the popup
// explains). Written against `BackgroundEnv`, so a stand-in browser runs it in tests.

import { MENU_ITEMS, requestFromMenu } from "./capture.js";
import { Kasten, KastenError } from "./client.js";
import type { Fetch, MenuClick, ReadTab, StorageArea, Tab } from "./env.js";
import { forgetPairing, loadSettings } from "./settings.js";

/** What the background needs of the browser. */
export interface BackgroundEnv {
  storage: StorageArea;
  read: ReadTab;
  send: Fetch;
  /** Puts a mark on the toolbar button; an empty one takes it off. */
  badge(text: string, ok: boolean): void;
  /** Adds an entry to the right-click menu. */
  addMenu(item: { id: string; title: string; contexts: readonly string[] }): void;
  /** Takes the menu away (the browser keeps it between runs, so it is made afresh). */
  clearMenus(): Promise<void>;
  /** Calls `then` after a pause. */
  later(then: () => void, ms: number): void;
}

/** How long a tick or a mark stays on the toolbar button. */
const BADGE_MS = 4000;
/** What the popup is told when it opens: how the last right-click send went. */
export const LAST_RESULT = "lastResult";

/** Makes the right-click menu: page, selection, link and picture. */
export async function makeMenus(env: BackgroundEnv): Promise<void> {
  await env.clearMenus();
  for (const item of MENU_ITEMS) env.addMenu(item);
}

const words = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Sends what a right-click chose to Kasten, and says how it went. */
export async function onMenuClick(env: BackgroundEnv, click: MenuClick, tab: Tab | undefined): Promise<void> {
  const settings = await loadSettings(env.storage);
  const say = async (ok: boolean, text: string) => {
    await env.storage.set({ [LAST_RESULT]: { ok, text, at: Date.now() } }).catch(() => {});
    env.badge(ok ? "✓" : "!", ok);
    env.later(() => env.badge("", ok), BADGE_MS);
  };
  if (!settings.token) {
    await say(false, "This browser is not paired with KastenFlow yet. Open the extension and pair it.");
    return;
  }
  try {
    const { request, cut } = await requestFromMenu(click, tab, env.read, settings.lastTarget);
    const saved = await new Kasten(settings.port, settings.token, env.send).capture(request);
    await say(true, `Sent to ${saved.place}: ${saved.title}${cut ? " (the page was big, so only the start of its text went)" : ""}`);
  } catch (error) {
    // A token Kasten does not know is of no use: the popup asks to pair again.
    if (error instanceof KastenError && error.trouble === "unpaired") await forgetPairing(env.storage).catch(() => {});
    await say(false, words(error));
  }
}

// What the popup's views share: what they need of the browser, the line said
// above a view, and how a failed request is told.

import { KastenError } from "./client.js";
import { h } from "./dom.js";
import type { Fetch, ReadTab, StorageArea, Tab } from "./env.js";
import { forgetPairing } from "./settings.js";

/** What the popup needs of the browser. */
export interface PopupEnv {
  storage: StorageArea;
  /** The tab in front, when the popup opened. */
  activeTab(): Promise<Tab | undefined>;
  read: ReadTab;
  send: Fetch;
  /** Takes the tick or mark off the toolbar button. */
  clearBadge(): void;
  /** Closes the popup. */
  close(): void;
  /** What this browser calls itself ("Edge", "Chrome"), for Kasten's list of paired extensions. */
  browser: string;
}

/** A line said above a view: how the last send went, or what is wrong. */
export interface Notice {
  text: string;
  bad: boolean;
}

export const words = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function noticeLine(notice: Notice | null): HTMLElement | null {
  return notice ? h("p", { class: notice.bad ? "notice is-bad" : "notice", role: notice.bad ? "alert" : "status" }, notice.text) : null;
}

/** What went wrong with a request, as the popup says it. A token Kasten does
 * not know is forgotten at once, so the next view asks to pair again. */
export async function trouble(env: PopupEnv, error: unknown): Promise<{ text: string; unpaired: boolean }> {
  const unpaired = error instanceof KastenError && error.trouble === "unpaired";
  if (unpaired) await forgetPairing(env.storage).catch(() => {});
  return { text: words(error), unpaired };
}

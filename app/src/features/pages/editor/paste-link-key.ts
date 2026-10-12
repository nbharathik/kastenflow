// The address last pasted as a link, kept where it is as the page is edited,
// so the menu that opened under it can still find it.

import { PluginKey } from "@milkdown/kit/prose/state";

/** An address just pasted as a link, which the menu may turn into a titled one. */
export interface PastedLink {
  /** Told apart so a later paste, or an edit, is not mistaken for this one. */
  id: number;
  from: number;
  to: number;
  url: string;
}

export const pastedKey = new PluginKey<PastedLink | null>("KASTEN_PASTED_LINK");

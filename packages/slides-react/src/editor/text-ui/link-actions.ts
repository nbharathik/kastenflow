// What the link card can do with a web address beyond opening it: show it in the page preview, open it in a tab of the host's app, open
// it in the person's own browser. Each is there only where the host has the means; the right-click menu and the Preview button read it.

import { openInWindow } from "../../pages/follow.ts";
import { previewOf } from "../preview/preview-store.ts";
import type { EditorSession } from "../session/session.ts";
import type { PreviewMode } from "../web-preview-host.ts";

export interface LinkActions {
  /** Shows the page in the preview, in the way named (the peek beside the slide when none is). */
  preview?(address: string, way?: PreviewMode): void;
  tab?(address: string): void;
  browser(address: string): void;
}

export function linkActions(session: EditorSession): LinkActions {
  const { host } = session;
  return {
    ...(host.webPreview ? { preview: (address: string, way?: PreviewMode) => previewOf(session).open(address, way) } : {}),
    ...(host.openInTab ? { tab: (address: string) => host.openInTab?.(address) } : {}),
    browser: (address) => (host.openUrl ? host.openUrl(address) : openInWindow(address)),
  };
}

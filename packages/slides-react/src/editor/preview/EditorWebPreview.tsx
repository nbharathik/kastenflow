import { type JSX, useSyncExternalStore } from "react";

import { openInWindow } from "../../pages/follow.ts";
import { WebPreviewPanel } from "../../present/WebPreviewPanel.tsx";
import { homeOf } from "../focus/home.ts";
import type { EditorSession } from "../session/session.ts";
import { previewOf } from "./preview-store.ts";

/** The web page in the peek beside the slide, when the host can show one and a page has been asked for (Preview live). Nothing otherwise. */
export function EditorWebPreview({ session }: { session: EditorSession }): JSX.Element | null {
  const store = previewOf(session);
  const address = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const { host } = session;
  if (address === null || !host.webPreview) return null;
  return (
    <WebPreviewPanel
      host={host.webPreview}
      url={address}
      surface="editor"
      onClose={() => store.close()}
      openExternally={(url) => (host.openUrl ? host.openUrl(url) : openInWindow(url))}
      returnTo={() => homeOf()}
    />
  );
}

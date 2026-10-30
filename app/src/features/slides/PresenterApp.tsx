import { type PresentSync, PresenterWindow, broadcastSync } from "@kasten-slides/react/presenter-entry";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";

import { inTauri } from "../../lib/api";
import { tauriLink } from "./presenter-link";
import { rehearsalStore } from "./rehearse/store";

/**
 * The page of the presenter's window, drawn instead of the app when the address says `?presenter=`: the speaker's view of the talk in
 * the other window. In the desktop app the two windows are joined through the core; in a browser (the preview) through a channel of that name.
 */
export default function PresenterApp({ name }: { name: string }) {
  const [link, setLink] = useState<PresentSync | null>(null);

  useEffect(() => {
    document.title = "Presenter view";
    let live = true;
    let made: PresentSync | null = null;
    void (inTauri() ? tauriLink() : Promise.resolve(broadcastSync(name))).then((next) => {
      if (!live) {
        next.close();
        return;
      }
      made = next;
      setLink(next);
    });
    return () => {
      live = false;
      made?.close();
    };
  }, [name]);

  // A rehearsal in this window is kept where the app keeps them (the data folder), not in the page.
  const rehearsals = useMemo(() => rehearsalStore(), []);
  if (!link) return null;
  // This window has no toasts; if the shell cannot close it, the window's own close button still does.
  return <PresenterWindow sync={link} rehearsals={rehearsals} swapScreens={inTauri()} onClose={() => (inTauri() ? void invoke("presenter_close").catch(() => {}) : window.close())} />;
}

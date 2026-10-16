// The Slides editor's web preview inside KastenFlow: a page shown beside a slide, or over a
// presentation, by the browser's native view. It is the browser's, so it is on only when
// the browser is (Settings, under Browser): with it off `open` says no, and the editor's
// card offers to switch it on. One preview at a time, one of the four views the browser
// may keep alive. The editor draws the toolbar and owns Escape; `PreviewSession` owns the view.

import type { PreviewPlace, WebPreviewHandle, WebPreviewHost } from "@kasten-slides/react";

import { startChildFocus } from "../browser/child-focus";
import { previewBackend } from "../browser/preview-backend";
import { useBrowserPrefs } from "../browser/prefs";
import { startBrowserEvents } from "../browser/web-state";
import { openSettingsAt } from "../workspace/views/settings/jump";
import { PreviewSession } from "./preview-session";

/** The browser is on (asked of the app once, if it is not known yet). */
async function browserIsOn(): Promise<boolean> {
  const prefs = useBrowserPrefs.getState();
  if (!prefs.known) await prefs.refresh();
  return useBrowserPrefs.getState().enabled;
}

let active: PreviewSession | null = null;

/** The preview of the editor and of a presentation: where there is no native view (the browser preview) it is not offered at all. */
export function webPreviewHost(): WebPreviewHost {
  return {
    async open(url: string, place: PreviewPlace): Promise<WebPreviewHandle | null> {
      if (!previewBackend().available || !(await browserIsOn())) return null;
      // The page's events and the keys its view takes reach the window through these.
      startBrowserEvents();
      startChildFocus();
      // There is one: asking again takes it to the new address.
      if (active && !active.isClosed) {
        await active.navigate(url, place);
        return active;
      }
      const session = new PreviewSession(url, place, (done) => {
        if (active === done) active = null;
      });
      active = session;
      await session.start();
      return session;
    },
    turnOn: () => openSettingsAt("Browser", "tab"),
  };
}

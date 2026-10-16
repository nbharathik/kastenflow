// A paper the browser extension found ("Save as paper"): KastenFlow tells the
// window the page's address, its title and its tags, and the window shows the
// form to check them. The extension is only a messenger for a page that may
// say anything, so the tags are read as data like those of a tab, and nothing
// is added until the person has checked the form.

import { useWorkspace } from "../workspace/store";
import { openAddPaper } from "./add-state";
import { draftFromPage, readPageMeta } from "./page-meta";

/** Opens "Add a paper" with the form filled from `payload`, which is `{ url, title, meta }` as KastenFlow sends it. */
export function paperFromExtension(payload: unknown): boolean {
  const { url, title, meta } = (typeof payload === "object" && payload !== null ? payload : {}) as Record<string, unknown>;
  if (typeof url !== "string" || typeof title !== "string" || typeof meta !== "string") {
    useWorkspace.getState().toast("The browser extension sent a paper KastenFlow could not read");
    return false;
  }
  openAddPaper({ draft: draftFromPage(readPageMeta(meta, url, title)) });
  return true;
}

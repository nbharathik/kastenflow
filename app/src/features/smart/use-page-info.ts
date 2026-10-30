// What the app says about a smart page: whether its folder has a view, how
// tall it asks to be, the views its manifest names, and whether it may show
// pictures from the web.

import { useEffect, useState } from "react";

import type { PageInfo, SmartBackend } from "./backend";

export interface InfoState {
  /** null while the app is asked. */
  info: PageInfo | null;
  /** The app could not say (the page is not a smart page, or has no id yet). */
  failed: boolean;
  /** Keeps a changed answer the person made (the pictures box). */
  patch(change: Partial<PageInfo>): void;
}

/** `active` false asks nothing. Asks again when `version` changes. */
export function usePageInfo(pagePath: string, backend: SmartBackend, active = true, version = 0): InfoState {
  const [info, setInfo] = useState<PageInfo | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!active) return;
    let live = true;
    setFailed(false);
    backend.info(pagePath).then(
      (found) => live && setInfo(found),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [backend, pagePath, active, version]);

  return { info, failed, patch: (change) => setInfo((was) => (was ? { ...was, ...change } : was)) };
}

/** A view name as the manifest allows it: letters, digits, `-` and `_`. */
const VIEW_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The file a named view is drawn from, when the manifest gives it one; the
 * page's own `index.html` draws the rest. The name comes from a link in a
 * page's Markdown, so it is only ever data: a name the manifest does not know
 * and that could not be one (`../x`, a script, a long text) is dropped, never
 * passed on or turned into a file name.
 */
export function entryOfView(info: PageInfo, view: string): { name: string; entry?: string } {
  const wanted = view.trim();
  const hit = info.views.find((v) => v.name === wanted) ?? info.views.find((v) => v.name.toLowerCase() === wanted.toLowerCase());
  if (hit) return { name: hit.name, ...(hit.entry ? { entry: hit.entry } : {}) };
  return { name: VIEW_NAME.test(wanted) ? wanted : "" };
}

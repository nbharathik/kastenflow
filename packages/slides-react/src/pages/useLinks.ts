// Links of the slide in the editor: words that link say where they go when the pointer rests on them, and Ctrl (or Cmd) with a click
// follows one: to the slide, to a page of the host in a peek at the side (the host's own Open menu has the other places), or to the
// web in the host's own way (the system browser, or a tab of its own browser). A plain click is still the editor's: it selects and writes.

import { type RefObject, useEffect } from "react";

import type { SlidesHost } from "../editor/host.ts";
import type { EditorSession } from "../editor/session/session.ts";
import { type LinkWays, followLink, linkAt, linkHint, openInWindow } from "./follow.ts";
import { openPage } from "./open.ts";

/** Where a link goes from the editor. */
export function editorWays(session: EditorSession, host: SlidesHost = session.host): LinkWays {
  return {
    slide: (id) => session.goTo(id),
    ...(host.openPage ? { page: (path: string, section: string | null) => void openPage(host, path, section, "peek") } : {}),
    web: (address) => (host.openUrl ? host.openUrl(address) : openInWindow(address)),
  };
}

export function useLinks(session: EditorSession, page: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = page.current;
    if (!root) return;
    const onOver = (event: MouseEvent) => {
      const href = linkAt(event.target);
      const node = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-href]") : null;
      if (href && node && !node.title) node.title = `${linkHint(href)} (Ctrl and click to open)`;
    };
    const onClick = (event: MouseEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const node = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-href]") : null;
      const href = node?.dataset.href;
      if (!href) return;
      if (followLink(href, editorWays(session))) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    root.addEventListener("mouseover", onOver);
    // Before the slide's own press handling, which would take the click for a selection.
    root.addEventListener("click", onClick, true);
    return () => {
      root.removeEventListener("mouseover", onOver);
      root.removeEventListener("click", onClick, true);
    };
  }, [session, page]);
}

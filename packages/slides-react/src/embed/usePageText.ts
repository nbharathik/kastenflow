// The words of an embedded page, kept as the page now reads: the snapshot the deck holds is shown first (and where the page cannot be
// read), then what the host reads, and again when the host says the page changed.

import { pageBody, pageSection } from "@kasten-slides/wasm";
import type { PageSource } from "@kasten-slides/wasm";
import { useEffect, useState } from "react";

import type { SlidesHost } from "../editor/host.ts";

/** What a view needs of the host to show pages: reading them, hearing that they changed, and following a link out of one. */
export type PageAccess = Pick<SlidesHost, "readPage" | "watchPages" | "openPage" | "openUrl" | "pagePanel" | "imageUrl">;

export interface PageText {
  markdown: string;
  /** The host has no such page (or section) now: what is shown is the snapshot. */
  missing: boolean;
}

export function usePageText(access: Partial<PageAccess> | undefined, source: PageSource | null | undefined): PageText {
  const [read, setRead] = useState<{ key: string; text: PageText } | null>(null);
  const path = source?.page ?? null;
  const section = source?.section ?? null;
  const key = `${path}#${section ?? ""}`;
  const readPage = access?.readPage;
  const watchPages = access?.watchPages;

  useEffect(() => {
    if (!readPage || path === null) return;
    let current = true;
    const load = async (): Promise<void> => {
      try {
        const page = await readPage(path);
        if (!current) return;
        const body = page ? pageBody(page.markdown) : null;
        const part = body === null ? null : section ? pageSection(body, section) : body;
        setRead({ key, text: part === null ? { markdown: "", missing: true } : { markdown: part, missing: false } });
      } catch {
        // A page that cannot be read now is drawn from the snapshot, which is not a page that is gone.
      }
    };
    void load();
    const stop = watchPages?.((paths) => {
      if (paths.includes(path)) void load();
    });
    return () => {
      current = false;
      stop?.();
    };
  }, [readPage, watchPages, path, section, key]);

  const shown = read?.key === key ? read.text : null;
  if (shown && !shown.missing) return shown;
  return { markdown: source?.markdown ?? "", missing: shown?.missing === true };
}

// "Save as paper" in a browser tab: the page the person already has open says
// what it is in its own tags (`citation_title`, `citation_author`, JSON-LD...),
// and those fill the form that adds a reference. Nothing is fetched from
// anywhere, the page's words are treated as data, and nothing is saved until
// the person has checked the form.

import { useCallback, useState } from "react";

import { openAddPaper } from "../references/add-state";
import { draftFromPage, readPageMeta } from "../references/page-meta";
import { useWorkspace } from "../workspace/store";
import { browserBackend, NEEDS_DESKTOP } from "./backend";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function useSavePaper(tabId: string): { busy: boolean; start(): Promise<void> } {
  const [busy, setBusy] = useState(false);
  const start = useCallback(async () => {
    const backend = browserBackend();
    const { toast } = useWorkspace.getState();
    if (!backend.pageMeta) return toast(NEEDS_DESKTOP);
    setBusy(true);
    try {
      const answer = await backend.pageMeta(tabId);
      openAddPaper({ draft: draftFromPage(readPageMeta(answer.meta, answer.url, answer.title)) });
    } catch (err) {
      toast(`The page could not be read: ${message(err)}`);
    } finally {
      setBusy(false);
    }
  }, [tabId]);
  return { busy, start };
}

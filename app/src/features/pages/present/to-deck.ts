// "Turn sections into a deck": the page's sections are drafted as a storyboard (a slide each, with its point, its evidence and the notes to say),
// and the storyboard dialog opens so they can be reordered, merged, split, left out and rewritten before the deck is made. The page is not
// changed, and nothing is made until the person says so.

import type { NoteMeta } from "../../../lib/vault/types";
import { titleOf } from "../../workspace/names";
import { flushOpenPage } from "../../workspace/page/open-page";
import { useWorkspace } from "../../workspace/store";
import { sectionTexts } from "../editor/sections/registry";
import { useStoryboard } from "./storyboard/state";

/** Drafts the storyboard of the sections of `note`, which must be open, and opens the dialog for it. Says in a toast why it could not. */
export async function turnSectionsIntoDeck(note: NoteMeta): Promise<void> {
  const { client, toast } = useWorkspace.getState();
  const sections = sectionTexts(note.id || note.path);
  if (!client) return;
  if (!sections || sections.length === 0) {
    toast("This page has nothing to turn into slides yet. A line of --- starts a new section.");
    return;
  }
  try {
    // The slide engine loads only now: a page that makes no deck never needs it.
    const { draftStoryboard, loadSlides } = await import("@kasten-slides/wasm");
    await loadSlides();
    // What the sections say is what the editor holds; the page as the vault has it is what the slides will be kept in step with.
    await flushOpenPage();
    const file = await client.read(note.path);
    const entries = draftStoryboard({ page: note.path, ...(note.id ? { id: note.id } : {}), title: titleOf(note), markdown: file.text }, { chunks: sections });
    if (entries.length === 0) {
      toast("This page has nothing to turn into slides yet.");
      return;
    }
    useStoryboard.getState().show({ note, entries });
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err));
  }
}

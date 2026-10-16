// "Insert in page": a highlight of a PDF goes into a page, beside the PDF or
// anywhere, as a quotation with its source, page, citation and a link back to
// the highlight. The page is changed by the vault's append, after the page
// open on it has written what was typed and before it reloads, as the
// to-do lists of a dashboard do.

import type { Highlight } from "../../../lib/vault/source-types";
import type { NoteMeta } from "../../../lib/vault/types";
import { openPaths } from "../../chat/open-pages";
import { usePeek } from "../../peek/store";
import { chipLabel } from "../../references/labels";
import { buildRows } from "../../references/rows";
import { pageFor, reloadOpenPage } from "../../workspace/page/open-page";
import { useWorkspace } from "../../workspace/store";
import { noteAt } from "../../workspace/tree";
import { sourceTitle, useSources } from "../store";
import { quoteBlock, type PaperRef } from "./pages";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The paper a PDF in `sources/` is: its reference when one goes with it, else the PDF by its title. */
export async function paperOf(source: string): Promise<PaperRef> {
  const { client } = useWorkspace.getState();
  const title = sourceTitle(useSources.getState().list, source);
  try {
    const row = client ? buildRows(await client.bibliography(), [source]).find((r) => r.pdf === source) : undefined;
    if (row) return { key: row.key, label: chipLabel(row.entry), title: row.title || row.key, source };
  } catch {
    // Without a bibliography the PDF is named by its title.
  }
  return { key: null, label: title, title, source };
}

/** The pages open in the window, the one in front first. These are where a quotation can go beside the PDF. */
export function openPages(): NoteMeta[] {
  const state = useWorkspace.getState();
  const peek = usePeek.getState().peek?.path ?? null;
  return openPaths(state, peek).flatMap((path) => noteAt(state.notes, path) ?? []);
}

/** Adds the quotation to the end of the page at `path`. False when it was refused (the reason is said). */
export async function addQuotation(path: string, paper: PaperRef, highlight: Highlight): Promise<boolean> {
  const { client, toast } = useWorkspace.getState();
  if (!client) return false;
  try {
    // What is typed in the page is written first, so the change is made on the page as it is.
    await pageFor(path)?.flush();
    const saved = await client.append(path, quoteBlock(paper, highlight));
    useWorkspace.getState().noteChanged(saved.meta);
    const open = pageFor(path);
    if (open && !open.adopt(saved)) reloadOpenPage(path);
    toast(`Added the quotation to “${saved.meta.title}”`, { label: "Open", run: () => useWorkspace.getState().openPath(path, "here") });
    return true;
  } catch (err) {
    toast(message(err));
    return false;
  }
}

/** Makes a page for notes on the paper, beside the PDF, and puts the quotation in it. */
export async function quoteInNewPage(paper: PaperRef, highlight: Highlight): Promise<boolean> {
  const { create, toast, openRight } = useWorkspace.getState();
  const made = await create({ kind: "page", title: `Notes on ${paper.label || paper.title}`, body: quoteBlock(paper, highlight) }, false);
  if (!made) return false;
  openRight({ view: "page", path: made.meta.path });
  toast(`Made “${made.meta.title}” beside the PDF, with the quotation in it`);
  return true;
}

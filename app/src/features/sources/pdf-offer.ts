// After a PDF is imported: an offer to add it to the references, with the form
// filled from what the PDF says about itself (its information, a DOI or an
// arXiv number on its first page). Nothing is looked up; the person checks the
// form before anything is added. No offer is made for a PDF a reference already
// goes with.

import { buildRows } from "../references/rows";
import { openAddPaper } from "../references/add-state";
import { useWorkspace } from "../workspace/store";
import { sourceTitle, useSources } from "./store";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Opens "Add a paper" with the form filled from the PDF at `path`. */
export async function paperFromPdf(path: string): Promise<void> {
  const { client, toast } = useWorkspace.getState();
  if (!client) return;
  try {
    const bytes = await client.readSource(path);
    // pdf.js and its reading load only now.
    const [{ openPdf }, { draftFromPdf, readPdfFacts }] = await Promise.all([import("./pdf/load"), import("./pdf-metadata")]);
    const doc = await openPdf(bytes);
    try {
      const facts = await readPdfFacts(doc);
      openAddPaper({ draft: draftFromPdf(path, sourceTitle(useSources.getState().list, path), facts) });
    } finally {
      void doc.loadingTask.destroy();
    }
  } catch (err) {
    toast(`The PDF could not be read for its details: ${message(err)}. Add the paper by hand from References.`);
  }
}

/** Offers, in a notice, to add the PDF just imported at `path` to the references. */
export async function offerPaper(path: string): Promise<void> {
  const { client, toast } = useWorkspace.getState();
  if (!client) return;
  try {
    const rows = buildRows(await client.bibliography(), [path]);
    if (rows.some((row) => row.pdf === path)) return;
  } catch {
    // Without a bibliography the offer still stands.
  }
  const name = path.slice(path.lastIndexOf("/") + 1);
  toast(`Imported “${name}”. Add it to your references?`, { label: "Add paper…", run: () => void paperFromPdf(path) });
}

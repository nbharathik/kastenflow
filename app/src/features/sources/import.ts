// PDFs brought into the vault, dropped on the window or picked with Ctrl+O:
// each is kept in sources/ by the core, and the
// first opens in a reader tab. A PDF imported alone is offered to the
// references (pdf-offer.ts).

import { useWorkspace, type OpenHow } from "../workspace/store";
import { useSources } from "./store";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export const isPdfFile = (file: File) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);

/** The core keeps PDFs up to this size (sources/mod.rs `MAX_SOURCE_BYTES`);
 * bigger ones are refused before they are read into memory. */
export const MAX_PDF_BYTES = 100 * 1024 * 1024;

/** Whether a drag carries a PDF; its items' types are readable while it moves. */
export function carriesPdf(data: DataTransfer | null): boolean {
  return [...(data?.items ?? [])].some((item) => item.kind === "file" && item.type === "application/pdf");
}

/** Imports the PDFs among `files` and opens the first; returns their vault paths. */
export async function importPdfs(files: readonly File[], how: OpenHow = "tab"): Promise<string[]> {
  const { client, toast } = useWorkspace.getState();
  if (!client) return [];
  const kept: string[] = [];
  for (const file of files.filter(isPdfFile)) {
    try {
      if (file.size > MAX_PDF_BYTES) throw new Error(`it is over ${MAX_PDF_BYTES / 1024 / 1024} MB`);
      kept.push(await client.importSource(file.name, new Uint8Array(await file.arrayBuffer())));
    } catch (err) {
      toast(`“${file.name}” was not imported: ${message(err)}`);
    }
  }
  if (kept.length > 0) {
    void useSources.getState().loadList();
    useWorkspace.getState().go({ view: "highlights", path: kept[0] }, how);
    if (kept.length > 1) toast(`Imported ${kept.length} PDFs into sources/`);
    // One PDF: offer to add its paper to the references, filled in from the PDF's own words.
    else void import("./pdf-offer").then((offer) => offer.offerPaper(kept[0]!));
  }
  return kept;
}

/** Asks for PDFs to import. */
export function pickPdfs(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/pdf,.pdf";
  input.multiple = true;
  input.addEventListener("change", () => void importPdfs([...(input.files ?? [])]));
  input.click();
}

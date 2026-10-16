import { beforeEach, describe, expect, it, vi } from "vitest";

import { MANAGED_BIB } from "../../lib/vault/reference-types";
import { usePaperDialog } from "../references/add-state";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { useWorkspace } from "../workspace/store";
import { offerPaper, paperFromPdf } from "./pdf-offer";
import { importPdfs } from "./import";
import { useSources } from "./store";

// pdf.js cannot run here: the PDF opens as a document with a title and a stamp on its first page.
vi.mock("./pdf/load", () => ({
  openPdf: async () => ({
    getMetadata: async () => ({ info: { Title: "Attention is all you need", Author: "Ashish Vaswani; Noam Shazeer" } }),
    getPage: async () => ({ getTextContent: async () => ({ items: [{ str: "arXiv:1706.03762v7 [cs.CL] 6 Dec 2017", hasEOL: true }] }) }),
    numPages: 1,
    loadingTask: { destroy: async () => {} },
  }),
}));

const toast = vi.fn();
const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.4 ${text}`);

let vault: MemoryVault;
beforeEach(async () => {
  toast.mockClear();
  usePaperDialog.getState().close();
  vault = new MemoryVault({});
  useWorkspace.setState({ client: vault, toast, go: vi.fn() });
  useSources.setState({ list: null, highlights: {} });
});

describe("the offer after a PDF is imported", () => {
  it("offers the paper, and opens the form filled from the PDF itself when taken", async () => {
    const path = await vault.importSource("attention.pdf", pdf("one"));
    await offerPaper(path);
    expect(toast).toHaveBeenCalledWith("Imported “attention.pdf”. Add it to your references?", expect.objectContaining({ label: "Add paper…" }));
    const action = toast.mock.calls[0]![1] as { run(): void };
    action.run();
    await vi.waitFor(() => expect(usePaperDialog.getState().request?.draft).toBeDefined());
    const draft = usePaperDialog.getState().request!.draft!;
    expect(draft.fields).toMatchObject({ title: "Attention is all you need", author: "Vaswani, Ashish and Shazeer, Noam", eprint: "1706.03762", year: "2017", file: path });
    expect(draft.guessed).toEqual(["author", "year"]);
  });

  it("makes no offer for a PDF a reference already goes with", async () => {
    const path = await vault.importSource("attention.pdf", pdf("one"));
    vault = new MemoryVault({ [MANAGED_BIB]: `@misc{a, title={A}, file={${path}}}\n` });
    await vault.importSource("attention.pdf", pdf("one"));
    useWorkspace.setState({ client: vault });
    await offerPaper(path);
    expect(toast).not.toHaveBeenCalled();
  });

  it("is made after one PDF is imported, and not for several at once", async () => {
    useWorkspace.setState({ client: vault, notes: [] });
    await importPdfs([new File([pdf("one")], "one.pdf", { type: "application/pdf" })]);
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/^Imported “one\.pdf”/), expect.anything()));
    toast.mockClear();
    await importPdfs([new File([pdf("two")], "two.pdf", { type: "application/pdf" }), new File([pdf("three")], "three.pdf", { type: "application/pdf" })]);
    expect(toast).toHaveBeenCalledWith("Imported 2 PDFs into sources/");
    await new Promise((done) => setTimeout(done, 50));
    expect(toast).not.toHaveBeenCalledWith(expect.stringMatching(/Add it to your references/), expect.anything());
  });

  it("says when the PDF could not be read, and where to add the paper instead", async () => {
    await paperFromPdf("sources/missing.pdf");
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/^The PDF could not be read for its details: .*Add the paper by hand from References\.$/));
    expect(usePaperDialog.getState().request).toBeNull();
  });
});

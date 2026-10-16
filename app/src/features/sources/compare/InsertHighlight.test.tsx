// "Insert in page" on a highlight: the quotation lands in the page open beside
// the PDF, with its source, page, citation and a link back; with several pages
// open the person picks one; with none a page for notes is made beside the PDF.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MANAGED_BIB } from "../../../lib/vault/reference-types";
import type { Highlight } from "../../../lib/vault/source-types";
import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { initialLayout } from "../../workspace/tabs";
import { useSources } from "../store";
import { InsertHighlight } from "./InsertHighlight";

const BIB = `@inproceedings{vaswani2017attention,
  author = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki},
  title = {Attention is all you need},
  year = {2017},
  file = {sources/attention.pdf},
}
`;
const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.4 ${text}`);
const toast = vi.fn();

let vault: MemoryVault;
let highlight: Highlight;

async function setup(bib = BIB) {
  vault = new MemoryVault({
    [MANAGED_BIB]: bib,
    "library/a.md": "---\nid: 01A\ntitle: Alpha\n---\nAlpha body.\n",
    "library/b.md": "---\nid: 01B\ntitle: Beta\n---\nBeta body.\n",
  });
  const source = await vault.importSource("attention.pdf", pdf("one"));
  highlight = await vault.addHighlight(source, { page: 3, rects: [[0, 0, 10, 10]], text: "The Transformer relies entirely on attention.", color: "yellow", comment: "key claim" });
  useWorkspace.setState({ client: vault, notes: await vault.list(), toast, layout: initialLayout({ view: "highlights", path: source }) });
  useSources.setState({ list: await vault.sources(), highlights: {} });
  return source;
}

beforeEach(() => toast.mockClear());
afterEach(cleanup);

const text = async (path: string) => (await vault.read(path)).text;

describe("inserting a highlight in a page", () => {
  it("adds the quotation to the one page that is open, with the citation, the page and the way back", async () => {
    const source = await setup();
    useWorkspace.getState().openRight({ view: "page", path: "library/a.md" });
    render(<InsertHighlight source={source} highlight={highlight} onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Insert in page" }));
    await waitFor(async () => expect(await text("library/a.md")).toContain("> The Transformer relies entirely on attention."));
    const page = await text("library/a.md");
    expect(page).toContain("Alpha body.");
    expect(page).toContain(`> [@vaswani2017attention, p. 3] · [Attention is all you need, p. 3](kasten:pdf/sources/attention.pdf?page=3&highlight=${highlight.id})`);
    expect(page).toContain("Comment: key claim");
    expect(toast).toHaveBeenCalledWith("Added the quotation to “Alpha”", expect.objectContaining({ label: "Open" }));
    expect(await text("library/b.md")).not.toContain("Transformer");
  });

  it("asks which page when several are open, and writes only to that one", async () => {
    const source = await setup();
    useWorkspace.getState().openRight({ view: "page", path: "library/a.md" });
    useWorkspace.getState().openRight({ view: "page", path: "library/b.md" });
    const done = vi.fn();
    render(<InsertHighlight source={source} highlight={highlight} onDone={done} />);
    fireEvent.click(screen.getByRole("button", { name: "Insert in page" }));
    const choices = within(await screen.findByRole("group", { name: "Insert in which page?" }));
    expect(choices.getAllByRole("button").map((b) => b.textContent).sort()).toEqual(["Alpha", "Beta"]);
    expect(await text("library/a.md")).not.toContain("Transformer");
    fireEvent.click(choices.getByRole("button", { name: "Beta" }));
    await waitFor(async () => expect(await text("library/b.md")).toContain("> The Transformer relies entirely on attention."));
    expect(await text("library/a.md")).not.toContain("Transformer");
    await waitFor(() => expect(done).toHaveBeenCalled());
  });

  it("makes a page for notes on the paper beside the PDF when no page is open", async () => {
    const source = await setup();
    render(<InsertHighlight source={source} highlight={highlight} onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Insert in page" }));
    await waitFor(async () => expect((await vault.list()).some((n) => n.title === "Notes on Vaswani et al., 2017")).toBe(true));
    const made = (await vault.list()).find((n) => n.title === "Notes on Vaswani et al., 2017")!;
    expect(await text(made.path)).toContain("> The Transformer relies entirely on attention.");
    expect(useWorkspace.getState().layout.panes.length).toBe(2);
  });

  it("names a PDF that no reference goes with by its title and links back to it alone", async () => {
    const source = await setup("");
    useWorkspace.getState().openRight({ view: "page", path: "library/a.md" });
    render(<InsertHighlight source={source} highlight={highlight} onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Insert in page" }));
    await waitFor(async () => expect(await text("library/a.md")).toContain("> The Transformer relies entirely on attention."));
    const page = await text("library/a.md");
    expect(page).not.toContain("[@");
    expect(page).toContain(`> [attention, p. 3](kasten:pdf/sources/attention.pdf?page=3&highlight=${highlight.id})`);
  });
});

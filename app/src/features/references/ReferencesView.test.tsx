// The References place: the table with its filters, a reference's structured
// and BibTeX edits, a managed copy of an external reference, the rename of a
// key and adding a paper, all against the preview's own vault.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MANAGED_BIB } from "../../lib/vault/reference-types";
import { useCompareDialog } from "../sources/compare/compare-state";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { useWorkspace } from "../workspace/store";
import { usePaperDialog } from "./add-state";
import AddPaperHost from "./AddPaperHost";
import { ReferencesView } from "./ReferencesView";
import { useReferenceRequests } from "./requests";

const MANAGED = `@article{vaswani2017attention,
  author = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki},
  title = {Attention is all you need},
  journal = {NeurIPS},
  year = {2017},
  doi = {10.5555/3295222.3295349},
}

@misc{thin,
  title = {Only a title},
}
`;
const ZOTERO = "@book{knuth1997art, author={Knuth, Donald E.}, title={The Art of Computer Programming}, publisher={Addison-Wesley}, year={1997}}\n";
const PAGE = "---\nid: 01A\ntitle: Alpha\n---\nAs shown by [@vaswani2017attention], and again [see @vaswani2017attention, p. 4].\n";

let vault: MemoryVault;
const toast = vi.fn<(text: string, action?: unknown) => void>();
const go = vi.fn();
const openPath = vi.fn();

async function setup(files: Record<string, string> = {}) {
  vault = new MemoryVault({ [MANAGED_BIB]: MANAGED, "zotero/lib.bib": ZOTERO, "library/a.md": PAGE, ...files });
  useWorkspace.setState({ client: vault, notes: await vault.list(), toast, go, openPath });
}

beforeEach(() => {
  localStorage.clear();
  toast.mockClear();
  go.mockClear();
  openPath.mockClear();
  usePaperDialog.getState().close();
  useReferenceRequests.getState().clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const table = () => screen.findByRole("table", { name: "References" });
const rowOf = async (key: string) => {
  const rows = within(await table()).getAllByRole("row");
  const row = rows.find((r) => within(r).queryByRole("button", { name: key }));
  if (!row) throw new Error(`no row for ${key}`);
  return row;
};
const keysShown = async () =>
  within(await table())
    .getAllByRole("row")
    .slice(1)
    .map((r) => r.querySelector("button[data-row]")?.textContent);

describe("the References table", () => {
  it("lists the managed entries and the other files' read-only ones by key, with where each is cited", async () => {
    await setup();
    render(<ReferencesView />);
    expect(await keysShown()).toEqual(["knuth1997art", "thin", "vaswani2017attention"]);
    expect(await screen.findByText("3 references: 2 managed, 1 from other files")).toBeTruthy();
    const vaswani = await rowOf("vaswani2017attention");
    expect(within(vaswani).getByText("Vaswani et al.")).toBeTruthy();
    expect(within(vaswani).getByText("Managed")).toBeTruthy();
    expect(within(vaswani).getByRole("link", { name: /doi:10\.5555/ }).getAttribute("href")).toBe("https://doi.org/10.5555/3295222.3295349");
    // Cited once, in the Alpha page.
    await waitFor(() => expect(within(vaswani).getByText("1 page")).toBeTruthy());
    expect(within(await rowOf("knuth1997art")).getByText("External: lib.bib")).toBeTruthy();
    expect(within(await rowOf("thin")).getByText("Incomplete")).toBeTruthy();
  });

  it("narrows by file, by what is incomplete and by words, and sorts by a column head", async () => {
    await setup();
    render(<ReferencesView />);
    await table();
    fireEvent.click(screen.getByRole("button", { name: "Incomplete" }));
    expect(await keysShown()).toEqual(["thin"]);
    fireEvent.click(screen.getByRole("button", { name: "External" }));
    expect(await keysShown()).toEqual(["knuth1997art"]);
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search references" }), { target: { value: "shazeer" } });
    expect(await keysShown()).toEqual(["vaswani2017attention"]);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search references" }), { target: { value: "zzz" } });
    expect(await screen.findByText("No reference matches.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear the search and filter" }));
    fireEvent.click(screen.getByRole("button", { name: "Sort by year" }));
    expect(await keysShown()).toEqual(["knuth1997art", "vaswani2017attention", "thin"]);
    fireEvent.click(screen.getByRole("button", { name: "Sort by year" }));
    expect(await keysShown()).toEqual(["vaswani2017attention", "knuth1997art", "thin"]);
  });

  it("marks the entries the bibliography repeats", async () => {
    await setup({ "zotero/lib.bib": `${ZOTERO}@article{vaswani2017attention, title={Attention is all you need}}\n` });
    render(<ReferencesView />);
    await table();
    fireEvent.click(screen.getByRole("button", { name: "Repeated" }));
    expect(await keysShown()).toEqual(["vaswani2017attention", "vaswani2017attention"]);
  });

  it("says what the table is for when there is nothing in it, and offers to add a paper", async () => {
    vault = new MemoryVault({ "library/a.md": PAGE });
    useWorkspace.setState({ client: vault, notes: await vault.list(), toast, go, openPath });
    render(<ReferencesView />);
    expect(await screen.findByRole("heading", { name: "Keep the papers you cite" })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Add a paper…" })[0]!);
    expect(usePaperDialog.getState().request).not.toBeNull();
  });

  it("compares the references ticked, from two on", async () => {
    await setup();
    render(<ReferencesView />);
    await table();
    const compare = () => screen.getByRole("button", { name: /^Compare/ }) as HTMLButtonElement;
    expect(compare().disabled).toBe(true);
    const rows = within(await table());
    fireEvent.click(rows.getByRole("checkbox", { name: "Tick vaswani2017attention" }));
    expect(compare().disabled).toBe(true);
    fireEvent.click(rows.getByRole("checkbox", { name: "Tick thin" }));
    expect(compare().textContent).toBe("Compare 2…");
    fireEvent.click(compare());
    expect(useCompareDialog.getState().request).toEqual({ keys: ["vaswani2017attention", "thin"] });
    // Ticking every row at the head of the column, and clearing it.
    fireEvent.click(rows.getByRole("checkbox", { name: "Tick every reference shown" }));
    expect(screen.getByText("3 ticked")).toBeTruthy();
    fireEvent.click(rows.getByRole("checkbox", { name: "Tick every reference shown" }));
    expect(screen.queryByText(/ticked/)).toBeNull();
  });

  it("opens at the reference a request names", async () => {
    await setup();
    useReferenceRequests.setState({ key: "thin" });
    render(<ReferencesView />);
    expect(await screen.findByRole("complementary", { name: "thin" })).toBeTruthy();
    expect(useReferenceRequests.getState().key).toBeNull();
  });
});

describe("a reference's panel", () => {
  it("edits the fields in place and writes only what changed", async () => {
    await setup();
    const update = vi.spyOn(vault, "updateReference");
    render(<ReferencesView />);
    fireEvent.click(await screen.findByRole("button", { name: "thin" }));
    const panel = within(await screen.findByRole("complementary", { name: "thin" }));
    const authors = panel.getByLabelText(/^Authors/);
    // What the entry lacks is said, and left empty.
    expect(panel.getAllByText("Missing", { selector: "span" })).toHaveLength(2);
    fireEvent.change(authors, { target: { value: "Doe, Jane" } });
    fireEvent.change(panel.getByLabelText(/^Year/), { target: { value: "2021" } });
    fireEvent.click(panel.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith("thin", { author: "Doe, Jane", year: "2021" }, expect.any(String)));
    await waitFor(async () => expect(within(await rowOf("thin")).getByText("Doe")).toBeTruthy());
    expect(await vault.references()).toContain("author = {Doe, Jane}");
    expect(toast).toHaveBeenCalledWith("Saved “thin”", undefined);
  });

  it("checks a hand-edited entry as it is typed and saves one whole entry with the same key", async () => {
    await setup();
    const replace = vi.spyOn(vault, "replaceReference");
    render(<ReferencesView />);
    fireEvent.click(await screen.findByRole("button", { name: "thin" }));
    const panel = within(await screen.findByRole("complementary", { name: "thin" }));
    fireEvent.click(panel.getByRole("button", { name: "BibTeX" }));
    const box = (await panel.findByRole("textbox", { name: /BibTeX for/ })) as HTMLTextAreaElement;
    // The entry as the file has it, not a tidied copy.
    expect(box.value).toBe("@misc{thin,\n  title = {Only a title},\n}");
    fireEvent.change(box, { target: { value: "@misc{other, title = {x}}" } });
    expect(panel.getByText(/key must stay “thin”/)).toBeTruthy();
    expect((panel.getByRole("button", { name: "Save BibTeX" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(box, { target: { value: "@misc{thin,\n  title = {Changed},\n  note = {kept}\n}" } });
    expect(panel.getByText("This is one whole entry with the same key.")).toBeTruthy();
    fireEvent.click(panel.getByRole("button", { name: "Save BibTeX" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("thin", "@misc{thin,\n  title = {Changed},\n  note = {kept}\n}", expect.any(String)));
    const file = await vault.references();
    expect(file).toContain("note = {kept}");
    expect(file).toContain("@article{vaswani2017attention,");
  });

  it("copies a reference as a citation, as BibTeX, as a link and as the text that cites it", async () => {
    await setup();
    const write = vi.fn((_text: string) => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: write } });
    render(<ReferencesView />);
    fireEvent.click(await screen.findByRole("button", { name: "vaswani2017attention" }));
    const panel = within(await screen.findByRole("complementary", { name: "vaswani2017attention" }));
    fireEvent.click(panel.getByRole("button", { name: "Copy citation" }));
    await waitFor(() => expect(write).toHaveBeenLastCalledWith("Vaswani, Ashish; Shazeer, Noam; Parmar, Niki (2017). Attention is all you need. NeurIPS. https://doi.org/10.5555/3295222.3295349"));
    fireEvent.click(panel.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(write).toHaveBeenLastCalledWith("https://doi.org/10.5555/3295222.3295349"));
    fireEvent.click(panel.getByRole("button", { name: "Copy [@vaswani2017attention]" }));
    await waitFor(() => expect(write).toHaveBeenLastCalledWith("[@vaswani2017attention]"));
    fireEvent.click(panel.getByRole("button", { name: "Copy BibTeX" }));
    await waitFor(() => expect(String(write.mock.calls.at(-1)?.[0])).toContain("@article{vaswani2017attention,"));
  });

  it("lists where it is cited with a way to open each", async () => {
    await setup();
    render(<ReferencesView />);
    fireEvent.click(await screen.findByRole("button", { name: "vaswani2017attention" }));
    const panel = within(await screen.findByRole("complementary", { name: "vaswani2017attention" }));
    const cited = within(await panel.findByRole("region", { name: "Cited in" }));
    expect(await cited.findByText("2 times")).toBeTruthy();
    fireEvent.click(cited.getByRole("button", { name: "Open Alpha" }));
    expect(openPath).toHaveBeenCalledWith("library/a.md", "tab");
  });

  it("makes a managed copy of an external reference, which is then the one to edit", async () => {
    await setup();
    render(<ReferencesView />);
    fireEvent.click(await screen.findByRole("button", { name: "knuth1997art" }));
    const panel = within(await screen.findByRole("complementary", { name: "knuth1997art" }));
    // Read only: no form, no rename.
    expect(panel.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(panel.queryByRole("button", { name: "Rename key…" })).toBeNull();
    fireEvent.click(panel.getByRole("button", { name: "Make a managed copy" }));
    await waitFor(async () => expect((await vault.bibliography()).managed.entries.map((e) => e.key)).toEqual(["vaswani2017attention", "thin", "knuth1997art"]));
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/^Copied 1 reference into sources\/references\.bib/), undefined);
    // The copy is selected, and can be edited.
    await waitFor(() => expect(screen.getByRole("button", { name: "Save changes", hidden: false })).toBeTruthy());
    // The external file is left as it was.
    expect((await vault.bibliography()).external[0]!.entries).toHaveLength(1);
  });
});

describe("renaming a key", () => {
  it("shows what it would change before it changes anything, and renames the key where it is cited", async () => {
    await setup();
    render(<ReferencesView />);
    fireEvent.click(await screen.findByRole("button", { name: "vaswani2017attention" }));
    fireEvent.click(await screen.findByRole("button", { name: "Rename key…" }));
    const dialog = within(await screen.findByRole("dialog", { name: /Rename the key/ }));
    const field = dialog.getByLabelText("New key");
    expect((dialog.getByRole("button", { name: "Rename" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(field, { target: { value: "bad key" } });
    expect(dialog.getByRole("alert").textContent).toMatch(/space/);
    fireEvent.change(field, { target: { value: "vaswani2017" } });
    expect(await dialog.findByText("This changes the key in the reference and in 1 page, 0 decks, 0 pictures.")).toBeTruthy();
    expect(dialog.getByText("Alpha (2 citations)")).toBeTruthy();
    // Nothing is written yet.
    expect((await vault.read("library/a.md")).text).toContain("[@vaswani2017attention]");
    await act(async () => fireEvent.click(dialog.getByRole("button", { name: "Rename" })));
    await waitFor(async () => expect((await vault.read("library/a.md")).text).toContain("[@vaswani2017]"));
    expect((await vault.read("library/a.md")).text).toContain("[see @vaswani2017, p. 4]");
    expect(await vault.references()).toContain("@article{vaswani2017,");
    expect(toast.mock.calls.at(-1)![0]).toMatch(/^Renamed “vaswani2017attention” to “vaswani2017” in 1 page/);
  });

  it("says why a key cannot be taken", async () => {
    await setup();
    render(<ReferencesView />);
    fireEvent.click(await screen.findByRole("button", { name: "vaswani2017attention" }));
    fireEvent.click(await screen.findByRole("button", { name: "Rename key…" }));
    const dialog = within(await screen.findByRole("dialog", { name: /Rename the key/ }));
    fireEvent.change(dialog.getByLabelText("New key"), { target: { value: "thin" } });
    expect((await dialog.findByRole("alert")).textContent).toMatch(/already a key/);
    expect((dialog.getByRole("button", { name: "Rename" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("adding a paper", () => {
  const mount = async () => {
    await setup();
    render(
      <>
        <ReferencesView />
        <AddPaperHost />
      </>,
    );
    await table();
  };
  const dialog = async () => within(await screen.findByRole("dialog", { name: "Add a paper" }));

  it("reads pasted BibTeX, keeps its key, and adds it to the managed file", async () => {
    await mount();
    fireEvent.click(screen.getAllByRole("button", { name: "Add a paper…" })[0]!);
    const d = await dialog();
    fireEvent.change(d.getByRole("textbox"), { target: { value: "@article{doe2020thing, author = {Doe, Jane}, title = {A thing}, journal = {Things}, year = {2020}}" } });
    fireEvent.click(d.getByRole("button", { name: "Read it" }));
    expect((await d.findByLabelText("Key")) as HTMLInputElement).toHaveProperty("value", "doe2020thing");
    expect((d.getByLabelText(/^Title/) as HTMLInputElement).value).toBe("A thing");
    await waitFor(() => expect((d.getByRole("button", { name: "Add to references" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(d.getByRole("button", { name: "Add to references" }));
    await waitFor(async () => expect((await vault.bibliography()).managed.entries.map((e) => e.key)).toContain("doe2020thing"));
    expect(toast).toHaveBeenCalledWith("Added “doe2020thing” to your references", undefined);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add a paper" })).toBeNull());
    expect(await screen.findByRole("complementary", { name: "doe2020thing" })).toBeTruthy();
  });

  it("makes the key from a plain citation, marks the guesses, and leaves a missing field empty", async () => {
    await mount();
    fireEvent.click(screen.getAllByRole("button", { name: "Add a paper…" })[0]!);
    const d = await dialog();
    fireEvent.change(d.getByRole("textbox"), { target: { value: "Hinton, G. (2015). Distilling the knowledge." } });
    fireEvent.click(d.getByRole("button", { name: "Read it" }));
    await waitFor(() => expect((d.getByLabelText("Key") as HTMLInputElement).value).toBe("hinton2015distilling"));
    expect(d.getAllByText("Check this").length).toBeGreaterThan(0);
    // Where it appeared was not in the text, so it is empty, not invented; the year was in brackets, so it is not a guess.
    expect((d.getByLabelText(/^Where it appeared/) as HTMLInputElement).value).toBe("");
    expect((d.getByLabelText(/^Year/) as HTMLInputElement).value).toBe("2015");
    expect(within(d.getByLabelText(/^Year/).closest("div")!).queryByText("Check this")).toBeNull();
  });

  it("fills only the DOI from a DOI, and says details are not fetched", async () => {
    await mount();
    fireEvent.click(screen.getAllByRole("button", { name: "Add a paper…" })[0]!);
    const d = await dialog();
    fireEvent.change(d.getByRole("textbox"), { target: { value: "https://doi.org/10.1000/xyz123" } });
    fireEvent.click(d.getByRole("button", { name: "Read it" }));
    expect(await d.findByText("Details are not fetched; fill them in or paste BibTeX.")).toBeTruthy();
    expect((d.getByLabelText(/^DOI/) as HTMLInputElement).value).toBe("10.1000/xyz123");
    expect((d.getByLabelText(/^Title/) as HTMLInputElement).value).toBe("");
  });

  it("names a reference it would repeat, offers to open it, and holds the save back until told it is another work", async () => {
    await mount();
    fireEvent.click(screen.getAllByRole("button", { name: "Add a paper…" })[0]!);
    const d = await dialog();
    fireEvent.change(d.getByRole("textbox"), { target: { value: "@article{another, title = {Attention again}, doi = {10.5555/3295222.3295349}}" } });
    fireEvent.click(d.getByRole("button", { name: "Read it" }));
    expect(await d.findByText("“vaswani2017attention” in sources/references.bib has the same DOI.")).toBeTruthy();
    const save = d.getByRole("button", { name: "Add to references" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(d.getByLabelText("It is another work: add it anyway"));
    expect(save.disabled).toBe(false);
    fireEvent.click(d.getByRole("button", { name: "Open existing" }));
    expect(go).toHaveBeenCalledWith({ view: "references" });
    // The dialog is gone and the view shows the reference it repeats.
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add a paper" })).toBeNull());
    expect(await screen.findByRole("complementary", { name: "vaswani2017attention" })).toBeTruthy();
  });

  it("refuses a key that is taken and offers a free one", async () => {
    await mount();
    fireEvent.click(screen.getAllByRole("button", { name: "Add a paper…" })[0]!);
    const d = await dialog();
    fireEvent.change(d.getByRole("textbox"), { target: { value: "@article{thin, author = {Doe, Jane}, title = {Other}, year = {2020}}" } });
    fireEvent.click(d.getByRole("button", { name: "Read it" }));
    expect(await d.findByText("That key is taken.")).toBeTruthy();
    expect((d.getByRole("button", { name: "Add to references" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(await d.findByRole("button", { name: /^Use .* instead$/ }));
    await waitFor(() => expect((d.getByRole("button", { name: "Add to references" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("goes through several pasted entries one at a time", async () => {
    await mount();
    fireEvent.click(screen.getAllByRole("button", { name: "Add a paper…" })[0]!);
    const d = await dialog();
    fireEvent.change(d.getByRole("textbox"), { target: { value: "@misc{one1, title={One}}\n@misc{two2, title={Two}}" } });
    fireEvent.click(d.getByRole("button", { name: "Read it" }));
    expect(await d.findByText("Entry 1 of 2")).toBeTruthy();
    fireEvent.click(d.getByRole("button", { name: "Skip this one" }));
    expect(await d.findByText("Entry 2 of 2")).toBeTruthy();
    expect((d.getByLabelText("Key") as HTMLInputElement).value).toBe("two2");
  });
});

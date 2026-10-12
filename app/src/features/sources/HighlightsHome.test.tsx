import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useFlags } from "../workspace/flags";
import { HIGHLIGHT_DRAG } from "../workspace/drag";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { useWorkspace } from "../workspace/store";
import { HighlightsHome } from "./HighlightsHome";
import { useSources } from "./store";
import { FIRST, PRIMER, sampleVault, SECOND, transfer } from "./test-kit";

async function open() {
  const vault = await sampleVault();
  useWorkspace.setState({ place: { view: "highlights" } });
  render(<HighlightsHome />);
  const source = await screen.findByRole("region", { name: "A Zettelkasten primer" });
  return { vault, source, rows: () => within(source).queryAllByRole("listitem") };
}

const summary = () => within(screen.getByRole("group", { name: "Summary" }));

beforeEach(() => {
  localStorage.clear();
  useFlags.setState({ on: [] });
});
afterEach(cleanup);

describe("the Highlights view", () => {
  it("lists each source's highlights in reading order", async () => {
    const { source, rows } = await open();
    expect(summary().getByText("3 highlights")).toBeTruthy();
    expect(summary().getByText("1 PDF")).toBeTruthy();
    expect(within(source).getByText("3 highlights")).toBeTruthy();
    expect(rows().map((r) => r.textContent)).toEqual([
      expect.stringMatching(/^A note should hold one idea.*The rule the rest follows from\.Page 1/),
      expect.stringMatching(/^Structure is the result of the work.*Page 1/),
      expect.stringMatching(/^Keep the reference to the source.*Exactly what a highlight card does\.Page 2/),
    ]);
  });

  it("filters by colour and by words, in the text or the comment", async () => {
    const { source, rows } = await open();
    const purple = screen.getByRole("button", { name: "Purple" });
    fireEvent.click(purple);
    expect(purple.getAttribute("aria-pressed")).toBe("true");
    expect(rows()).toHaveLength(1);
    expect(within(source).getByText("1 of 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Green" }));
    expect(rows()).toHaveLength(2);
    fireEvent.click(purple);
    fireEvent.click(screen.getByRole("button", { name: "Green" }));
    const find = screen.getByRole("searchbox", { name: "Find in highlights" });
    fireEvent.change(find, { target: { value: "REFERENCE" } });
    expect(rows().map((r) => r.textContent)).toEqual([expect.stringContaining("Keep the reference")]);
    fireEvent.change(find, { target: { value: "follows from" } });
    expect(rows().map((r) => r.textContent)).toEqual([expect.stringContaining("one idea")]);
    // Nothing matches: the source goes too.
    fireEvent.change(find, { target: { value: "no such words" } });
    expect(screen.queryByRole("region", { name: "A Zettelkasten primer" })).toBeNull();
  });

  it("makes a highlight's card, which it then opens, and filters by the card's tags", async () => {
    const { vault, rows } = await open();
    await act(async () => fireEvent.click(within(rows()[0]!).getByRole("button", { name: "Make card" })));
    const card = useSources.getState().highlights[PRIMER]!.find((h) => h.id === FIRST)!.card!;
    expect(card).toMatch(/^inbox\/.+\.md$/);
    await act(async () => useWorkspace.getState().noteChanged((await vault.setTags(card, ["method"], [])).meta));
    fireEvent.click(await within(rows()[0]!).findByRole("button", { name: "Open card" }));
    expect(useWorkspace.getState().place).toEqual({ view: "page", path: card });
    expect(within(rows()[0]!).getByText("#method")).toBeTruthy();
    // The tag is picked from a themed list, not the browser's.
    fireEvent.click(screen.getByRole("button", { name: "Tag: All tags" }));
    const list = screen.getByRole("listbox", { name: "Tag" });
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["All tags", "#method"]);
    fireEvent.click(within(list).getByRole("option", { name: "#method" }));
    expect(rows()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Tag: #method" })).toBeTruthy();
  });

  it("opens the reader at a highlight's spot", async () => {
    const { rows } = await open();
    fireEvent.click(within(rows()[2]!).getByRole("button", { name: /^Keep the reference/ }));
    expect(useWorkspace.getState().place).toEqual({ view: "highlights", path: PRIMER });
  });

  it("drags a highlight, to become its card where it lands", async () => {
    const { rows } = await open();
    const data = transfer();
    fireEvent.dragStart(rows()[1]!.firstElementChild!, { dataTransfer: data });
    expect(JSON.parse(data.getData(HIGHLIGHT_DRAG))).toEqual([{ source: PRIMER, id: SECOND }]);
    expect(data.getData("text/plain")).toBe(`${PRIMER}#${SECOND}`);
  });

  it("invites a first PDF when there are none", async () => {
    useSources.setState({ list: null, highlights: {} });
    await useWorkspace.getState().connect({ client: new MemoryVault({}) });
    render(<HighlightsHome />);
    expect(await screen.findByRole("heading", { name: "Read and highlight PDFs" })).toBeTruthy();
    expect(summary().getByText("0 highlights")).toBeTruthy();
    expect(summary().getByText("0 PDFs")).toBeTruthy();
    // One clear action, and no filters for nothing.
    expect(screen.queryByRole("toolbar", { name: "Filters" })).toBeNull();
  });

  it("shows the PDFs as a library, hides carded highlights on asking, and lists the newest first", async () => {
    const { rows } = await open();
    const library = screen.getByRole("region", { name: "PDFs" });
    expect(within(library).getByRole("button", { name: /A Zettelkasten primer/ }).textContent).toContain("3 highlights");
    await act(async () => fireEvent.click(within(rows()[0]!).getByRole("button", { name: "Make card" })));
    await expect.poll(() => within(library).getByRole("button", { name: /A Zettelkasten primer/ }).textContent).toContain("1 card");
    expect(summary().getByText("1 card")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "No card yet" }));
    expect(rows()).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "No card yet" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Show" })).getByRole("button", { name: "Newest" }));
    const newest = screen.getByRole("region", { name: "Newest highlights" });
    expect(within(newest).getAllByRole("listitem")).toHaveLength(3);
    expect(within(newest).getAllByText("A Zettelkasten primer")).toHaveLength(3);
  });
});

describe("the toolbar", () => {
  it("shows the filters that are on as chips that take themselves off, and clears them all", async () => {
    const { rows } = await open();
    expect(screen.queryByRole("list", { name: "Filters on" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Purple" }));
    fireEvent.click(screen.getByRole("button", { name: "No card yet" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Find in highlights" }), { target: { value: "structure" } });
    const chips = within(screen.getByRole("list", { name: "Filters on" }));
    expect(chips.getAllByRole("button").map((b) => b.textContent)).toEqual(["Purple", "No card yet", "“structure”", "Clear all"]);
    expect(rows()).toHaveLength(1);
    // One chip takes its filter off.
    fireEvent.click(chips.getByRole("button", { name: "Remove filter: Purple" }));
    expect(screen.getByRole("button", { name: "Purple" }).getAttribute("aria-pressed")).toBe("false");
    expect(within(screen.getByRole("list", { name: "Filters on" })).queryByRole("button", { name: "Remove filter: Purple" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Purple" }));
    // Clear all takes every one off.
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(screen.queryByRole("list", { name: "Filters on" })).toBeNull();
    expect((screen.getByRole("searchbox", { name: "Find in highlights" }) as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", { name: "No card yet" }).getAttribute("aria-pressed")).toBe("false");
    expect(rows()).toHaveLength(3);
  });

  it("has a button that empties the search", async () => {
    const { rows } = await open();
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "Find in highlights" }), { target: { value: "structure" } });
    expect(rows()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(rows()).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
  });

  it("counts each colour on its chip, and leaves the tag list out while no card has tags", async () => {
    await open();
    expect(within(screen.getByRole("button", { name: "Purple" })).getByText("1")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Tag:/ })).toBeNull();
  });
});

describe("a PDF's section", () => {
  it("folds away with its highlights, and stays folded the next time", async () => {
    const { source, rows } = await open();
    const fold = within(source).getByRole("button", { name: "Hide the highlights of A Zettelkasten primer" });
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(fold);
    expect(rows()).toHaveLength(0);
    expect(within(source).getByRole("button", { name: "Show the highlights of A Zettelkasten primer" }).getAttribute("aria-expanded")).toBe("false");
    // The heading stays, with its count and way in.
    expect(within(source).getByText("3 highlights")).toBeTruthy();
    expect(within(source).getByRole("button", { name: "Open A Zettelkasten primer" })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("kasten.flags")!)).toEqual([`fold:highlights:${PRIMER}`]);

    cleanup();
    render(<HighlightsHome />);
    const again = await screen.findByRole("region", { name: "A Zettelkasten primer" });
    expect(within(again).queryAllByRole("listitem")).toHaveLength(0);
    fireEvent.click(within(again).getByRole("button", { name: "Show the highlights of A Zettelkasten primer" }));
    expect(within(again).queryAllByRole("listitem")).toHaveLength(3);
  });

  it("opens the reader from its heading, by the title and by Open", async () => {
    const { source } = await open();
    fireEvent.click(within(source).getByRole("button", { name: "A Zettelkasten primer" }));
    expect(useWorkspace.getState().place).toEqual({ view: "highlights", path: PRIMER });
    useWorkspace.setState({ place: { view: "highlights" } });
    fireEvent.click(within(source).getByRole("button", { name: "Open A Zettelkasten primer" }));
    expect(useWorkspace.getState().place).toEqual({ view: "highlights", path: PRIMER });
  });
});

describe("a highlight's actions", () => {
  it("are all there to reach by keyboard: open at the spot, copy and make a card", async () => {
    const { rows } = await open();
    for (const row of rows()) {
      const names = within(row).getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent);
      expect(names).toEqual([expect.stringMatching(/./), "Open at spot", "Copy", "Make card"]);
    }
    fireEvent.click(within(rows()[1]!).getByRole("button", { name: "Open at spot" }));
    expect(useWorkspace.getState().place).toEqual({ view: "highlights", path: PRIMER });
  });

  it("show a card it already has as a link, and no longer offer to make one", async () => {
    const { rows } = await open();
    expect(within(rows()[0]!).queryByRole("button", { name: "Open card" })).toBeNull();
    await act(async () => fireEvent.click(within(rows()[0]!).getByRole("button", { name: "Make card" })));
    const link = await within(rows()[0]!).findByRole("button", { name: "Open card" });
    expect(link.classList.contains("kasten-hls-cardlink")).toBe(true);
    expect(rows()[0]!.querySelector(".kasten-hls-row")!.classList.contains("has-card")).toBe(true);
    expect(within(rows()[0]!).queryByRole("button", { name: "Make card" })).toBeNull();
    // The other two are as they were.
    expect(within(rows()[1]!).getByRole("button", { name: "Make card" })).toBeTruthy();
  });
});

describe("when nothing shows", () => {
  it("says no highlights match, and one button clears the filters (by PDF and newest)", async () => {
    const { rows } = await open();
    const find = screen.getByRole("searchbox", { name: "Find in highlights" });
    fireEvent.change(find, { target: { value: "no such words" } });
    expect(screen.getByText("No highlights match these filters.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.queryByText("No highlights match these filters.")).toBeNull();
    expect(rows()).toHaveLength(3);

    fireEvent.click(within(screen.getByRole("group", { name: "Show" })).getByRole("button", { name: "Newest" }));
    fireEvent.change(find, { target: { value: "no such words" } });
    expect(screen.getByText("No highlights match these filters.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(within(screen.getByRole("region", { name: "Newest highlights" })).getAllByRole("listitem")).toHaveLength(3);
  });

  it("quiets a PDF on the shelf whose highlights the filters all hide", async () => {
    await open();
    const library = screen.getByRole("region", { name: "PDFs" });
    const book = () => within(library).getByRole("button", { name: /A Zettelkasten primer/ });
    expect(book().classList.contains("is-quiet")).toBe(false);
    fireEvent.change(screen.getByRole("searchbox", { name: "Find in highlights" }), { target: { value: "no such words" } });
    expect(book().classList.contains("is-quiet")).toBe(true);
    expect(book().textContent).toContain("0 shown");
    fireEvent.change(screen.getByRole("searchbox", { name: "Find in highlights" }), { target: { value: "structure" } });
    expect(book().classList.contains("is-quiet")).toBe(false);
    expect(book().textContent).toContain("1 shown");
  });
});

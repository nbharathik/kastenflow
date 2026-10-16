// Comparing three papers with no AI: the references and their PDFs and
// highlights go in, an ordinary page comes out, and every quotation in it links
// back to the highlight it came from. Then the optional AI help, with a
// scripted model: the passages are shown first, the answer is read against
// them, and a draft is only kept when asked for.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MANAGED_BIB } from "../../../lib/vault/reference-types";
import { CLAUDE, resetChat, scriptedChat, type Scripted } from "../../chat/test-kit";
import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { useSources } from "../store";
import { openCompare, useCompareDialog } from "./compare-state";
import { CompareHost } from "./CompareHost";

// pdf.js cannot run here: the pages the AI would be sent are these.
vi.mock("../../chat/pdf-excerpts", () => ({
  excerptsFor: async (chips: readonly { ref: string[] }[]) =>
    chips.flatMap((chip) => {
      const [source, spec] = chip.ref;
      return (spec ?? "pages:1")
        .replace("pages:", "")
        .split(",")
        .map((page) => ({ source: source!, page: Number(page), text: `Text of page ${page} of ${source}. The Transformer relies entirely on attention.` }));
    }),
}));

const BIB = `@inproceedings{vaswani2017attention,
  author = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki},
  title = {Attention is all you need},
  booktitle = {NeurIPS},
  year = {2017},
  file = {sources/attention.pdf},
}
@inproceedings{devlin2019bert,
  author = {Devlin, Jacob and Chang, Ming-Wei},
  title = {BERT},
  booktitle = {NAACL},
  year = {2019},
  file = {sources/bert.pdf},
}
@article{brown2020gpt,
  author = {Brown, Tom},
  title = {Language models are few-shot learners},
  journal = {NeurIPS},
  year = {2020},
  abstract = {GPT-3 is a large language model.},
}
`;

const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.4 ${text}`);
const TEXTS: Record<string, [number, string][]> = {
  "sources/attention.pdf": [
    [3, "The Transformer relies entirely on attention."],
    [7, "Multi-head attention | runs in parallel."],
  ],
  "sources/bert.pdf": [
    [2, "BERT is bidirectional."],
    [5, "Masked words are predicted."],
  ],
};

let vault: MemoryVault;
let chat: Scripted;
const toast = vi.fn();
const ids = new Map<string, string>();

async function setup() {
  vault = new MemoryVault({ [MANAGED_BIB]: BIB, "library/a.md": "---\nid: 01A\ntitle: Alpha\n---\nBody.\n" });
  await vault.importSource("attention.pdf", pdf("one"));
  await vault.importSource("bert.pdf", pdf("two"));
  for (const [source, list] of Object.entries(TEXTS)) {
    for (const [page, text] of list) {
      const made = await vault.addHighlight(source, { page, rects: [[0, 0, 10, 10]], text, color: "yellow" });
      ids.set(text, made.id);
    }
  }
  useWorkspace.setState({ client: vault, notes: await vault.list(), toast });
  useSources.setState({ list: null, highlights: {} });
  chat = scriptedChat([CLAUDE]);
  resetChat(chat);
}

beforeEach(() => {
  toast.mockClear();
  ids.clear();
  useCompareDialog.getState().close();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const dialog = () => screen.findByRole("dialog", { name: "Compare papers" });
const made = async (title: string) => {
  const note = (await vault.list()).find((n) => n.title === title);
  if (!note) throw new Error(`no page called ${title}`);
  return (await vault.read(note.path)).text;
};

describe("comparing three papers without AI", () => {
  it("lists the references with their PDFs and the PDFs with none, those asked for ticked", async () => {
    await setup();
    render(<CompareHost />);
    openCompare({ keys: ["vaswani2017attention", "devlin2019bert"] });
    const d = within(await dialog());
    const list = within(await d.findByRole("list", { name: "Papers" }));
    const boxes = list.getAllByRole("checkbox").filter((box) => !box.getAttribute("aria-label"));
    expect(boxes.map((b) => (b as HTMLInputElement).checked)).toEqual([true, true, false]);
    expect(list.getByText("[@vaswani2017attention] · 2 highlights")).toBeTruthy();
    expect(list.getByText("[@brown2020gpt] · No PDF")).toBeTruthy();
  });

  it("makes a comparison page with a row for each paper, the usual columns and the evidence linked back", async () => {
    await setup();
    render(<CompareHost />);
    openCompare({ keys: ["vaswani2017attention", "devlin2019bert", "brown2020gpt"] });
    const d = within(await dialog());
    await d.findByRole("list", { name: "Papers" });
    fireEvent.click(d.getByRole("button", { name: "Create comparison page" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/^Made “Comparison:/)));
    const text = await made("Comparison: Vaswani et al., 2017; Devlin and Chang, 2019; Brown, 2020");
    const rows = text.split("\n").filter((l) => l.startsWith("|"));
    expect(rows[0]).toBe("| Paper | Question | Method | Evidence | Limitations | Relevance |");
    expect(rows[2]).toContain("[@vaswani2017attention] Attention is all you need");
    expect(rows[3]).toContain("[@devlin2019bert] BERT");
    expect(rows[4]).toContain("[@brown2020gpt] Language models are few-shot learners");
    // Each highlight is in its paper's Evidence cell, with the way back to it.
    for (const [text_, row] of [["The Transformer relies entirely on attention.", 2], ["Multi-head attention \\| runs in parallel.", 2], ["BERT is bidirectional.", 3], ["Masked words are predicted.", 3]] as const) {
      expect(rows[row]).toContain(text_);
    }
    for (const [quote, id] of ids) {
      const source = quote.startsWith("BERT") || quote.startsWith("Masked") ? "sources/bert.pdf" : "sources/attention.pdf";
      expect(text).toContain(`kasten:pdf/${source}?page=`);
      expect(text).toContain(`highlight=${id})`);
    }
    // The first PDF opens beside the page.
    expect(useWorkspace.getState().layout.panes.length).toBeGreaterThan(1);
  });

  it("makes an outline of the evidence chosen, every quotation with its citation and its link back, and leaves out what was unticked", async () => {
    await setup();
    render(<CompareHost />);
    openCompare({ keys: ["vaswani2017attention", "devlin2019bert"] });
    const d = within(await dialog());
    await d.findByRole("list", { name: "Papers" });
    fireEvent.click(d.getAllByRole("button", { name: /^Evidence: 2 of 2 highlights$/ })[0]!);
    fireEvent.click(d.getByRole("checkbox", { name: /Use the highlight on page 7/ }));
    fireEvent.click(d.getByRole("button", { name: "Create outline" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/^Made “Outline:/)));
    const text = await made("Outline: Vaswani et al., 2017; Devlin and Chang, 2019");
    expect(text).toContain("## Vaswani et al., 2017: Attention is all you need");
    expect(text).toContain("> The Transformer relies entirely on attention.");
    expect(text).toContain("[@vaswani2017attention, p. 3]");
    expect(text).not.toContain("Multi-head attention");
    expect(text).toContain("## Devlin and Chang, 2019: BERT");
    expect(text).toContain("> Masked words are predicted.");
    expect(text).toContain(`kasten:pdf/sources/bert.pdf?page=5&highlight=${ids.get("Masked words are predicted.")})`);
    // Every quotation links back to a highlight.
    const quotes = text.split("\n").filter((l) => l.startsWith("> [@"));
    expect(quotes).toHaveLength(3);
    for (const line of quotes) expect(line).toMatch(/\]\(kasten:pdf\/sources\/[a-z]+\.pdf\?page=\d+&highlight=[^)]+\)$/);
  });

  it("does not make a page until a paper is ticked", async () => {
    await setup();
    render(<CompareHost />);
    openCompare();
    const d = within(await dialog());
    await d.findByRole("list", { name: "Papers" });
    expect((d.getByRole("button", { name: "Create comparison page" }) as HTMLButtonElement).disabled).toBe(true);
    expect((d.getByRole("button", { name: "Create outline" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("the optional AI help", () => {
  async function open() {
    await setup();
    chat.answer = ["| Paper | Method |", "> The Transformer relies entirely on attention.", "> It invented the telephone.", "Attention replaced recurrence [@vaswani2017attention] and [@nobody1999]."].join("\n");
    render(<CompareHost />);
    openCompare({ keys: ["vaswani2017attention", "brown2020gpt"] });
    const d = within(await dialog());
    await d.findByRole("list", { name: "Papers" });
    fireEvent.click(d.getByRole("button", { name: "Get a first draft from AI (optional)" }));
    return d;
  }

  it("shows the passages that would be sent, and nothing is asked until the person asks", async () => {
    const d = await open();
    expect(chat.writes).toEqual([]);
    fireEvent.click(d.getByRole("button", { name: "Show what would be sent" }));
    const list = within(await d.findByRole("list", { name: "Passages that would be sent" }));
    // The PDF's chosen pages, and the abstract of a reference that has no PDF.
    expect(list.getByText("page 3")).toBeTruthy();
    expect(list.getByText("page 7")).toBeTruthy();
    expect(list.getByText("abstract")).toBeTruthy();
    expect(chat.writes).toEqual([]);
    expect(d.getByText(/3 of 3 passages, \d+ of 24000 characters/)).toBeTruthy();
  });

  it("sends exactly the passages shown, minus any left out, and tells what came back apart", async () => {
    const d = await open();
    fireEvent.click(d.getByRole("button", { name: "Show what would be sent" }));
    const list = within(await d.findByRole("list", { name: "Passages that would be sent" }));
    fireEvent.click(list.getAllByRole("checkbox")[1]!);
    fireEvent.click(d.getByRole("button", { name: "Ask AI for a draft" }));
    await waitFor(() => expect(chat.writes).toHaveLength(1));
    const request = chat.writes[0]!;
    expect(request.action).toBe("ask");
    expect(request.selection).toContain("[@vaswani2017attention] Attention is all you need, page 3:");
    expect(request.selection).not.toContain("page 7");
    expect(request.selection).toContain("[@brown2020gpt] Language models are few-shot learners, abstract from your reference:");
    expect(request.instruction).toContain("vaswani2017attention, brown2020gpt");
    // The answer: quotations apart from the AI's own words, and what does not check out said.
    const answer = within(await d.findByLabelText("The AI's answer"));
    expect(answer.getByText("Quoted from the source")).toBeTruthy();
    // The table row before the quotations and the sentence after them are the AI's own words.
    expect(answer.getAllByText("Written by AI, to check")).toHaveLength(2);
    expect(answer.getByText("Not found in the passages sent")).toBeTruthy();
    expect(answer.getByText("“nobody1999” is not in your references")).toBeTruthy();
    expect(d.getByText(/check that the cited passage supports each claim/i)).toBeTruthy();
  });

  it("puts the draft under the table, marked to check, only when asked", async () => {
    const d = await open();
    fireEvent.click(d.getByRole("button", { name: "Show what would be sent" }));
    await d.findByRole("list", { name: "Passages that would be sent" });
    fireEvent.click(d.getByRole("button", { name: "Ask AI for a draft" }));
    fireEvent.click(await d.findByRole("button", { name: "Leave it out" }));
    fireEvent.click(d.getByRole("button", { name: "Create comparison page" }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(await made("Comparison: Vaswani et al., 2017; Brown, 2020")).not.toContain("Draft by AI");
  });

  it("keeps the draft in the page, under a heading that says to check it, when the person puts it there", async () => {
    const d = await open();
    fireEvent.click(d.getByRole("button", { name: "Show what would be sent" }));
    await d.findByRole("list", { name: "Passages that would be sent" });
    fireEvent.click(d.getByRole("button", { name: "Ask AI for a draft" }));
    fireEvent.click(await d.findByRole("button", { name: "Put the draft under the table" }));
    fireEvent.click(d.getByRole("button", { name: "Create comparison page" }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    const text = await made("Comparison: Vaswani et al., 2017; Brown, 2020");
    expect(text).toContain("## Draft by AI: check every claim against the source");
    expect(text).toContain("> The Transformer relies entirely on attention.");
  });

  it("sends nothing when a provider is missing, and says how to set one up", async () => {
    await setup();
    resetChat(scriptedChat([]));
    render(<CompareHost />);
    openCompare({ keys: ["vaswani2017attention"] });
    const d = within(await dialog());
    await d.findByRole("list", { name: "Papers" });
    fireEvent.click(d.getByRole("button", { name: "Get a first draft from AI (optional)" }));
    fireEvent.click(d.getByRole("button", { name: "Show what would be sent" }));
    await d.findByRole("list", { name: "Passages that would be sent" });
    fireEvent.click(d.getByRole("button", { name: "Ask AI for a draft" }));
    expect(await d.findByRole("button", { name: "Set up AI" })).toBeTruthy();
  });
});

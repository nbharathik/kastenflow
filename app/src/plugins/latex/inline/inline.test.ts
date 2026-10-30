// Ctrl/Cmd+K in the LaTeX editor: the presets, the diff an answer leaves in the
// text (Keep and Undo), and the panel that asks.

import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bindAssist } from "../completion/binding";
import { ask } from "./ask";
import { openInline, inlineAi } from "./panel";
import { cleanLatex, paragraphAround, PRESETS } from "./presets";
import { applyAnswer, keep, reviewOf, undo } from "./review";

vi.mock("./ask", () => ({ ask: vi.fn() }));
vi.mock("../../../features/chat/run-action", () => ({ runInChat: vi.fn(() => Promise.resolve(true)) }));

const PATH = "projects/p/latex/paper/main.tex";
const TEXT = "\\section{A}\nFirst paragraph here.\nStill the first.\n\nSecond paragraph.\n";

let view: EditorView;
let release: () => void;

function mount(range: [number, number]): EditorView {
  document.body.innerHTML = '<div id="host"></div>';
  view = new EditorView({
    state: EditorState.create({ doc: TEXT, selection: EditorSelection.single(range[0], range[1]), extensions: [inlineAi] }),
    parent: document.getElementById("host")!,
  });
  return view;
}

/** The model answers `text`. */
function answers(text: string, stopped = false) {
  vi.mocked(ask).mockResolvedValue({ stop: () => {}, done: Promise.resolve({ text, stopped, note: null }) });
}

const panel = () => view.dom.querySelector<HTMLElement>(".cm-ai-panel");
const button = (name: string) => [...view.dom.querySelectorAll<HTMLButtonElement>(".cm-ai-panel button")].find((b) => b.textContent === name)!;

beforeEach(() => {
  release = bindAssist({ index: {} as never, folder: "projects/p/latex/paper", main: "main.tex", currentFile: () => PATH, syncToPdf: () => {} });
});
afterEach(() => {
  release();
  view?.destroy();
  document.body.innerHTML = "";
  vi.mocked(ask).mockReset();
});

describe("the presets", () => {
  it("are the six the editor offers, each with its words", () => {
    expect(PRESETS.map((p) => p.label)).toEqual(["Equation from words", "Table from CSV or a page table", "Figure from a diagram", "Turn into align", "Tighten paragraph", "Explain this"]);
    const equation = PRESETS[0]!.words("the Gaussian density");
    expect(equation).toContain("the Gaussian density");
    expect(PRESETS[3]!.words("")).toContain("align environment");
    expect(PRESETS[3]!.words("keep the labels")).toContain("keep the labels");
  });

  it("find the paragraph around the caret, and nothing on a blank line", () => {
    expect(paragraphAround(TEXT, 20)).toEqual({ from: 0, to: TEXT.indexOf("\n\n") });
    expect(paragraphAround(TEXT, 3)).toEqual({ from: 0, to: TEXT.indexOf("\n\n") });
    expect(paragraphAround(TEXT, TEXT.indexOf("\n\n") + 1)).toEqual({ from: TEXT.indexOf("\n\n") + 1, to: TEXT.indexOf("\n\n") + 1 });
    expect(TEXT.slice(paragraphAround(TEXT, TEXT.length - 3).from)).toBe("Second paragraph.\n");
  });

  it("take a code fence off an answer", () => {
    expect(cleanLatex("```latex\n\\begin{align}\na&=b\n\\end{align}\n```")).toBe("\\begin{align}\na&=b\n\\end{align}");
    expect(cleanLatex("  plain \\LaTeX  \n")).toBe("plain \\LaTeX");
  });
});

describe("the diff an answer leaves", () => {
  const open = () => mount([12, 34]);

  it("puts the answer in place at once and marks it for review", () => {
    open();
    applyAnswer(view, 12, 34, "Tighter.");
    expect(view.state.doc.toString()).toBe(TEXT.slice(0, 12) + "Tighter." + TEXT.slice(34));
    expect(reviewOf(view.state)).toEqual({ from: 12, to: 20, before: TEXT.slice(12, 34) });
    expect(view.dom.querySelector(".cm-ai-added")?.textContent).toBe("Tighter.");
    expect(view.dom.querySelector(".cm-ai-removed")?.textContent).toBe(TEXT.slice(12, 34));
  });

  it("keeps it: the marks go and the text stays", () => {
    open();
    applyAnswer(view, 12, 34, "Tighter.");
    expect(keep(view)).toBe(true);
    expect(reviewOf(view.state)).toBeNull();
    expect(view.dom.querySelector(".cm-ai-added")).toBeNull();
    expect(view.state.doc.toString()).toContain("Tighter.");
    expect(keep(view)).toBe(false);
  });

  it("undoes it: the old text is back, even after edits elsewhere moved it", () => {
    open();
    applyAnswer(view, 12, 34, "Tighter.");
    view.dispatch({ changes: { from: 0, insert: "% a note\n" } });
    expect(reviewOf(view.state)).toMatchObject({ from: 21, to: 29 });
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("% a note\n" + TEXT);
    expect(reviewOf(view.state)).toBeNull();
  });

  it("is an insertion when nothing was selected: nothing red, and undo takes it out", () => {
    mount([11, 11]);
    applyAnswer(view, 11, 11, "\n% new");
    expect(view.dom.querySelector(".cm-ai-removed")).toBeNull();
    undo(view);
    expect(view.state.doc.toString()).toBe(TEXT);
  });
});

describe("the panel", () => {
  it("opens at the cursor with the presets, and not without an open file", () => {
    mount([0, 0]);
    release();
    release = bindAssist({ index: {} as never, folder: "f", main: "main.tex", currentFile: () => null, syncToPdf: () => {} });
    expect(openInline(view)).toBe(false);
    release();
    release = bindAssist({ index: {} as never, folder: "f", main: "main.tex", currentFile: () => PATH, syncToPdf: () => {} });
    expect(openInline(view)).toBe(true);
    expect(panel()?.getAttribute("role")).toBe("dialog");
    expect([...view.dom.querySelectorAll(".cm-ai-preset")].map((b) => b.textContent)).toHaveLength(6);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Ask for some LaTeX");
  });

  it("runs a preset on the selection, shows the diff, and Undo puts the old text back", async () => {
    mount([12, 34]);
    answers("```latex\nTighter.\n```");
    openInline(view);
    button("Tighten paragraph").click();
    await vi.waitFor(() => expect(reviewOf(view.state)).not.toBeNull());
    const given = vi.mocked(ask).mock.calls[0]![0];
    expect(given).toMatchObject({ action: "latex-inline", path: PATH, selection: TEXT.slice(12, 34) });
    expect(given.words).toContain("Tighten the selected paragraph");
    expect(view.state.doc.toString()).toContain("Tighter.");
    expect(panel()?.textContent).toContain("It may be wrong");
    button("Undo").click();
    expect(view.state.doc.toString()).toBe(TEXT);
    expect(panel()).toBeNull();
  });

  it("takes free text, puts the answer at the cursor, and Keep leaves it", async () => {
    mount([11, 11]);
    answers("\\emph{new}");
    openInline(view);
    const input = view.dom.querySelector<HTMLInputElement>(".cm-ai-input")!;
    input.value = "emphasise something";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => expect(reviewOf(view.state)).not.toBeNull());
    expect(vi.mocked(ask).mock.calls[0]![0]).toMatchObject({ words: "emphasise something", selection: "" });
    button("Keep").click();
    expect(view.state.doc.toString()).toContain("\\emph{new}");
    expect(reviewOf(view.state)).toBeNull();
  });

  it("asks for the words an equation needs, then runs; and says to select text first for a table", async () => {
    mount([0, 0]);
    answers("\\begin{equation}x\\end{equation}");
    openInline(view);
    button("Table from CSV or a page table").click();
    expect(view.dom.querySelector(".cm-ai-status")?.textContent).toContain("Select the text first");
    expect(ask).not.toHaveBeenCalled();
    button("Equation from words").click();
    expect(ask).not.toHaveBeenCalled();
    expect(view.dom.querySelector(".cm-ai-status")?.textContent).toContain("Describe the equation");
    const input = view.dom.querySelector<HTMLInputElement>(".cm-ai-input")!;
    input.value = "the mean of x";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => expect(ask).toHaveBeenCalled());
    expect(vi.mocked(ask).mock.calls[0]![0].words).toContain("the mean of x");
  });

  it("explains without changing the text", async () => {
    mount([12, 34]);
    answers("It sets the heading.");
    openInline(view);
    button("Explain this").click();
    await vi.waitFor(() => expect(panel()?.textContent).toContain("It sets the heading."));
    expect(vi.mocked(ask).mock.calls[0]![0].action).toBe("explain");
    expect(view.state.doc.toString()).toBe(TEXT);
    expect(reviewOf(view.state)).toBeNull();
  });

  it("says why when there is no provider, and Esc closes the panel and undoes an answer not kept", async () => {
    mount([12, 34]);
    vi.mocked(ask).mockRejectedValue(new Error("Add an AI provider in Settings to write with AI."));
    openInline(view);
    button("Turn into align").click();
    await vi.waitFor(() => expect(view.dom.querySelector(".cm-ai-status")?.textContent).toContain("Add an AI provider"));
    expect(view.state.doc.toString()).toBe(TEXT);
    view.destroy();
    mount([12, 34]);
    answers("Tighter.");
    openInline(view);
    button("Tighten paragraph").click();
    await vi.waitFor(() => expect(reviewOf(view.state)).not.toBeNull());
    panel()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(view.state.doc.toString()).toBe(TEXT);
    expect(panel()).toBeNull();
  });
});

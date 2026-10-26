import { completionStatus, currentCompletions, startCompletion } from "@codemirror/autocomplete";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";

import { installAssist } from "./assist";
import { bindAssist } from "./completion/binding";
import { AssistIndex } from "./completion/data";
import { Editor, type EditorHandle } from "./editor/Editor";
import type { EditorHooks } from "./editor/setup";

installAssist();
installAssist();

const FOLDER = "projects/p/latex/paper";
const hooks = (): EditorHooks => ({ change: vi.fn(), build: vi.fn(), save: vi.fn() });

let unbind: (() => void) | null = null;
function bind(syncToPdf = vi.fn()): { syncToPdf: ReturnType<typeof vi.fn>; index: AssistIndex } {
  const index = new AssistIndex({ folder: FOLDER, files: () => [], read: () => Promise.resolve(""), vaultCites: () => Promise.resolve([]) }, 10);
  unbind = bindAssist({ index, folder: FOLDER, main: "main.tex", currentFile: () => `${FOLDER}/main.tex`, syncToPdf });
  return { syncToPdf, index };
}

function mount(initial: string, h = hooks()) {
  const ref = createRef<EditorHandle>();
  const view = render(<Editor ref={ref} fileKey="main.tex" initial={initial} hooks={h} label="Source of main.tex" />);
  return { ...view, ref, cm: () => ref.current!.view()! };
}

afterEach(() => {
  cleanup();
  unbind?.();
  unbind = null;
});

describe("the editor with the editing aids", () => {
  it("offers commands while typing, and Tab fills in the places of the one chosen", async () => {
    bind();
    const t = mount("");
    const cm = t.cm();
    cm.focus();
    cm.dispatch({ changes: { from: 0, insert: "\\textb" }, selection: { anchor: 6 }, userEvent: "input.type" });
    startCompletion(cm);
    await waitFor(() => expect(completionStatus(cm.state)).toBe("active"));
    const choice = currentCompletions(cm.state).find((c) => c.label === "\\textbf")!;
    expect(choice).toBeDefined();
    // (The popup ignores Enter for 75 ms after it opens; the choice is applied as Enter would.)
    (choice.apply as (v: EditorView, c: typeof choice, from: number, to: number) => void)(cm, choice, 0, 6);
    expect(cm.state.doc.toString()).toBe("\\textbf{text}");
    const sel = cm.state.selection.main;
    expect(cm.state.doc.sliceString(sel.from, sel.to)).toBe("text");
  });

  it("completes a label from the document while typing \\ref{", async () => {
    const { index } = bind();
    index.setText(`${FOLDER}/main.tex`, "\\section{A}\\label{sec:a}", true);
    const t = mount("\\ref{");
    const cm = t.cm();
    cm.focus();
    cm.dispatch({ selection: { anchor: 5 } });
    startCompletion(cm);
    await waitFor(() => expect(completionStatus(cm.state)).toBe("active"));
    expect(currentCompletions(cm.state).map((c) => c.label)).toEqual(["sec:a"]);
  });

  it("Ctrl+click on a line puts the caret there and shows the line in the PDF", () => {
    const { syncToPdf } = bind();
    const t = mount("one\ntwo\nthree");
    const cm = t.cm();
    vi.spyOn(cm, "posAtCoords").mockReturnValue(5);
    fireEvent.mouseDown(cm.contentDOM, { button: 0, ctrlKey: true });
    expect(syncToPdf).toHaveBeenCalledWith(`${FOLDER}/main.tex`, 2);
    expect(cm.state.selection.main.head).toBe(5);
  });

  it("a plain click, a click with Shift, and a click with nothing bound do not sync", () => {
    const { syncToPdf } = bind();
    const t = mount("one\ntwo");
    const cm = t.cm();
    vi.spyOn(cm, "posAtCoords").mockReturnValue(1);
    fireEvent.mouseDown(cm.contentDOM, { button: 0 });
    fireEvent.mouseDown(cm.contentDOM, { button: 0, ctrlKey: true, shiftKey: true });
    expect(syncToPdf).not.toHaveBeenCalled();
    unbind?.();
    unbind = null;
    fireEvent.mouseDown(cm.contentDOM, { button: 0, ctrlKey: true });
    expect(syncToPdf).not.toHaveBeenCalled();
  });

  it("Ctrl+Alt+J shows the caret's line in the PDF", () => {
    const { syncToPdf } = bind();
    const t = mount("one\ntwo\nthree");
    const cm = t.cm();
    cm.dispatch({ selection: { anchor: 9 } });
    fireEvent.keyDown(cm.contentDOM, { key: "j", ctrlKey: true, altKey: true, keyCode: 74 });
    expect(syncToPdf).toHaveBeenCalledWith(`${FOLDER}/main.tex`, 3);
  });

  it("keeps a keystroke cheap in a 30-page source with completion on", () => {
    // jsdom has no layout, so the milliseconds are indicative only; the 16 ms budget is judged in a real window.
    // This guards against a cost that grows with the text: the aids do their scans after typing stops.
    const { index } = bind();
    const line = "\\item Lorem ipsum dolor sit amet, \\emph{consectetur} adipiscing \\ref{sec:x} elit, $a_1 + b^2$. \\label{l";
    const big = `\\documentclass{article}\n\\begin{document}\n${Array.from({ length: 1800 }, (_, i) => `${line}${i}}`).join("\n")}\n\\end{document}\n`;
    const h = hooks();
    h.change = (text) => index.setText(`${FOLDER}/main.tex`, text);
    const t = mount(big, h);
    const full = t.cm();
    const bare = new EditorView({ parent: document.body.appendChild(document.createElement("div")), doc: big });
    const at = Math.floor(big.length / 2);
    const withAids: number[] = [];
    const without: number[] = [];
    for (let i = 0; i < 100; i++) {
      for (const [view, into] of [[full, withAids] as const, [bare, without] as const]) {
        const start = performance.now();
        view.dispatch({ changes: { from: at + i, insert: "x" }, userEvent: "input.type" });
        into.push(performance.now() - start);
      }
    }
    const median = (list: number[]) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)]!;
    console.info(`latex editor with aids, ${(big.length / 1024).toFixed(0)} KB: ${median(withAids).toFixed(2)} ms per keystroke (bare ${median(without).toFixed(2)} ms)`);
    bare.destroy();
    expect(median(withAids) - median(without)).toBeLessThan(40);
    index.dispose();
  });
});

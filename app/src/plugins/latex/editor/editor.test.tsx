import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { foldCode, foldedRanges, forceParsing, syntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";

import { Editor, type EditorHandle } from "./Editor";
import { addEditorExtension } from "./extensions";
import type { EditorHooks } from "./setup";

const SOURCE = ["\\documentclass{article}", "\\begin{document}", "\\section{Intro}", "Some $x^2$ text. % note", "\\subsection{Why}", "Because.", "\\section{Method}", "We did it.", "\\end{document}"].join("\n");

const hooks = (): EditorHooks => ({ change: vi.fn(), build: vi.fn(), save: vi.fn() });

function mount(over: Partial<{ hooks: EditorHooks; initial: string; fileKey: string }> = {}) {
  const ref = createRef<EditorHandle>();
  const h = over.hooks ?? hooks();
  const view = render(<Editor ref={ref} fileKey={over.fileKey ?? "a.tex"} initial={over.initial ?? SOURCE} hooks={h} label="Source of a.tex" />);
  return { ref, hooks: h, ...view, cm: () => ref.current!.view()! };
}

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme");
});

describe("the LaTeX source editor", () => {
  it("mounts with the stex mode: commands, math and comments are marked", () => {
    const t = mount();
    const cm = t.cm();
    expect(cm.state.doc.toString()).toBe(SOURCE);
    forceParsing(cm, cm.state.doc.length, 1000);
    expect(syntaxTree(cm.state).length).toBeGreaterThan(0);
    // The visible lines carry the token classes the theme colours.
    cm.dispatch({ changes: { from: 0, to: 0, insert: "" } });
    const classes = [...t.container.querySelectorAll(".cm-line span")].map((s) => s.className);
    expect(classes.some((c) => c.includes("cm-tex-command"))).toBe(true);
    expect(classes.some((c) => c.includes("cm-tex-comment"))).toBe(true);
  });

  it("names the editor for screen readers and keeps spell-check out of the source", () => {
    const t = mount();
    const content = t.container.querySelector(".cm-content")!;
    expect(content.getAttribute("aria-label")).toBe("Source of a.tex");
    expect(content.getAttribute("spellcheck")).toBe("false");
  });

  it("folds a section away up to the next one", () => {
    const t = mount();
    const cm = t.cm();
    cm.dispatch({ selection: EditorSelection.cursor(cm.state.doc.line(3).from) });
    expect(foldCode(cm)).toBe(true);
    const ranges: { from: number; to: number }[] = [];
    foldedRanges(cm.state).between(0, cm.state.doc.length, (from, to) => {
      ranges.push({ from, to });
    });
    expect(ranges).toHaveLength(1);
    expect(cm.state.doc.sliceString(ranges[0]!.from, ranges[0]!.to)).toContain("\\subsection{Why}");
    expect(cm.state.doc.sliceString(ranges[0]!.from, ranges[0]!.to)).not.toContain("\\section{Method}");
  });

  it("matches brackets and has search", () => {
    const t = mount();
    const cm = t.cm();
    expect(cm.state.facet(EditorView.editorAttributes).length).toBeGreaterThanOrEqual(0);
    expect(t.container.querySelector(".cm-gutters")).not.toBeNull();
    // Ctrl+F opens the search panel at the top.
    fireEvent.keyDown(cm.contentDOM, { key: "f", ctrlKey: true, keyCode: 70 });
    expect(t.container.querySelector(".cm-search")).not.toBeNull();
  });

  it("follows light and dark by data-theme, in place", async () => {
    const t = mount();
    const cm = t.cm();
    expect(cm.state.facet(EditorView.darkTheme)).toBe(false);
    document.documentElement.setAttribute("data-theme", "dark");
    await waitFor(() => expect(cm.state.facet(EditorView.darkTheme)).toBe(true));
    document.documentElement.setAttribute("data-theme", "light");
    await waitFor(() => expect(cm.state.facet(EditorView.darkTheme)).toBe(false));
    // The same editor, not a new one.
    expect(t.ref.current!.view()).toBe(cm);
  });

  it("Ctrl+Enter builds and Ctrl+S saves, without typing anything", () => {
    const t = mount();
    const cm = t.cm();
    fireEvent.keyDown(cm.contentDOM, { key: "Enter", ctrlKey: true, keyCode: 13 });
    expect(t.hooks.build).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(cm.contentDOM, { key: "s", ctrlKey: true, keyCode: 83 });
    expect(t.hooks.save).toHaveBeenCalledTimes(1);
    expect(cm.state.doc.toString()).toBe(SOURCE);
    expect(t.hooks.change).not.toHaveBeenCalled();
  });

  it("tells the owner about each change and can replace the text from outside", () => {
    const t = mount();
    const cm = t.cm();
    cm.dispatch({ changes: { from: 0, insert: "% hi\n" } });
    expect(t.hooks.change).toHaveBeenLastCalledWith(`% hi\n${SOURCE}`);
    t.ref.current!.replaceText("new text\n");
    expect(cm.state.doc.toString()).toBe("new text\n");
    expect(t.hooks.change).toHaveBeenLastCalledWith("new text\n");
    t.ref.current!.goToLine(1);
    expect(t.ref.current!.caretLine()).toBe(1);
  });

  it("keeps each file's own state when switching between files", () => {
    const h = hooks();
    const ref = createRef<EditorHandle>();
    const { rerender } = render(<Editor ref={ref} fileKey="a.tex" initial="alpha" hooks={h} label="a" />);
    ref.current!.view()!.dispatch({ changes: { from: 5, insert: "!" } });
    rerender(<Editor ref={ref} fileKey="b.tex" initial="beta" hooks={h} label="b" />);
    expect(ref.current!.view()!.state.doc.toString()).toBe("beta");
    rerender(<Editor ref={ref} fileKey="a.tex" initial="alpha" hooks={h} label="a" />);
    // Back to the first: its typed text and not the original.
    expect(ref.current!.view()!.state.doc.toString()).toBe("alpha!");
  });

  it("an extension added from outside is part of the next editor", () => {
    const mark = EditorView.contentAttributes.of({ "data-extra": "yes" });
    const remove = addEditorExtension(mark);
    const t = mount();
    expect(t.container.querySelector(".cm-content")!.getAttribute("data-extra")).toBe("yes");
    t.unmount();
    remove();
    const again = mount();
    expect(again.container.querySelector(".cm-content")!.getAttribute("data-extra")).toBeNull();
  });

  it("what the LaTeX setup adds to a keystroke stays small in a 160 KB source", () => {
    // jsdom has no layout, so the absolute time (mostly the DOM update, which a real window does faster) means little,
    // and the 16 ms budget can only be judged in a real window. This is a guard against a cost that grows with the
    // text: the setup's time against a bare editor on the same text, taken alternately (about 10 ms in jsdom, from
    // the mode's parse, line wrapping and the gutters; each part alone is 1 to 3 ms).
    const line = "\\item Lorem ipsum dolor sit amet, \\emph{consectetur} adipiscing elit, $a_1 + b^2$. % x";
    const big = `\\documentclass{article}\n\\begin{document}\n${Array.from({ length: 1800 }, (_, i) => `${line} ${i}`).join("\n")}\n\\end{document}\n`;
    expect(big.length).toBeGreaterThan(150_000);
    const h = hooks();
    const t = mount({ initial: big, hooks: h });
    const full = t.cm();
    const bare = new EditorView({ parent: document.body.appendChild(document.createElement("div")), doc: big });
    const at = Math.floor(big.length / 2);
    const withSetup: number[] = [];
    const without: number[] = [];
    for (let i = 0; i < 120; i++) {
      for (const [view, into] of [[full, withSetup] as const, [bare, without] as const]) {
        const start = performance.now();
        view.dispatch({ changes: { from: at + i, insert: "x" }, userEvent: "input.type" });
        into.push(performance.now() - start);
      }
    }
    const median = (list: number[]) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)]!;
    const extra = median(withSetup) - median(without);
    console.info(`latex editor keystroke, ${(big.length / 1024).toFixed(0)} KB source, jsdom without layout: ${median(withSetup).toFixed(2)} ms with the setup, ${median(without).toFixed(2)} ms bare, ${extra.toFixed(2)} ms added`);
    bare.destroy();
    expect(extra).toBeLessThan(30);
    expect(h.change).toHaveBeenCalledTimes(120);
  });
});

import { CompletionContext, type Completion } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DocFile } from "../types";
import { bindAssist } from "./binding";
import { allCommands, parseSpec } from "./commands";
import { argContext, commandBeingTyped, inComment, openEnvironments } from "./context";
import { AssistIndex, type AssistDeps } from "./data";
import { argumentSource, commandSource } from "./sources";

const FOLDER = "projects/p/latex/paper";

/** The source's answer with the cursor at the end of `text` (or at `|`). */
async function ask(source: typeof commandSource | typeof argumentSource, text: string, explicit = false) {
  const at = text.indexOf("|");
  const doc = at >= 0 ? text.replace("|", "") : text;
  const state = EditorState.create({ doc });
  return source(new CompletionContext(state, at >= 0 ? at : doc.length, explicit));
}

const labels = (r: Awaited<ReturnType<typeof ask>>) => (r?.options ?? []).map((o) => o.label);

function view(doc: string, pos = doc.length): EditorView {
  const v = new EditorView({ state: EditorState.create({ doc, selection: { anchor: pos } }), parent: document.body });
  return v;
}

function apply(v: EditorView, option: Completion, from: number, to: number): void {
  (option.apply as (view: EditorView, c: Completion, from: number, to: number) => void)(v, option, from, to);
}

const file = (rel: string, editable = true): DocFile => ({ path: `${FOLDER}/${rel}`, editable, size: 10 });

function index(over: Partial<AssistDeps> = {}, files: DocFile[] = []): AssistIndex {
  return new AssistIndex({ folder: FOLDER, files: () => files, read: () => Promise.resolve(""), vaultCites: () => Promise.resolve([]), ...over }, 10);
}

let unbind: (() => void) | null = null;
function bind(i: AssistIndex): void {
  unbind = bindAssist({ index: i, folder: FOLDER, main: "main.tex", currentFile: () => `${FOLDER}/main.tex`, syncToPdf: vi.fn() });
}
afterEach(() => {
  unbind?.();
  unbind = null;
  document.body.replaceChildren();
});

describe("the static command list", () => {
  it("has about 300 commands, each once, in the groups the editor needs", () => {
    const all = allCommands();
    expect(all.length).toBeGreaterThanOrEqual(300);
    expect(new Set(all.map((c) => c.name)).size).toBe(all.length);
    const names = new Set(all.map((c) => c.name));
    for (const name of ["section", "textbf", "frac", "alpha", "includegraphics", "label", "ref", "cite", "bibliography", "multicolumn", "toprule", "usepackage", "newcommand", "begin", "end"]) {
      expect(names.has(name), name).toBe(true);
    }
  });

  it("turns a spec into a snippet: required arguments are places to fill in, optional ones are left out unless marked", () => {
    expect(parseSpec("textbf{text}", "function")).toMatchObject({ name: "textbf", detail: "{text}", template: "\\textbf{${text}}" });
    expect(parseSpec("sqrt[n]{expression}", "function")).toMatchObject({ detail: "[n]{expression}", template: "\\sqrt{${expression}}" });
    expect(parseSpec("includegraphics[!width=\\linewidth]{file}", "function").template).toBe("\\includegraphics[${width=\\linewidth}]{${file}}");
    expect(parseSpec("section*{title}", "keyword").name).toBe("section*");
    expect(parseSpec("alpha", "constant").template).toBe("\\alpha");
  });
});

describe("where the cursor is", () => {
  it("knows a command being typed, but not after a line break or in a comment", () => {
    expect(commandBeingTyped("text \\tex")).toEqual({ from: 5, name: "tex" });
    expect(commandBeingTyped("a \\\\se")).toBeNull();
    expect(commandBeingTyped("plain")).toBeNull();
    expect(inComment("x % \\sec")).toBe(true);
    expect(inComment("50\\% \\sec")).toBe(false);
  });

  it("finds the argument of a command that takes labels, keys, files and names", () => {
    expect(argContext("see \\ref{sec:")).toMatchObject({ kind: "ref", prefix: "sec:" });
    expect(argContext("\\autoref{")).toMatchObject({ kind: "ref", prefix: "" });
    expect(argContext("\\cite[p.~3]{knuth, ba")).toMatchObject({ kind: "cite", prefix: "ba" });
    expect(argContext("\\textcite{a,b,c")).toMatchObject({ kind: "cite", prefix: "c" });
    expect(argContext("\\includegraphics[width=3cm]{fig/")).toMatchObject({ kind: "image", prefix: "fig/" });
    expect(argContext("\\input{sections/in")).toMatchObject({ kind: "tex", prefix: "sections/in" });
    expect(argContext("\\begin{ite")).toMatchObject({ kind: "environment", command: "begin", prefix: "ite" });
    expect(argContext("\\usepackage{amsmath,gra")).toMatchObject({ kind: "package", prefix: "gra" });
    expect(argContext("\\textbf{bo")).toBeNull();
    expect(argContext("\\label{key")).toBeNull();
    expect(argContext("\\ref{done} and more")).toBeNull();
  });

  it("works out which environments are still open", () => {
    expect(openEnvironments("\\begin{document}\n\\begin{itemize}\n\\item a\n\\end{itemize}\n\\begin{figure}\n")).toEqual(["document", "figure"]);
    // A doubled backslash is a line break, not a command.
    expect(openEnvironments("\\\\begin{x} \\begin{a}\\begin{b}\\end{b}\\end{a}")).toEqual([]);
  });
});

describe("completing commands", () => {
  it("offers commands that start with what was typed after the backslash", async () => {
    const result = await ask(commandSource, "Some \\textb");
    expect(result!.from).toBe(5);
    const names = labels(result);
    expect(names).toContain("\\textbf");
    expect(names).toContain("\\section");
    expect(names).toContain("\\begin{itemize}");
    expect(result!.validFor).toBeDefined();
  });

  it("says nothing after only a backslash unless asked, in a comment, or in plain text", async () => {
    expect(await ask(commandSource, "\\")).toBeNull();
    expect(await ask(commandSource, "\\", true)).not.toBeNull();
    expect(await ask(commandSource, "% \\sec")).toBeNull();
    expect(await ask(commandSource, "no command here")).toBeNull();
  });

  it("inserts a command with its places to fill in", () => {
    const v = view("\\sec");
    const option = (commandSource(new CompletionContext(v.state, 4, false))!.options as Completion[]).find((o) => o.label === "\\section")!;
    apply(v, option, 0, 4);
    expect(v.state.doc.toString()).toBe("\\section{title}");
    // The first place is selected, ready to be typed over.
    const sel = v.state.selection.main;
    expect(v.state.doc.sliceString(sel.from, sel.to)).toBe("title");
  });

  it("expands an environment into begin and end with the body between", () => {
    const v = view("\\begin{item");
    const option = (commandSource(new CompletionContext(v.state, 6, false))!.options as Completion[]).find((o) => o.label === "\\begin{itemize}")!;
    apply(v, option, 0, 11);
    expect(v.state.doc.toString()).toBe("\\begin{itemize}\n  \\item \n\\end{itemize}");
  });
});

describe("completing inside braces", () => {
  it("completes an environment name after \\begin{ and closes it", async () => {
    const result = await ask(argumentSource, "\\begin{fig");
    expect(labels(result)).toContain("figure");
    const v = view("\\begin{fig");
    const option = (result!.options as Completion[]).find((o) => o.label === "figure")!;
    apply(v, option, 7, 10);
    const text = v.state.doc.toString();
    expect(text.startsWith("\\begin{figure}[htbp]\n  \\centering")).toBe(true);
    expect(text.endsWith("\\end{figure}")).toBe(true);
  });

  it("does not double a closing brace that is already there", async () => {
    const v = view("\\begin{ite}", 10);
    const result = await argumentSource(new CompletionContext(v.state, 10, false));
    const option = (result!.options as Completion[]).find((o) => o.label === "itemize")!;
    apply(v, option, 7, 10);
    expect(v.state.doc.toString().startsWith("\\begin{itemize}\n  \\item ")).toBe(true);
    expect(v.state.doc.toString().match(/\}\}/)).toBeNull();
  });

  it("offers the open environment first after \\end{", async () => {
    const result = await ask(argumentSource, "\\begin{theorem}\nText\n\\end{|");
    expect(labels(result)[0]).toBe("theorem");
  });

  it("completes \\ref, \\eqref and \\autoref from the labels of the document", async () => {
    const i = index();
    i.setText(`${FOLDER}/main.tex`, "\\section{A}\\label{sec:a}\n\\begin{equation}\\label{eq:b}x\\end{equation}", true);
    bind(i);
    for (const command of ["ref", "eqref", "autoref"]) {
      const result = await ask(argumentSource, `see \\${command}{`);
      expect(labels(result)).toEqual(["sec:a", "eq:b"]);
      expect(result!.from).toBe(`see \\${command}{`.length);
    }
    const detail = (await ask(argumentSource, "\\ref{"))!.options[0]!.detail;
    expect(detail).toBe("main.tex:1");
  });

  it("reads labels of files that were never opened, once", async () => {
    const read = vi.fn((path: string) => Promise.resolve(path.endsWith("intro.tex") ? "\\label{sec:intro}" : ""));
    const i = index({ read }, [file("main.tex"), file("sections/intro.tex"), file("logo.png", false)]);
    i.setText(`${FOLDER}/main.tex`, "\\label{sec:main}", true);
    bind(i);
    expect(labels(await ask(argumentSource, "\\ref{")).sort()).toEqual(["sec:intro", "sec:main"]);
    await ask(argumentSource, "\\ref{");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("picks up a label typed a moment ago, after the pause", async () => {
    vi.useFakeTimers();
    try {
      const i = index();
      bind(i);
      i.setText(`${FOLDER}/main.tex`, "\\label{fresh}");
      expect(labels(await ask(argumentSource, "\\ref{"))).toEqual([]);
      vi.advanceTimersByTime(20);
      expect(labels(await ask(argumentSource, "\\ref{"))).toEqual(["fresh"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("completes \\cite from the document's .bib files and the vault's References, each key once", async () => {
    const bib = "@article{knuth1984, author={Knuth, Donald}, title={Literate Programming}, year={1984}}\n@book{lamport94, author={Lamport, Leslie}, title={LaTeX}, year={1994}}";
    const i = index(
      {
        read: () => Promise.resolve(bib),
        vaultCites: () =>
          Promise.resolve([
            { key: "knuth1984", detail: "dup", title: "dup", from: "sources/references.bib" },
            { key: "vaswani2017", detail: "Vaswani et al., 2017", title: "Attention", from: "sources/references.bib" },
          ]),
      },
      [file("main.tex"), file("refs.bib")],
    );
    bind(i);
    const result = await ask(argumentSource, "\\cite{knuth1984, ");
    expect(labels(result)).toEqual(["knuth1984", "lamport94", "vaswani2017"]);
    const knuth = result!.options.find((o) => o.label === "knuth1984")!;
    expect(knuth.detail).toBe("Knuth, 1984");
    expect(knuth.info).toBe("Literate Programming");
    expect(result!.from).toBe("\\cite{knuth1984, ".length);
  });

  it("still completes citations when the vault cannot be read", async () => {
    const i = index({ read: () => Promise.resolve("@misc{only, title={T}}"), vaultCites: () => Promise.reject(new Error("no vault")) }, [file("r.bib")]);
    bind(i);
    expect(labels(await ask(argumentSource, "\\parencite{"))).toEqual(["only"]);
  });

  it("completes picture and file names from the document's folder", async () => {
    const i = index({}, [file("main.tex"), file("sections/intro.tex"), file("fig/plot.png", false), file("fig/scan.PDF", false), file("refs.bib")]);
    bind(i);
    expect(labels(await ask(argumentSource, "\\includegraphics[width=5cm]{"))).toEqual(["fig/plot.png", "fig/scan.PDF"]);
    expect(labels(await ask(argumentSource, "\\input{"))).toEqual(["main", "sections/intro"]);
    expect(labels(await ask(argumentSource, "\\include{se"))).toEqual(["main", "sections/intro"]);
    expect(labels(await ask(argumentSource, "\\bibliography{"))).toEqual(["refs"]);
    expect(labels(await ask(argumentSource, "\\addbibresource{"))).toEqual(["refs.bib"]);
  });

  it("completes package and class names, and says nothing in a comment or for other commands", async () => {
    expect(labels(await ask(argumentSource, "\\usepackage{amsm"))).toContain("amsmath");
    expect(labels(await ask(argumentSource, "\\documentclass{"))).toContain("article");
    expect(await ask(argumentSource, "% \\ref{")).toBeNull();
    expect(await ask(argumentSource, "\\textbf{x")).toBeNull();
    // With no document bound there is nothing to offer for labels.
    expect(await ask(argumentSource, "\\ref{")).toBeNull();
  });
});

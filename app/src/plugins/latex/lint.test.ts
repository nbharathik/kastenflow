import { forEachDiagnostic } from "@codemirror/lint";
import { EditorState, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { bindAssist } from "./completion/binding";
import { AssistIndex } from "./completion/data";
import { useDiagnostics } from "./diagnostics";
import { buildMarks, toMarks } from "./lint";
import type { Diagnostic } from "./types";

const FOLDER = "projects/p/latex/paper";
const d = (over: Partial<Diagnostic>): Diagnostic => ({ file: "main.tex", line: 1, severity: "error", message: "Undefined control sequence.", ...over });

describe("marks from diagnostics", () => {
  const doc = Text.of(["\\documentclass{article}", "  \\begin{document}", "", "\\foo", "\\end{document}"]);

  it("puts a mark on the text of the line it names, with severity and message", () => {
    const marks = toMarks(doc, [d({ line: 4 }), d({ line: 2, severity: "warning", message: "Overfull box" }), d({ line: 1, severity: "info", message: "Note" })]);
    expect(marks.map((m) => [m.severity, m.message, doc.sliceString(m.from, m.to)])).toEqual([
      ["error", "Undefined control sequence.", "\\foo"],
      ["warning", "Overfull box", "\\begin{document}"],
      ["info", "Note", "\\documentclass{article}"],
    ]);
    expect(marks.every((m) => m.source === "LaTeX")).toBe(true);
  });

  it("moves a line past the end to the last line, skips messages with no line, and drops repeats", () => {
    const marks = toMarks(doc, [d({ line: 99 }), d({ line: null, message: "No line" }), d({ line: 4 }), d({ line: 4 })]);
    expect(marks).toHaveLength(2);
    expect(doc.lineAt(marks[0]!.from).number).toBe(5);
  });

  it("marks an empty line without failing", () => {
    const marks = toMarks(doc, [d({ line: 3 })]);
    expect(marks[0]!.from).toBe(marks[0]!.to);
  });

  it("offers Fix this one and Explain in the mark's tooltip when the chat can be asked", () => {
    const asked: [string, string][] = [];
    const problem = d({ line: 4, message: "Boom" });
    const [mark] = toMarks(doc, [problem], (kind, p) => asked.push([kind, p.message]));
    expect(mark!.actions?.map((a) => a.name)).toEqual(["Fix this one", "Explain"]);
    mark!.actions![0]!.apply(null as never, mark!.from, mark!.to);
    mark!.actions![1]!.apply(null as never, mark!.from, mark!.to);
    expect(asked).toEqual([
      ["fix", "Boom"],
      ["explain", "Boom"],
    ]);
    expect(toMarks(doc, [problem])[0]!.actions).toBeUndefined();
  });
});

describe("the gutter and marks in an editor", () => {
  let unbind: () => void;
  let index: AssistIndex;
  let current = `${FOLDER}/main.tex`;

  beforeEach(() => {
    useDiagnostics.setState({ byDoc: {} });
    index = new AssistIndex({ folder: FOLDER, files: () => [], read: () => Promise.resolve(""), vaultCites: () => Promise.resolve([]) });
    current = `${FOLDER}/main.tex`;
    unbind = bindAssist({ index, folder: FOLDER, main: "main.tex", currentFile: () => current, syncToPdf: () => {} });
  });
  afterEach(() => {
    unbind();
    index.dispose();
    document.body.replaceChildren();
  });

  const make = (doc: string): EditorView => new EditorView({ state: EditorState.create({ doc, extensions: [buildMarks] }), parent: document.body });
  const shown = (v: EditorView): string[] => {
    const out: string[] = [];
    forEachDiagnostic(v.state, (m, from) => out.push(`${m.severity}@${v.state.doc.lineAt(from).number}`));
    return out;
  };

  it("marks the lines of the last build for the open file, and the gutter shows a marker", async () => {
    const v = make("a\nb\nc\nd");
    useDiagnostics.getState().set(FOLDER, [d({ line: 2 }), d({ line: 4, severity: "warning" }), d({ file: "sections/intro.tex", line: 1 })]);
    await Promise.resolve();
    expect(shown(v)).toEqual(["error@2", "warning@4"]);
    expect(v.dom.querySelectorAll(".cm-lint-marker").length).toBe(2);
    v.destroy();
  });

  it("marks a build that already finished when the editor is made, and follows a new build", async () => {
    useDiagnostics.getState().set(FOLDER, [d({ line: 1 })]);
    const v = make("a\nb");
    await Promise.resolve();
    expect(shown(v)).toEqual(["error@1"]);
    act(() => useDiagnostics.getState().set(FOLDER, []));
    expect(shown(v)).toEqual([]);
    v.destroy();
  });

  it("keeps a mark on its line when text is added above it", async () => {
    const v = make("a\nb");
    useDiagnostics.getState().set(FOLDER, [d({ line: 2 })]);
    await Promise.resolve();
    v.dispatch({ changes: { from: 0, insert: "new\n" } });
    expect(shown(v)).toEqual(["error@3"]);
    v.destroy();
  });

  it("uses the file that is open: a message with no file belongs to the root file", async () => {
    current = `${FOLDER}/sections/intro.tex`;
    const v = make("x\ny");
    useDiagnostics.getState().set(FOLDER, [d({ file: null, line: 1 }), d({ file: "sections/intro.tex", line: 2, severity: "warning" })]);
    await Promise.resolve();
    expect(shown(v)).toEqual(["warning@2"]);
    v.destroy();
  });

  it("ignores another document's build and an editor that was taken down", async () => {
    const v = make("a");
    useDiagnostics.getState().set("projects/other", [d({ line: 1 })]);
    await Promise.resolve();
    expect(shown(v)).toEqual([]);
    v.destroy();
    expect(() => useDiagnostics.getState().set(FOLDER, [d({ line: 1 })])).not.toThrow();
  });
});

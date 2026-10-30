// The build's errors and warnings marked in the text: a mark in the gutter, a
// wavy line under the text, and the message on hover. They come from the last
// build (diagnostics.ts), for the file that is open. CodeMirror moves a mark
// along as the text above it changes, so it stays on its line until the next
// build says something new. F8 goes to the next one.

import { type Diagnostic as Mark, lintGutter, nextDiagnostic, setDiagnostics } from "@codemirror/lint";
import type { Extension, Text } from "@codemirror/state";
import { keymap, type PluginValue, ViewPlugin, type EditorView } from "@codemirror/view";

import { assist } from "./completion/binding";
import { forFile, useDiagnostics } from "./diagnostics";
import type { Diagnostic } from "./types";

/** The marks for the diagnostics that name a line of `doc`. Lines past the end go to the last line; diagnostics with no line have no mark (the list under the editor still shows them). */
export function toMarks(doc: Text, diagnostics: readonly Diagnostic[]): Mark[] {
  const marks: Mark[] = [];
  const seen = new Set<string>();
  for (const d of diagnostics) {
    if (d.line === null || d.line < 1) continue;
    const line = doc.line(Math.min(d.line, doc.lines));
    const id = `${line.number}|${d.severity}|${d.message}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const from = line.from + (line.text.length - line.text.trimStart().length);
    marks.push({ from: Math.min(from, line.to), to: line.to, severity: d.severity, message: d.message, source: "LaTeX" });
  }
  return marks;
}

const NONE: readonly Diagnostic[] = [];

class FromBuild implements PluginValue {
  private lastAll: readonly Diagnostic[] | undefined;
  private lastFile: string | null | undefined;
  private marked = 0;
  private gone = false;
  private readonly stop: () => void;

  constructor(private readonly view: EditorView) {
    this.stop = useDiagnostics.subscribe(() => this.push());
    // Not inside the update that made this plugin.
    queueMicrotask(() => this.push());
  }

  private push(): void {
    if (this.gone) return;
    const bound = assist.current;
    const file = bound?.currentFile();
    const all = bound ? (useDiagnostics.getState().byDoc[bound.folder] ?? NONE) : NONE;
    if (this.lastAll === all && this.lastFile === (file ?? null)) return;
    this.lastAll = all;
    this.lastFile = file ?? null;
    const mine = bound && file ? forFile(all, bound.index.rel(file), bound.main) : [];
    const marks = toMarks(this.view.state.doc, mine);
    if (marks.length === 0 && this.marked === 0) return;
    this.marked = marks.length;
    this.view.dispatch(setDiagnostics(this.view.state, marks));
  }

  destroy(): void {
    this.gone = true;
    this.stop();
  }
}

/** The gutter, the marks and F8. */
export const buildMarks: Extension = [lintGutter(), ViewPlugin.fromClass(FromBuild), keymap.of([{ key: "F8", run: nextDiagnostic }])];

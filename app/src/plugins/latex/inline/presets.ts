// What Ctrl/Cmd+K offers in the LaTeX editor: a few presets and free text. Each
// preset is the words sent to the "Write LaTeX in place" action (or, for an
// explanation, to the Explain action; for a figure from a diagram, a chat that
// can use the diagram tools).

export type PresetKind = "write" | "explain" | "chat";

export interface Preset {
  id: string;
  label: string;
  kind: PresetKind;
  /** The text it works on: a selection is needed, or the paragraph at the caret will do, or it needs only words. */
  works: "selection" | "paragraph" | "words";
  /** The hint in the box when the preset waits for words. */
  ask?: string;
  /** The request, given what the person typed (`words`). */
  words(words: string): string;
}

const also = (words: string) => (words.trim() ? ` ${words.trim()}` : "");

export const PRESETS: readonly Preset[] = [
  {
    id: "equation",
    label: "Equation from words",
    kind: "write",
    works: "words",
    ask: "Describe the equation…",
    words: (w) => `Write a LaTeX equation for this: ${w.trim()}. Use an equation environment, or align for several lines. Label it only if the document labels its equations.`,
  },
  {
    id: "table",
    label: "Table from CSV or a page table",
    kind: "write",
    works: "selection",
    words: (w) => `Turn the selected text (CSV, tab-separated or a Markdown table) into a LaTeX table: a table environment with a caption and a label, and a tabular that uses booktabs rules and no vertical lines. Keep every value as it is.${also(w)}`,
  },
  {
    id: "figure",
    label: "Figure from a diagram",
    kind: "chat",
    works: "words",
    ask: "Which diagram?",
    words: (w) => w.trim(),
  },
  {
    id: "align",
    label: "Turn into align",
    kind: "write",
    works: "selection",
    words: (w) => `Rewrite the selected equation as an align environment, one relation to a line, aligned on the = sign. Keep the meaning exactly.${also(w)}`,
  },
  {
    id: "tighten",
    label: "Tighten paragraph",
    kind: "write",
    works: "paragraph",
    words: (w) => `Tighten the selected paragraph: cut filler and repetition, keep the meaning, the numbers, and every command, citation and reference exactly as they are.${also(w)}`,
  },
  {
    id: "explain",
    label: "Explain this",
    kind: "explain",
    works: "paragraph",
    words: (w) => `Explain what this LaTeX does, in plain words.${also(w)}`,
  },
];

/** The slug of the action each kind runs. */
export const ACTION_FOR: Record<PresetKind, string> = { write: "latex-inline", explain: "explain", chat: "figure-from-diagram" };

/** The paragraph around `pos` in `text`: the lines up to the blank lines on either side. Empty at a blank line. */
export function paragraphAround(text: string, pos: number): { from: number; to: number } {
  const at = Math.min(Math.max(0, pos), text.length);
  const blank = /\n[ \t]*\n/g;
  let from = 0;
  let to = text.length;
  for (let m = blank.exec(text); m; m = blank.exec(text)) {
    if (m.index + m[0].length <= at) from = m.index + m[0].length;
    else {
      if (m.index >= at) {
        to = m.index;
        break;
      }
      // The caret is on the blank line itself.
      return { from: at, to: at };
    }
  }
  return { from, to };
}

/** Takes a Markdown or plain code fence off an answer that was wrapped in one. */
export function cleanLatex(answer: string): string {
  const text = answer.trim();
  const fence = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/.exec(text);
  return (fence ? fence[1]! : text).replace(/\s+$/, "");
}

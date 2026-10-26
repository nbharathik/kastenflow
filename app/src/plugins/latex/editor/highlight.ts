// Colours for LaTeX source. The `stex` mode names each token ("tag" for a
// command, "keyword" for math delimiters, "comment" …); this marks the visible
// ones with a class and the theme colours the classes from the app's colour
// tokens, so light and dark follow `data-theme` with nothing to rebuild. It
// reads the syntax tree by node name, so it needs no highlight tags of its own.

import { syntaxTree } from "@codemirror/language";
import type { Extension, Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

/** The class for each node name the `stex` mode's tokens come out with (the mode says "tag", the tree says "tagName"). */
export const TOKEN_CLASS: Record<string, string> = {
  tagName: "cm-tex-command",
  keyword: "cm-tex-math",
  comment: "cm-tex-comment",
  bracket: "cm-tex-bracket",
  atom: "cm-tex-argument",
  // A letter inside math.
  "variableName.special": "cm-tex-math",
  number: "cm-tex-number",
  string: "cm-tex-string",
  "variableName.standard": "cm-tex-builtin",
  invalid: "cm-tex-error",
};

const MARKS = Object.fromEntries(Object.entries(TOKEN_CLASS).map(([token, cls]) => [token, Decoration.mark({ class: cls })]));

function marks(view: EditorView): DecorationSet {
  const out: Range<Decoration>[] = [];
  const tree = syntaxTree(view.state);
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        const mark = MARKS[node.name];
        if (mark && node.to > node.from) out.push(mark.range(node.from, node.to));
      },
    });
  }
  return Decoration.set(out, true);
}

const marker = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = marks(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) this.decorations = marks(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const colours = EditorView.baseTheme({
  ".cm-tex-command": { color: "var(--color-accent)" },
  ".cm-tex-math": { color: "var(--color-success)" },
  ".cm-tex-comment": { color: "var(--color-faint)", fontStyle: "italic" },
  ".cm-tex-bracket": { color: "var(--color-muted)" },
  ".cm-tex-argument": { color: "var(--color-warning)" },
  ".cm-tex-number": { color: "var(--color-success)" },
  ".cm-tex-string": { color: "var(--color-success)" },
  ".cm-tex-builtin": { color: "var(--color-accent)", fontWeight: "600" },
  ".cm-tex-error": { color: "var(--color-danger)", textDecoration: "underline wavy" },
});

/** Marks the tokens and colours them. */
export const texHighlight: Extension = [marker, colours];

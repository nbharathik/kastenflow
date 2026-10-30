// Colours for the code of a smart page (HTML, CSS and JavaScript). The
// language modes name each token in the syntax tree; this marks the visible
// ones with a class by node name, and the theme colours the classes from the
// app's colour tokens, so light and dark follow `data-theme` with nothing to
// rebuild.

import { syntaxTree } from "@codemirror/language";
import type { Extension, Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

export const KEYWORDS = new Set([
  "function", "const", "let", "var", "return", "if", "else", "for", "while", "do", "new", "class", "extends", "import", "export", "from", "default", "async", "await", "try", "catch", "finally", "throw", "typeof", "instanceof", "of", "in", "switch", "case", "break", "continue", "this", "null", "true", "false", "void", "delete", "yield",
]);

/** The class for each node name the three languages' tokens come out with. */
export const TOKEN_CLASS: Record<string, string> = {
  TagName: "cm-code-tag",
  "TagName.special": "cm-code-tag",
  AttributeName: "cm-code-attr",
  AttributeValue: "cm-code-string",
  String: "cm-code-string",
  TemplateString: "cm-code-string",
  StringLiteral: "cm-code-string",
  Number: "cm-code-number",
  NumberLiteral: "cm-code-number",
  Boolean: "cm-code-keyword",
  Comment: "cm-code-comment",
  LineComment: "cm-code-comment",
  BlockComment: "cm-code-comment",
  PropertyName: "cm-code-attr",
  ClassName: "cm-code-tag",
  IdName: "cm-code-tag",
  AtKeyword: "cm-code-keyword",
  ValueName: "cm-code-value",
  ColorLiteral: "cm-code-number",
  Unit: "cm-code-number",
  VariableDefinition: "cm-code-def",
  RegExp: "cm-code-string",
  Entity: "cm-code-number",
  MismatchedCloseTag: "cm-code-error",
  "⚠": "cm-code-error",
};

const MARKS = new Map<string, Decoration>();
const markFor = (cls: string): Decoration => {
  let mark = MARKS.get(cls);
  if (!mark) MARKS.set(cls, (mark = Decoration.mark({ class: cls })));
  return mark;
};

function marks(view: EditorView): DecorationSet {
  const out: Range<Decoration>[] = [];
  const tree = syntaxTree(view.state);
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (node.to <= node.from) return;
        const cls = TOKEN_CLASS[node.name] ?? (KEYWORDS.has(node.name) ? "cm-code-keyword" : undefined);
        if (cls) out.push(markFor(cls).range(node.from, node.to));
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
  ".cm-code-tag": { color: "var(--color-accent)" },
  ".cm-code-attr": { color: "var(--color-warning)" },
  ".cm-code-string": { color: "var(--color-success)" },
  ".cm-code-number": { color: "var(--color-success)" },
  ".cm-code-keyword": { color: "var(--color-accent)", fontWeight: "600" },
  ".cm-code-value": { color: "var(--color-muted)" },
  ".cm-code-def": { color: "var(--color-ink)", fontWeight: "600" },
  ".cm-code-comment": { color: "var(--color-faint)", fontStyle: "italic" },
  ".cm-code-error": { color: "var(--color-danger)", textDecoration: "underline wavy" },
});

/** Marks the tokens and colours them. */
export const codeHighlight: Extension = [marker, colours];

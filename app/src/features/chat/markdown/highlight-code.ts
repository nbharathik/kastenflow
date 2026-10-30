// Colours for the code in an answer, from the same language modes the smart
// page editor uses (CodeMirror's parsers for JavaScript, HTML and CSS). Only
// loaded when an answer holds code (CodeBlock imports this lazily). Other
// languages stay plain. The classes are coloured in markdown.css from the
// app's tokens.

import { cssLanguage } from "@codemirror/lang-css";
import { htmlLanguage } from "@codemirror/lang-html";
import { javascriptLanguage, jsxLanguage, tsxLanguage, typescriptLanguage } from "@codemirror/lang-javascript";

import { KEYWORDS, TOKEN_CLASS } from "../../smart/author/highlight";

/** What of a Lezer parser is used here. */
interface Parser {
  parse(input: string): { iterate(spec: { enter(node: { name: string; from: number; to: number }): boolean | void }): void };
}

/** A run of code and the class that colours it, if any. */
export interface Run {
  text: string;
  cls?: string;
}

/** More than this is shown plain: colouring is for the code an answer quotes, not a file. */
const MOST = 20_000;

const LANGUAGES: Record<string, Parser> = {
  js: javascriptLanguage.parser,
  javascript: javascriptLanguage.parser,
  mjs: javascriptLanguage.parser,
  cjs: javascriptLanguage.parser,
  json: javascriptLanguage.parser,
  jsx: jsxLanguage.parser,
  ts: typescriptLanguage.parser,
  typescript: typescriptLanguage.parser,
  tsx: tsxLanguage.parser,
  html: htmlLanguage.parser,
  xml: htmlLanguage.parser,
  svg: htmlLanguage.parser,
  css: cssLanguage.parser,
};

/** Whether `lang` is one that gets colours. */
export const colours = (lang: string): boolean => lang.toLowerCase() in LANGUAGES;

/** `text` as runs of code, coloured by the syntax tree; null when the language is not known or the code is long. */
export function highlight(lang: string, text: string): Run[] | null {
  const parser = LANGUAGES[lang.toLowerCase()];
  if (!parser || text.length > MOST) return null;
  const marks: { from: number; to: number; cls: string }[] = [];
  parser.parse(text).iterate({
    enter(node) {
      if (node.to <= node.from) return;
      const cls = TOKEN_CLASS[node.name] ?? (KEYWORDS.has(node.name) ? "cm-code-keyword" : undefined);
      if (!cls) return;
      marks.push({ from: node.from, to: node.to, cls });
      // The token is coloured whole: what is inside it is not coloured again.
      return false;
    },
  });
  const runs: Run[] = [];
  let at = 0;
  for (const { from, to, cls } of marks) {
    if (from < at) continue;
    if (from > at) runs.push({ text: text.slice(at, from) });
    runs.push({ text: text.slice(from, to), cls });
    at = to;
  }
  if (at < text.length) runs.push({ text: text.slice(at) });
  return runs;
}

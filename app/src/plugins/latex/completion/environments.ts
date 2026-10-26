// The environments the editor knows: each inserts `\begin{…}` and `\end{…}` with
// the cursor between (or on the first place to fill in). Typed after a
// backslash they are offered as `\begin{name}`; typed inside `\begin{` they
// complete the name and close the environment.

export interface Environment {
  name: string;
  /** What goes between the lines `\begin` and `\end`, one line per row, `${x}` for a place to fill in. */
  body: string[];
  /** Written after `\begin{name}`, such as `[htbp]` or `{cc}`. */
  head?: string;
}

const env = (name: string, body: string[] = ["${}"], head?: string): Environment => ({ name, body, head });
const items = (word: string): string[] => [`${word} \${}`];

export const ENVIRONMENTS: readonly Environment[] = [
  env("document"),
  env("abstract"),
  env("itemize", items("\\item")),
  env("enumerate", items("\\item")),
  env("description", ["\\item[${term}] ${}"]),
  env("equation"),
  env("equation*"),
  env("align"),
  env("align*"),
  env("alignat", ["${}"], "{${2}}"),
  env("gather"),
  env("gather*"),
  env("multline"),
  env("split"),
  env("cases"),
  env("subequations"),
  env("array", ["${}"], "{${cc}}"),
  env("matrix"),
  env("pmatrix"),
  env("bmatrix"),
  env("vmatrix"),
  env("figure", ["\\centering", "\\includegraphics[width=\\linewidth]{${file}}", "\\caption{${caption}}", "\\label{fig:${label}}"], "[htbp]"),
  env("table", ["\\centering", "\\caption{${caption}}", "\\label{tab:${label}}", "\\begin{tabular}{${cc}}", "  \\hline", "  ${}", "\\end{tabular}"], "[htbp]"),
  env("tabular", ["\\hline", "${}", "\\hline"], "{${cc}}"),
  env("tabularx", ["\\hline", "${}", "\\hline"], "{\\linewidth}{${XX}}"),
  env("longtable", ["\\hline", "${}", "\\hline"], "{${cc}}"),
  env("center"),
  env("flushleft"),
  env("flushright"),
  env("quote"),
  env("quotation"),
  env("verbatim"),
  env("lstlisting", ["${}"], "[language=${Python}]"),
  env("minted", ["${}"], "{${python}}"),
  env("minipage", ["${}"], "{${0.45}\\linewidth}"),
  env("theorem"),
  env("lemma"),
  env("proposition"),
  env("corollary"),
  env("definition"),
  env("example"),
  env("remark"),
  env("proof"),
  env("thebibliography", ["\\bibitem{${key}} ${}"], "{99}"),
  env("tikzpicture"),
  env("axis", ["\\addplot{${}};"], "[xlabel=${x}, ylabel=${y}]"),
  env("frame", ["\\frametitle{${title}}", "${}"]),
  env("columns"),
  env("column", ["${}"], "{${0.5}\\textwidth}"),
  env("wrapfigure", ["\\centering", "\\includegraphics[width=\\linewidth]{${file}}", "\\caption{${caption}}"], "{r}{0.4\\textwidth}"),
  env("sidewaystable"),
  env("appendices"),
  env("otherlanguage", ["${}"], "{${language}}"),
];

/** The text inserted for `name` as a whole environment, as a snippet template. */
export function environmentTemplate(e: Environment): string {
  return [`\\begin{${e.name}}${e.head ?? ""}`, ...e.body.map((line) => `  ${line}`), `\\end{${e.name}}`].join("\n");
}

/** The text inserted for `name` after `\begin{` is typed: the name, the closing brace, the head, the body and the matching end. */
export function environmentTail(e: Environment): string {
  return [`${e.name}}${e.head ?? ""}`, ...e.body.map((line) => `  ${line}`), `\\end{${e.name}}`].join("\n");
}

export const environmentNames = (): string[] => ENVIRONMENTS.map((e) => e.name);

/** An environment by name; names the editor does not know get an empty body. */
export const environmentNamed = (name: string): Environment => ENVIRONMENTS.find((e) => e.name === name) ?? env(name);

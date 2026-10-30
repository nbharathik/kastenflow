// The commands the editor offers after a backslash: structure, text, references,
// graphics, tables, bibliography and packages. Math is in `math.ts`. Each entry
// is a short spec: the name, then its arguments. `{x}` is a required argument
// (the placeholder is x), `[x]` is an optional one that is left out when the
// command is inserted, and `[!x]` an optional one that is put in. The list is
// static and sits in the window: nothing here asks anyone.

import { MATH } from "./math";

export type CommandKind = "keyword" | "function" | "constant" | "type";

export interface CommandEntry {
  /** Without the backslash; may end with a star. */
  name: string;
  /** The arguments as written in the spec, shown beside the name. */
  detail: string;
  /** The text inserted, with `${x}` places to tab through. */
  template: string;
  kind: CommandKind;
}

/** Reads a spec such as `includegraphics[!width=\linewidth]{file}`. */
export function parseSpec(spec: string, kind: CommandKind): CommandEntry {
  const name = /^[A-Za-z@]+\*?/.exec(spec)?.[0] ?? spec;
  const rest = spec.slice(name.length);
  let template = `\\${name}`;
  let detail = "";
  for (const part of rest.matchAll(/\{([^{}]*)\}|\[(!?)([^[\]]*)\]/g)) {
    if (part[1] !== undefined) {
      template += `{\${${part[1]}}}`;
      detail += `{${part[1]}}`;
    } else {
      detail += `[${part[3]}]`;
      if (part[2]) template += `[\${${part[3]}}]`;
    }
  }
  return { name, detail, template, kind };
}

const STRUCTURE = [
  "begin{environment}", "end{environment}", "documentclass[options]{class}", "usepackage[options]{package}", "title{text}", "author{names}", "date{date}", "maketitle", "thanks{text}",
  "tableofcontents", "listoffigures", "listoftables", "appendix", "frontmatter", "mainmatter", "backmatter",
  "part{title}", "part*{title}", "chapter{title}", "chapter*{title}", "section{title}", "section*{title}", "subsection{title}", "subsection*{title}",
  "subsubsection{title}", "subsubsection*{title}", "paragraph{title}", "subparagraph{title}", "newpage", "clearpage", "cleardoublepage", "pagebreak", "nopagebreak",
  "pagestyle{style}", "thispagestyle{style}", "pagenumbering{style}", "geometry{options}", "onecolumn", "twocolumn", "input{file}", "include{file}", "includeonly{files}",
  "subfile{file}", "usetikzlibrary{libraries}", "makeatletter", "makeatother", "newcommand{command}{definition}", "newcommand*{command}{definition}",
  "renewcommand{command}{definition}", "renewcommand*{command}{definition}", "providecommand{command}{definition}", "newenvironment{name}{begin}{end}",
  "renewenvironment{name}{begin}{end}", "newtheorem{name}{title}", "theoremstyle{style}", "DeclareMathOperator{command}{text}", "DeclareMathOperator*{command}{text}",
  "setlength{length}{value}", "addtolength{length}{value}", "setcounter{counter}{value}", "addtocounter{counter}{value}", "stepcounter{counter}", "newcounter{counter}",
  "arabic{counter}", "roman{counter}", "Roman{counter}", "alph{counter}", "Alph{counter}", "value{counter}", "thepage", "thesection", "today", "def", "let", "newif",
  "AtBeginDocument{code}", "AtEndDocument{code}", "hypersetup{options}", "setmainfont{font}", "setsansfont{font}", "setmonofont{font}", "graphicspath{paths}",
  "lstset{options}", "lstinputlisting[options]{file}", "inputminted[options]{language}{file}", "mintinline{language}{code}", "lstinline{code}", "verb", "verb*",
];

const TEXT = [
  "textbf{text}", "textit{text}", "textsc{text}", "textsl{text}", "textrm{text}", "textsf{text}", "texttt{text}", "textup{text}", "textmd{text}", "textnormal{text}",
  "emph{text}", "underline{text}", "uline{text}", "sout{text}", "textsuperscript{text}", "textsubscript{text}", "textcolor{color}{text}", "colorbox{color}{text}",
  "color{color}", "definecolor{name}{model}{value}", "mbox{text}", "hbox{text}", "fbox{text}", "framebox[width]{text}", "makebox[width]{text}", "parbox[position]{width}{text}",
  "raisebox{lift}{text}", "footnote{text}", "footnotemark", "footnotetext{text}", "marginpar{text}", "hspace{length}", "hspace*{length}", "vspace{length}", "vspace*{length}",
  "smallskip", "medskip", "bigskip", "noindent", "indent", "newline", "linebreak", "centering", "raggedright", "raggedleft", "tiny", "scriptsize", "footnotesize", "small",
  "normalsize", "large", "Large", "LARGE", "huge", "Huge", "bfseries", "itshape", "scshape", "ttfamily", "rmfamily", "sffamily", "mdseries", "upshape", "slshape", "par",
  "LaTeX", "TeX", "XeTeX", "ldots", "dots", "textbackslash", "textasciitilde", "textasciicircum", "textbar", "textless", "textgreater", "quad", "qquad", "enspace",
  "hfill", "vfill", "hrulefill", "dotfill", "rule{width}{height}", "item[label]", "item", "textquotedblleft", "textquotedblright", "textendash", "textemdash",
  "enquote{text}", "SI{value}{unit}", "num{number}", "si{unit}", "ang{angle}", "lipsum[range]", "ensuremath{math}", "phantom{text}", "hphantom{text}", "vphantom{text}",
  "hyphenation{words}", "foreignlanguage{language}{text}", "selectlanguage{language}", "textcircled{text}",
];

const REFERENCES = [
  "label{key}", "ref{key}", "eqref{key}", "autoref{key}", "pageref{key}", "nameref{key}", "cref{key}", "Cref{key}", "vref{key}", "cite[note]{key}", "citep[note]{key}",
  "citet[note]{key}", "citeauthor{key}", "citeyear{key}", "citealp{key}", "parencite[note]{key}", "textcite[note]{key}", "autocite[note]{key}", "footcite{key}",
  "fullcite{key}", "nocite{key}", "bibliography{file}", "bibliographystyle{style}", "addbibresource{file}", "printbibliography[options]", "bibitem{key}", "url{url}",
  "href{url}{text}", "hyperref[label]{text}", "hypertarget{name}{text}", "hyperlink{name}{text}", "index{term}", "printindex", "glossary{entry}", "newglossaryentry{key}{options}",
  "gls{key}", "Gls{key}", "printglossaries", "newacronym{key}{short}{long}", "acrshort{key}", "acrlong{key}", "acrfull{key}", "makeindex", "makeglossaries",
];

const GRAPHICS = [
  "includegraphics[!width=\\linewidth]{file}", "caption{text}", "caption*{text}", "captionof{type}{text}", "subcaption{text}", "subfloat[caption]{content}", "scalebox{factor}{content}",
  "resizebox{width}{height}{content}", "rotatebox{angle}{content}", "includepdf[options]{file}", "centerline{content}", "node[options]{text}", "draw[options]", "fill[options]",
  "path[options]", "coordinate[options]", "addplot[options]", "addlegendentry{text}", "tikzset{options}", "pgfplotsset{options}",
];

const TABLES = [
  "hline", "cline{range}", "multicolumn{columns}{alignment}{text}", "multirow{rows}{width}{text}", "toprule", "midrule", "bottomrule", "cmidrule{range}", "specialrule{height}{above}{below}",
  "tabularnewline", "arraystretch", "rowcolor{color}", "cellcolor{color}", "columncolor{color}", "makecell[alignment]{text}", "extrarowheight",
  "endfirsthead", "endhead", "endfoot", "endlastfoot", "tabcolsep", "arrayrulewidth", "tablename", "figurename", "contentsname", "refname", "bibname", "abstractname",
];

const PEOPLE = ["institute{text}", "email{address}", "affil{text}", "keywords{words}", "subtitle{text}", "titlegraphic{content}", "frametitle{text}", "framesubtitle{text}", "pause", "only{slides}{text}", "uncover{slides}{text}", "alert{text}", "usetheme{theme}", "usecolortheme{theme}", "titlepage", "insertframenumber"];

const GROUPS: [readonly string[], CommandKind][] = [
  [STRUCTURE, "keyword"],
  [TEXT, "function"],
  [REFERENCES, "function"],
  [GRAPHICS, "function"],
  [TABLES, "function"],
  [PEOPLE, "function"],
  [MATH.operators, "function"],
  [MATH.symbols, "constant"],
  [MATH.greek, "constant"],
];

let built: CommandEntry[] | null = null;

/** Every command, once each, built on first use. */
export function allCommands(): readonly CommandEntry[] {
  if (built) return built;
  const seen = new Set<string>();
  built = [];
  for (const [specs, kind] of GROUPS) {
    for (const spec of specs) {
      const entry = parseSpec(spec, kind);
      if (seen.has(entry.name)) continue;
      seen.add(entry.name);
      built.push(entry);
    }
  }
  return built;
}

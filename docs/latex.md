# LaTeX documents

Write papers, reports and slides in LaTeX inside your vault and see the PDF beside
your text. Everything stays plain files: a LaTeX document is a folder of `.tex`,
`.sty`, `.cls`, `.bst` and `.bib` files that any other editor can open.

- [Turn it on](#turn-it-on)
- [Start a document](#start-a-document)
- [Write, build and preview](#write-build-and-preview)
- [Errors](#errors)
- [Jump between the text and the PDF](#jump-between-the-text-and-the-pdf)
- [Citations and the bibliography](#citations-and-the-bibliography)
- [Send a page to LaTeX](#send-a-page-to-latex)
- [Which TeX builds the PDF](#which-tex-builds-the-pdf)
- [Settings for one document](#settings-for-one-document)
- [Agents and LaTeX](#agents-and-latex)

## Turn it on

LaTeX is a [plugin](plugins.md) and starts off. Switch it on in **Settings →
Plugins**. Turning it off later never hides or deletes your files.

## Start a document

- **+ New → New LaTeX document** on Home, the **+** menu of a tab, or **New LaTeX
  document** in the command palette. Two more starting points are listed beside
  it: **New LaTeX report** (with chapters and a table of contents) and **New LaTeX
  slides** (a Beamer presentation).
- The document opens at once as "Untitled document" with a small article to start
  from, and its first PDF builds by itself. If you are in a project, the document
  goes into that project's `latex` folder; otherwise into the library's.
- Open an existing LaTeX folder by opening its `.tex` file. A folder counts as a
  document when it holds a main file: one with `\documentclass`, one named in a
  `% !TEX root = ...` line of another file, or the `main` named in
  `kasten-latex.yaml`.
- **Go to LaTeX documents** in the palette lists them all.

## Write, build and preview

The document opens in three parts: the files (and an outline) on the left, the
text in the middle and the PDF on the right. The dividers can be dragged, and
**Files** in the toolbar hides the file list.

- **It builds as you type.** A moment after you stop typing (half a second by
  default; in Settings → LaTeX, *Wait after typing* sets 300 to 2000 milliseconds
  and *Build while I type* turns it off) the PDF is made again. The new PDF is swapped in only when it is ready,
  at the same place and zoom, so the page does not jump.
- **Build now:** Ctrl+Enter (Cmd+Enter on a Mac), or the **Build** button.
  **Stop** ends a build that is running. Ctrl+S saves and builds.
- **Saving.** Your text is saved as you type. The status line says *Saved*,
  *Saving…* or *Not saved*. If the file changed somewhere else at the same lines,
  you are asked: **Keep my text** or **Use the file on disk** (a copy is kept
  either way).
- **Export PDF** puts the last built PDF in the document's folder, next to its main
  file, so it is in your vault, saved in history and easy to attach to an email.
- **The first build downloads TeX packages.** TeX builds a PDF from many small
  packages. The first time a package is needed, Tectonic fetches it from the
  internet, so the first build is slower and needs a connection ("Downloading TeX
  packages…"). The next builds use what it kept.
- **Other tools in the editor:** line numbers, folding by section, search (Ctrl+F),
  matching brackets, and completion: type `\` for commands (about 330, with a
  place to Tab through), `\begin{` for environments, `\ref{` for your labels,
  `\cite{` for your references, and file and package names. Everything works
  offline.

The build's files never go into your vault: they live in KastenFlow's cache and
can be thrown away at any time. Files in a document may be up to 200 KB each.

## Errors

When a build fails, the status line says "2 errors" and the PDF you last had
stays on screen with a line such as "Showing the last PDF that worked", followed
by the first error and its line. Below the text, the **problem list** gives every
error and warning with its file and line. Click one (or press Enter) to go there;
the up and down arrows move through the list; **F8** in the text goes to the next
mark. If there is no PDF yet, the error is shown with a **Build again** button.

Marks in the margin and wavy underlines show where the problems are, and they
move with your text until the next build.

## Jump between the text and the PDF

- **Text to PDF:** Ctrl+click (Cmd+click) a place in the text, press
  Ctrl+Alt+J, or use **Sync to PDF**. The place is flashed in the PDF.
- **PDF to text:** double-click a place in the PDF, press Enter on the PDF, or use
  **Find this place in the source**. The right file opens at the right line, even
  when it is one of the document's other files.

A single click on the PDF does not jump, so you can click it to focus or scroll
without moving your cursor.

## Citations and the bibliography

Your references (see [References and papers](guide.md#references-and-papers)) can
be cited in a LaTeX document.

- **Insert a citation:** the **Cite** button in the toolbar, or *LaTeX: insert a
  citation* in the palette. Type to narrow the list and press Enter. A second
  pick inside `\cite{...}` adds to it.
- **Completion** also offers the keys when you type `\cite{`, from the document's
  own `.bib` files and from your vault's References.
- **Which bibliography:** a document uses the `.bib` file in its own folder by
  default. In `kasten-latex.yaml`, `bibliography: vault` copies your vault's own
  reference file into the build instead.

## Send a page to LaTeX

Turn what you wrote in KastenFlow into LaTeX:

- **A whole page:** the page's ••• menu → **Present & export → Send to LaTeX**
  (or *Send this page to LaTeX* in the palette). A new article named after the
  page opens.
- **Add a page to a document:** **Add to a LaTeX document…** in the same menu. The
  page is added before the document's `\end{document}`.
- **Some words:** select them and use **Send to LaTeX** on the selection bar, then
  choose **A new document** or an existing one.

What comes across: headings, lists, bold and italic, links, tables, code (as
plain verbatim text), maths, quotes and citations (`[@key]` becomes `\cite{key}`).
What does not: pictures and embeds become a comment line so you can place them,
footnotes and highlights become plain text, and a link to another page keeps only
its words. After sending, a notice lists what was left as plain text. Text from
outside is always turned into safe text: it can never add a command that reads
files or runs a program.

## Which TeX builds the PDF

LaTeX needs a TeX program. KastenFlow supports two:

- **Tectonic**, a small TeX that KastenFlow can download for you. If no TeX is
  found, the document shows a card with **Install Tectonic**. The download shows
  its progress and can be cancelled. When a build starts it downloads the TeX
  packages it needs.
- **Your own TeX** (MiKTeX, MacTeX or TeX Live): choose **Use my TeX** on the card.
  KastenFlow runs `latexmk` from your PATH with pdfLaTeX. **Check again** looks
  once more after you install one.

If the Tectonic download is not offered by your version, the card says "The
Tectonic download is not available in this version" and gives you **Use my TeX**.

Builds run with the limits a TeX program from your computer should have: a time
limit (2 minutes by default), no access outside the document's own folder, and no
special files such as `latexmkrc` or programs copied into the build.

## Settings for one document

Optional. A file named `kasten-latex.yaml` beside the main file:

```yaml
main: paper.tex            # which file is the main one
engine: tectonic           # tectonic, latexmk-pdf, latexmk-xe or latexmk-lua
bibliography: vault        # vault or local (the default)
locked: true               # keep agents from changing this document
```

All keys are optional, and keys KastenFlow does not know are left alone.

## Agents and LaTeX

When the plugin is on, agents see four LaTeX tools: they can list documents, read
a source file, change one piece of text (with the file's version, so a change you
made meanwhile is never overwritten) and read the last build's errors. Agents
cannot start TeX or add files: you do that in the app. A change that takes out
much of a file waits for your review, and a document with `locked: true` is
read-only to agents. In the chat panel, **Fix LaTeX errors** asks the assistant to
fix what the last build reported. See [Agent modes](agents.md).

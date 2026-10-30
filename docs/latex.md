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

A build that was made with pdfLaTeX and needs Unicode text or `fontspec` shows a
note above the list: switch the document's engine to XeLaTeX (or LuaLaTeX), or use
Tectonic. The same sentence is given to the assistant, so it suggests the switch
instead of chasing each character.

## Fix problems with the assistant

The assistant's answers are suggestions and can be wrong, most of all when your
document defines its own macros. You always look at what it changes first.

- **Fix with AI** (in the problem list, and *LaTeX: fix the problems with AI* in the
  palette) fixes errors first. With no errors it handles warnings it can put right:
  a reference or citation with nothing behind it, and overfull boxes. It sends the
  numbered lines around each problem in every file that has one, what TeX printed
  where it stopped, and a short map of the document (its files, labels and
  bibliography keys), not the whole paper.
- **Fix this one** and **Explain** sit on each row of the problem list and in the
  tooltip of each mark in the text, so you can deal with one problem at a time.
  Explain changes nothing.
- **It checks its work.** After editing, the assistant builds again and compares the
  counts, tries once more if errors are left, and ends with a line such as
  "3 errors → 0". When your agent mode makes it ask first, the build is of the
  changes that wait for your review, made in a scratch folder: your files and the
  last good PDF are not touched, and the scratch folder is removed afterwards.
- **No TeX installed:** the assistant is told so plainly and stops trying to build.
  The very first build also downloads TeX packages, so the assistant waits longer
  for it and is told when a slow line is the reason.

## Ask AI in the editor

Press **Ctrl+K** (Cmd+K on a Mac) in the text, or use **Ask AI** in the toolbar. A
small panel opens at the cursor with a box for free text and a few presets:

- **Equation from words**
- **Table from CSV or a page table** (select the text first)
- **Figure from a diagram** (opens a chat that uses your diagram)
- **Turn into align** (select the equation first)
- **Tighten paragraph**
- **Explain this**

The answer replaces the selection, or goes at the cursor, and is shown as a diff in
the text: new text in green, the text it replaces in red above it. **Keep** (Enter)
leaves it, **Undo** or **Esc** puts the old text back. Nothing is saved until you
keep it. More actions for a LaTeX document are in the palette: draft a section from
a page, find missing citations in your References, check `\ref` and `\label` pairs,
fix overfull boxes, and turn a page table into `booktabs`.

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

When the plugin is on, agents can write a whole paper in your vault. They can list
documents, read a source file, start a document from a template (article, report or
Beamer), write or replace a file, add text at the end of a file or after a piece of it,
change one piece of text (always against the file's version, so a change you made
meanwhile is never overwritten), and move a file to the trash, where you can put it back.
They can put a PNG, JPG or PDF picture in a document's `figures` folder, cite a reference
from your References (the entry is kept once in the document's `references.bib`; the
reference itself is never changed), and send a page, or one section of it, to a document as
**Send to LaTeX** does. With the draw.io plugin on too, they can turn a diagram into a
figure.

Two things stay yours. KastenFlow never runs Python or any program for an agent: an
assistant that wants a chart makes the PNG on its own side and sends it. And agents never
send a PDF: with the app open, an agent can ask the app to build a document now (it gets
the errors and warnings, the page count and the PDF's size) and to keep the PDF the app
built in the document's folder. If the app is closed, the agent is told so in a sentence.

Every change follows your agent mode: a new document, a citation, a sent page and a kept
PDF wait for your review in **Review everything**; taking out a document's root file, or
much of a file, waits unless agents work on their own. A document with `locked: true` is
read-only to agents. One undo takes a whole session back. In the chat panel, **Fix LaTeX
errors** asks the assistant to fix what the last build reported (see
[Fix problems with the assistant](#fix-problems-with-the-assistant)). An agent can also read
just the lines it needs: `latex_read` takes `around_line` (15 numbered lines each side) or
`lines` such as `40-80`. See [Agent modes](agents.md) and [MCP tools](mcp-tools.md#latex).

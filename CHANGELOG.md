# Changelog

Every release of KastenFlow (called Kasten before 1.1.0), newest first.
Versions follow [Semantic Versioning](https://semver.org); the vault format
has its own version, described in [docs/vault-format.md](docs/vault-format.md).

## 1.2.3

### Chat

- **Reading while it writes.** Scroll up during an answer and a **Jump to latest**
  button appears ("New below" once it has finished); sending always brings you back
  to the bottom. Long answers stream with far less work for the window.
- **Maths and code in answers.** `$…$` and `$$…$$` show as formulas, and JavaScript,
  TypeScript, JSON, HTML and CSS blocks are coloured.
- **Versions.** Regenerate an answer, or edit any earlier question, and the old
  answers stay behind a **‹ 2 / 3 ›** switcher.
- **Changes in the chat.** What the agent proposes shows as cards in the
  conversation, with Keep or Undo for each part, Keep all and Undo all. A card for
  a page you edited since the agent read it says so and offers **Ask the agent to
  redo**; it is never applied over your edit.
- **Ask first, Apply directly or Auto**, per chat, in the chat's "…" menu. Auto
  applies only small edits to the pages the chat is about; Review mode and locked
  notes still win.
- **Tint what agents wrote** (page menu → View, off by default) marks text an agent
  wrote today, with Keep and Undo on hover. An agent writing to the page you are
  typing in never moves your cursor or scroll.
- Copy and Copy as Markdown on answers, Copy on questions; **Esc** stops an answer,
  **↑** edits your last question, **Ctrl+Shift+C** copies the last answer and
  **Ctrl+L** goes to the message box.
- Many tool steps in a row fold into one line; an empty reply offers Retry; offline,
  a message waits and sends when you are back; a rate limit counts down and retries
  once; "Working · 0:42" shows how long an answer has run.

### LaTeX and AI

- **Fix with AI** now builds after its edits, compares the error count and tries once
  more, ending with "N errors → M". Under Ask first it builds the proposed text in a
  scratch folder first, so the count is honest and your last good PDF stays.
- **Fix this one** and **Explain** on each problem and gutter mark; undefined
  references, citations and overfull boxes can be fixed too.
- **Ctrl+K in the LaTeX editor** asks inline: an equation, a table from CSV, turn into
  align, tighten a paragraph, explain this, a figure from a diagram, or your own words.
  The answer shows as a change you keep with Enter or undo with Esc.
- The AI sees the lines around each error and a map of the document (its files,
  labels, bibliography keys and references that point at nothing).
- New actions: fix overfull boxes, check references, find missing citations, draft a
  section, table to booktabs and figure from a diagram.
- Plainer engine help: a document that needs XeLaTeX is told so, the very first build
  waits longer while TeX packages download, and with no TeX installed the AI says so
  instead of trying again.

### Home

- **Today on a full day.** Events and to-dos are separate groups; past events fold
  away; the day rolls over at midnight, even when the window stays open.
- An **agents strip** under the bar says what agents did today; the Agents card stays
  optional. A calendar that could not be reached says so, with Retry.

### Presenting and slides

- **Present on** picks the screen in the Slideshow menu, and **Swap** in the presenter
  view trades the two screens while you present. **Identify** shows which screen is
  which. If a screen is unplugged, the show moves to one that is left.
- A small toolbar at the bottom left while you present (turn it off in Settings); the
  hint pill is gone.

### Feel

- Dialogs, menus, the palette and peeks fade out as well as in; menus grow from the
  button that opened them; rows slide into place when lists change; switching tabs
  cross-fades. Buttons press in slightly.
- With reduced motion turned on in your computer's settings, movement becomes a short
  fade instead of stopping dead, and spinners keep turning. The Motion setting can
  still turn everything off.
- Views that take a moment show nothing for the first second, then a placeholder,
  instead of flashing "Opening…".

### Smaller things

- **One selection bar** on captured pages: highlight colours and comments are part of
  it, instead of a second floating bar.
- **Tables:** click picks a cell, double-click, Enter or F2 edits it; a title renames
  in place; link cells get an open arrow.
- The vault health page lines up on wide windows.
- After the computer sleeps, polls restart, the day is checked again and open pages
  re-read their files.
- A 1 MB paste into a page goes in without freezing the window.
- Failures that used to be silent (opening a link, copying the sign-in code, stopping a
  build, a plugin that will not load) now say what went wrong.
- An update check that failed offline tries again when you are back online.

### Speed

- The window loads less code before it shows: the palette, shortcut help, vault
  chooser, side stack, page peek and the chat load on first use, and the presenter
  window loads far less (151 kB instead of 664 kB compressed).
- The app's background threads wake when there is work instead of 24 times a minute,
  and project summaries are refreshed for what changed rather than all at once.
- Polls pause while the window is hidden, and caches of pictures and files have limits.

### Known limits

- Messages waiting while offline are lost if you close the app before you are back
  online.
- The Apply directly / Auto choice applies to the chat only, not to a page's own Ask
  AI, and there is no default for new chats in Settings yet.
- Undo on tinted agent text takes back that agent's whole session (it asks first).
- Undoing a very large paste may take more than one Undo.

## 1.2.2

### Back up to your own private GitHub repository

- **A guided backup.** One panel takes you from "no backup" to "backed up": sign in
  with GitHub (a code you confirm in the browser; or a token, or the GitHub command
  line if it is already signed in), create a private repository or pick one you
  have, and the first backup runs with a progress bar. It starts from the status
  bar, a notice after you create a vault, a card on Home, History, Settings →
  Backup and the command palette.
- **Always visible.** The status bar says "Backed up 2 minutes ago" or "Backed up ·
  3 waiting"; click it to back up now, get the latest, open the repository on
  GitHub or see what needs a look.
- **Other computers.** Open your backup from the vault chooser (your repositories,
  KastenFlow's first), and **Get latest** brings changes across by itself when that
  is safe, or asks you. Nothing is ever overwritten: a page both computers changed
  keeps the other version as a copy.
- **Safe by default.** Nothing is ever force-pushed. A repository that turns out to be
  public pauses the backup until you make it private (one click). If the copy on
  GitHub no longer holds your history, backup stops and offers to save your full
  history to a safety branch. Files over 100 MB are left out and listed, never lost
  silently. Saved chats and app settings stay on your computer and are not backed up.
- Choose when to back up (as you work, every hour, or on close), how to bring in
  changes, and how many backup files to keep, in Settings → Backup.

### Plugins

- **Settings → Plugins** switches the official plugins on and off: **draw.io**
  (diagrams), **LaTeX**, **Smart pages** and **Browser**. A plugin that needs a program
  downloads it once, with progress and Cancel, checks it and keeps it outside your vault.
- Turning a plugin off never hides or deletes your files: a diagram still opens to
  a one-click "Turn on draw.io", embedded diagrams still show their picture, and
  agents are simply not offered that plugin's tools.

### LaTeX

- **Write LaTeX in your vault.** New documents from an article, report or Beamer
  template; an editor with completion for commands, environments, labels and
  citations, folding, search, an outline and a list of problems; a PDF preview that
  follows your typing and keeps its place; **Export PDF** into the document folder.
- Jump from a place in the text to the PDF and back. Build errors point to the file
  and line, and the last good PDF stays on screen.
- **Send to LaTeX** turns a page or a selection into a new document, or adds a page
  to an existing one, citations included. **Cite** inserts a reference from your References.
- Builds use Tectonic (downloaded on request) or your own TeX (latexmk). The first
  build downloads the TeX packages it needs.
- Agents can write whole papers: see "Agents" below.

### The chat panel

- **Selected text** in a page, PDF, slide or LaTeX document is added to the chat as
  you select it; **Add to chat** (Ctrl+Alt+L, the selection bar, right-click) keeps
  up to five snippets.
- **History and archive.** A new chat never replaces the old one. Older chats go to
  an Archived list that you can search and reopen; only you delete them, with a
  count to confirm. A chat that cannot be reopened offers Retry or a new one.
- **When I switch pages**: keep the chat, use the page's own chat, or start a new
  one. Choose how many chats work at once; the others wait and say so.
- In a deck, the assistant keeps working while you are elsewhere, shows a status dot,
  and links it gives you open beside the deck, in a tab or in place, as you choose.

### Agents

- **Three modes:** Review everything, Balanced (the default) and Autonomous, for the
  whole vault or per project. Autonomous has a time box (1 hour, 8 hours or until
  you turn it off), shows a small mark in the top bar with a one-click Turn off, and
  notes a restore point so you can go back to before a session.
- **Undo this chat's changes** from the chat header. **Batch**: an agent can make up
  to 100 changes as one, all or none, with one undo.
- **Agents can write whole LaTeX papers.** They can start a document from a template,
  write or replace a whole file (`.tex`, `.bib`, `.sty`, `.cls`, `.bst`), add text at
  the end of a file or after a piece of it, and move a file to the trash, all under the
  same modes as other changes: a new document waits for you in Review mode, and taking
  out a document's root file waits for you unless agents work on their own. Locked
  documents stay read-only.
- **Figures, citations and pages for LaTeX papers.** Agents can put a PNG, JPG or PDF
  picture in a document's figures folder (the same picture twice is one file), cite a
  reference from your References (the entry is kept once in the document's
  `references.bib`, and the reference itself is never changed), and send a page, or
  one section of it, to a document as Send to LaTeX does. KastenFlow never runs Python
  or any program to draw a chart: the assistant makes the PNG and sends it.
- **Agents can build a paper and keep its PDF.** With the app open, an assistant can ask
  KastenFlow to build a LaTeX document now and gets the errors and warnings (with file
  and line), the page count and the PDF's size, or is told plainly that the app is closed
  or the build did not finish in time. It can then keep the PDF in the document's folder
  as one change you can undo; that follows the same modes as other changes (it waits for
  you in Review mode) and a locked document is refused. The assistant never sends the
  PDF itself: it is the app's own build.
- **Agents can put a diagram in a paper.** With the app open, an assistant can ask
  KastenFlow to draw a diagram as a PNG and keep it as a figure of a LaTeX document in
  one step, getting back the path and a ready `\includegraphics` line. The app draws
  the picture in its window from the diagram's own picture, with no network; the
  figure follows the same rules as any picture an agent adds (a locked document is
  refused, one undo takes it back). Exporting a diagram as a PNG works the same way.
  Both need the app open and say so plainly if it is closed.
- **Agents can read what you have selected.** An assistant in Claude Desktop, Claude
  Code or another client can ask what you have selected in KastenFlow: up to five
  pieces of text from a page, a PDF, a slide or a LaTeX file, with the file, the
  heading and the place, and for a slide the selected elements. The app shares your
  selection only for two minutes after a client asks, shows "Shared with a connected
  client" in the chat panel while it does, keeps it on this computer only (never in
  your notes' history, a backup or git), and deletes it when you close the app.
- **When an agent needs the app.** Building a paper, keeping its PDF, drawing a diagram
  as a picture and reading your selection all ask the open app through a private folder
  in the vault's cache that only you can read and that history, backup and git never
  take in. The app answers a short, fixed list of requests, none of which can name a
  program, an internet address or a file outside the vault; what it keeps in your vault
  goes through the same checks and agent mode as any other change, in the agent's
  session. With the app closed, every one of these tools says so in a sentence and
  changes nothing.
- **A whole visit, tested.** A test now runs one assistant visit from start to end on a
  copy of the sample vault (a LaTeX paper with a diagram figure, a chart, two citations, a
  build, the PDF, the selection and the same chart on a slide) and checks that one undo
  gives the vault back exactly as it was.
- **More tools for agents** (99 for notes, boards, diagrams, LaTeX and smart pages,
  plus the slide tools): put pages inside others and order them, start
  projects and save them as setups, set a project's status and a database's views and
  row order, edit a page by its blocks without touching the rest, duplicate and
  restore notes, comments, tasks, saved searches, references and the activity digest.
- **Agents can do more on a whiteboard.** Besides stickies, moving and colours, an
  assistant can now add web link cards, sections and shapes, reword a sticky, a section
  or a link, give a shape another outline, show a note's card as its title or in full,
  fold a section and take arrows away. Taking many cards or arrows off at once still
  waits for your review, and one undo takes the whole session back.
- **A picture's crop and outline, a locked element and Morph pairs** are now named in
  the words the slide tools give to assistants, so an assistant can set what you set in
  the editor.
- **The editor and the agent tools are checked against each other.** Tests now fail when
  a slash menu entry, a page menu row, a whiteboard action or a slide operation is added
  without saying whether an assistant can do it too.
- **Page columns, page width and folded properties:** `/columns` puts blocks side by
  side (stored as plain comments, so the file stays readable anywhere); a page can be
  Normal, Wide or Full width; a page's properties fold into one line. Sub-pages can be
  put in your own order by dragging, Alt+arrows or the palette.
- **Smart pages**: a page that draws itself from your notes as a dashboard, tracker,
  gallery, map or timeline, built from ready-made parts and run in a closed box (no
  network, only your notes through the same rules as agents). Start from a starter or
  ask the chat; edit the code in the app; see and restore earlier versions; show one
  inside another page; present, print or save it as one HTML file. A page an agent made
  while you review everything waits for your **Allow to run**. Smart pages are a plugin
  that is **off until you turn it on** (Settings → Plugins), and a project can turn
  them on or off for its own pages. While they are off, an agent can only ask you to
  turn them on, and nothing turns on until you accept; turning them off deletes
  nothing.
- **Routines.** Home → Agents today (optional) and History → Today by agents show
  what agents did while you were away, with Undo. `kasten-mcp --setup codex` prints
  the settings for Codex.

### Tables and databases

- **Sub-items**, **group by** with folding and a calculations row (sum, average,
  count, earliest and more), **multi-sort**, "match any" filters, wrapped cells,
  compact rows and a frozen title column.
- **Pick rows** and change many at once (property, tags, move, add to a board,
  duplicate, trash) as one step you can undo; **drag rows into your own order**;
  **paste from a spreadsheet** with every value read by its column's type.
- **Formula properties** (`days_until`, `days_since`, `count`, `count_backlinks`,
  `sum`, `min`, `max`, `if_empty`) with a live check and a function list.
- A **timeline view** with draggable bars, lanes, and week, month and quarter scales.
- **Turn a table in a page into a database** from its menu; tables in pages gain
  Add row, Add column, Align column and Copy as CSV without rewriting the rest.

### Presenting

- **F5** presents from the start, **Shift+F5** from this slide and **Alt+F5** with the
  presenter view. The show fills the screen, keeps notices and the chat out of the
  way, and with two displays can go to the other one (**Present on**).
- A web link opens over the slide with Back, Forward, Reload, Preview here / beside /
  full screen and Open in my browser; right-click any link for the same choices.
- The presenter view no longer gets stuck: it follows the show, rejoins after a
  pause, and keys work from either window.

### Smaller things

- The page menu is grouped, with View and Present & export submenus; the vault health
  page is laid out as a list of problems with a button for each; tabs stay ready when
  you switch, so coming back to a page is instant; a board embedded in a page greys
  out Undo and Redo when they cannot apply.
- Build checks: changes that only touch notes or docs skip the heavy checks, the
  frontend tests also run on Windows, and a release reuses a passing manual run of the
  checks on the same commit instead of running them twice.

### Known limits

- The one-click Tectonic download is offered only in builds that carry its
  checksums; otherwise LaTeX uses a TeX you have installed.
- The world map in smart pages is a simplified outline.
- An agent can check a smart page's files and read the errors it reported, but cannot
  see a picture of it.
- Figures an agent adds to a paper are pictures (PNG, JPG or PDF files); a diagram is
  drawn as a PNG, not a PDF. An agent cannot attach other kinds of file to a page (a spreadsheet,
  say), cannot make a new slide layout, and cannot draw freehand on a whiteboard.
- Building a paper for an agent and reading the selection need the KastenFlow app open; the
  installed app is not a background service.
- Only pages inside another page can be put in your own order; top-level pages stay
  alphabetical.
- A database sub-item tree and a grouped table do not use manual row order.
- Columns do not nest, and the number of columns is chosen when you make them.

## 1.2.1

1.2.0 was tagged, but its release stopped before anything was published: 1.2.1 is
the first release of everything below.

### Slides

- **Tables can be edited cell by cell.** Click a cell, type to fill it, Tab and
  Shift+Tab move (Tab in the last cell adds a row), Enter goes down, Shift+Enter
  starts a new line, Esc cancels and Delete clears the selected cells. Insert or
  delete rows and columns where you are, merge and unmerge cells, and colour them.
  Copy cells to a spreadsheet and paste from Excel, Sheets or plain text; a paste
  that would cut a merged cell is refused and says why.
- Delete, copy, cut, paste and undo work right after a deck opens and after any
  dialog closes, instead of waiting until you click the slide.
- **Web pages in a presentation.** A link opens a page beside the slide, in the
  centre or full screen, with back, forward, reload and open-in-browser; Esc steps
  back out one level and returns to the same slide. A page that refuses to be shown
  gets a clear card instead of silently disappearing. In the editor, **Preview
  live** opens an embedded page in the same panel. (The desktop app shows pages
  through its browser, so Settings → Browser must be on; with no connection you
  see the browser's own error page.)
- **Highlight colour** for text, and citations that link to their DOI or address.
  Decks that use either are saved in deck format 2 (older versions cannot open
  them; decks that use neither are saved as before).
- Paint format has keys (Ctrl+Alt+C and Ctrl+Alt+V) and paints tables too. The
  filmstrip can be made wider or narrower, panels and the filmstrip have
  right-click menus, **Save as layout** and **Reset to layout** are in the menus,
  and layouts can be imported from another deck.
- A marquee can start on the grey stage, a readout shows the position while you
  drag, Alt shows the distance to a neighbour, shapes appear where you last
  pointed, the outline's "+" adds a blank slide, and a slide pasted into a deck of
  another shape is scaled to fit.
- **Storyboard first:** turning a page's sections into a deck now opens a storyboard
  where you reorder, merge, split and leave out slides, and choose the template and
  shape. When a source page changes, **Review sources** lists which slides moved on
  and lets you update the ones you did not touch and keep or replace the ones you
  edited (an update changes a slide's body, not its title or notes).
- **Rehearse** a talk with per-slide timings (nothing advances by itself), and an
  export check lists missing pictures, overflowing text, broken links and
  unresolved citations before you export or present. **Turn off slide numbers in
  every deck** is one change you can undo.
- PowerPoint import keeps a layout's shapes as part of the layout, and text
  highlights export and import.

### Projects and organising

- **Projects** opens a hub of every project as cards or a list: status (Active,
  Paused, Done), health, open and overdue to-dos, a progress bar, the next action,
  the last activity, search, sorting, pins and an Archived toggle. New projects can
  start from a Research, Writing or Presentation setup, previewed before it is made.
- Each project can pin a **next action**, show its health (On track, At risk,
  Blocked) and keep a last review date, and **New update** writes a dated page
  (progress, decisions, blockers, next action).
- **Daily and weekly reviews** gather captures, due and overdue to-dos, projects
  due for review and recent decisions. Opening one writes nothing; you save it as a
  note only when you want to.
- **Saved collections** keep a search and its filters as a small file in `views/`;
  relative dates such as "last 30 days" stay relative. Pin them to Home or a
  project.
- **Workspaces** remember panes, tabs, panel sizes and a project, and resume
  later; web tabs come back suspended.
- Drop pages onto a gallery or table to add its tag (nothing moves), or use
  **Add existing pages**. `kasten:` links point to a page, heading, PDF highlight
  or whiteboard section (and to a deck, which opens, not a particular slide) and
  only ever open it.

### Capture and research

- Capturing a page you already saved says so and offers **Save another snapshot**
  (the browser tab and triage also offer **Open**); triage goes through captures by
  keyboard (project, tag, board,
  to-do, archive, put off, reading state), with undo for each action. A "this week"
  view lists the last week's captures.
- **References** lists every paper in your `.bib` files. Add one by pasting BibTeX,
  a plain citation, a DOI or an arXiv address, from a web page you have open, from
  the extension, or from a PDF you import; nothing is looked up online, so you
  check the details yourself. `[@key]` cites a paper in a page. Renaming a key
  updates the `.bib` file, pages, pictures and decks in one change you can undo.
  Your own `.bib` files are never rewritten (a Zotero Better BibTeX auto-export
  inside the vault is listed the same way, with no two-way sync); KastenFlow keeps
  its entries in `sources/references.bib`.
- **Compare papers**: put a highlight in a page with its quotation, source and a
  link back to the PDF page, and build a comparison table or outline.
- **Comments** on pages (a column beside smart-layout pages, or a Comments tab) and
  **highlights** on captured articles stay in files beside the page and move,
  rename, trash and restore with it.
- **Project bundles** export a project (with its pictures, PDFs and cited
  references) as a folder you can open anywhere, and import one with a preview of
  what it will settle.

### AI

- **Sign in with ChatGPT** now verifies your identity with OpenAI's published
  keys and ties the sign-in to one account. **Sign in again once** after updating.
- **A connection that holds.** A request that hits a busy or rate-limited server, a
  dropped connection or a stream that breaks before the model has asked for anything
  is tried again up to four times with a growing pause (the chat says "trying again
  (2 of 4)"), and Stop ends the wait at once. A renewal of your ChatGPT sign-in
  always runs to its end, so pressing Stop or losing the connection mid-renewal can
  no longer sign you out; only OpenAI refusing the sign-in itself (or a different
  account answering) does. A failed identity check when renewing no longer throws
  away a good token (the ChatGPT row says so), and a keychain hiccup no longer shows
  as "not signed in". Connection problems are named (rate limit, usage limit, model
  unavailable, sign in again), "Test connection" tries what a chat really sends and
  names the step that failed, and Settings → AI providers has a **Connection
  report** of recent requests, with no tokens, prompts or answers in it, to copy
  when something goes wrong.
- **A better agent.** The chat no longer stops after 12 tool calls. It works in
  steps (up to 80 steps, 250 tool calls and 30 minutes by default, set in Settings →
  AI providers → **Agent limits**). It pauses with a **Continue** button, not an
  error, when it reaches a limit, notices it is going round in circles, keeps being
  cut off by the model's length limit, or the app was closed while it worked. In a
  long job it is asked to keep a short **plan** and update it as it goes,
  it runs independent reads together, continues an answer that was cut off, and
  makes room in a long conversation by leaving out old results and summarising older
  steps. Send a message while it works and it takes it up at its next step; Stop
  drops what was waiting.
- **Chats keep working and are saved.** A chat goes on when you close the chat,
  switch to another view or to Slides, or close the window to the tray, and the chat
  button shows a pulsing dot while one works and a count when one finished, paused
  or failed; a notice (in fixed words, never what the chat said) appears when
  KastenFlow is in the background. Chats are saved on this computer (not in your
  vault) after every step and come back after a restart, together with the changes
  you had not applied yet; a chat that was working when the app closed is listed as
  interrupted and Continue picks it up without running again what already ran.
  KastenFlow never deletes a chat for you: you remove one yourself.
- **Attach things to a chat:** paste or drop long text, pictures, text files and PDFs
  (or **+ Context → Attach a file…**), up to five to a message. A long paste becomes
  an attachment you can open, pictures are scaled in the window (to 2048 pixels and
  5 MB), a PDF is read as text (the first ten pages), and a model that cannot read
  pictures says so instead of ignoring them (on a ChatGPT plan, where that is not
  known, a picture is tried on first use).
- The chat box keeps one size however much you type or however narrow the chat is.
- Pick a model from the list your account offers, and set reasoning effort, thinking
  or the longest answer where the model supports them.
- **Explain** a selection: read-only, with the nearby text or the whole page as an
  option. The chat can be resized, shows exactly which pages it will send, follows
  the active page, and offers regenerate and edit-and-resend.
- Edits the chat makes to your notes are **previewed first**: see each change, then
  Apply them as one change (Undo session reverses it) or Discard. Renames, moves
  and the trash are not previewed: they still go to Review as proposals. A per-chat
  switch (**Apply directly**) keeps the old direct behaviour, and changes you have
  not applied stay with the chat and are still waiting after a restart.
- AI actions are Markdown prompts you can edit in `templates/ai/` (Explain, Compare
  sources, Outline, Extract action items, Draft project update, and four for
  diagrams in the chat); PDF pages and highlights can be sent as context.
- **Diagrams with AI.** An assistant can create, read, check and edit diagrams
  without writing XML. It sends typed steps (add or change a box or arrow, restyle,
  group, move, resize, lay out) that are replayed on the diagram as it is when they
  run, so what you drew meanwhile stays and the boxes a step did not touch keep
  their exact bytes. In the chat and over MCP these are `diagram_new` (from a
  description, a Mermaid flowchart, which must be a flowchart, or one of ten
  templates), `diagram_edit`, `diagram_describe`, `diagram_lint` (overlaps, loose or
  unlabelled arrows, boxes off the page, crossings, low contrast, unsafe links and
  more), `diagram_find_shapes` (the editor's own icon names) and `diagram_export`
  (SVG only; the diagram editor still makes PNG pictures). A built-in automatic
  layout keeps boxes on the grid and works to reduce crossings, and eleven style
  presets cover architecture, network, C4, AWS, Azure, Google Cloud (drawn as plain
  boxes, since its icons are pictures in the editor), Kubernetes, flowchart,
  sequence, ER and mind-map drawings.
- A diagram an assistant made or changed shows a **draft picture** that KastenFlow
  draws itself (a library icon is a labelled box) until the diagram editor next
  draws the exact one. The diagram editor's header has **Draw with AI** (it opens
  the chat about the diagram and sends nothing yet), **Check diagram** and **Tidy**
  (the editor's own layouts); a held-back diagram change shows its picture before
  and after in the review, and an open editor reloads when you apply it.
- The MCP server offers table tools for decks, `server_status`, and, in the
  command-line `kasten-mcp`, `render_slide` through Chrome, Chromium or Edge (the
  installed app does not draw slides); run `kasten-mcp --check` or
  `kasten-mcp --setup claude-code` to test and set it up.

### Browser, calendar and everyday

- A **+** opens a new web tab, Ctrl+T opens one when a web tab is in front,
  Ctrl+T/W/L work while a web page has the keyboard, web tabs idle for ten minutes
  are closed, and menus appear over web pages.
- Calendars: `THISANDFUTURE` repeats, subscriptions follow the system proxy,
  "Subscribe to a calendar" is in the palette, and dragging an event onto a day
  makes a note for it.
- Section dividers and section cards show only icons (fold, present) and the
  section's name in a tooltip; other repeated labelled buttons are icons too.
- Settings search finds keyboard-shortcut names and each group remembers its
  scroll position. One indicator shows Saved, Saving, Indexing, External changes,
  Proposed, Stale or Failed, and a health page lists what needs attention without
  changing anything.
- The browser extension's folder ships with the installer.

### Speed

- The graph of a 10,000-note vault builds in under 100 ms (it was about 115 ms),
  and refreshes when boards, decks or diagrams change, not only notes. The list
  of what each picture is used by no longer reads every note on each call.
- A shared revision tells every view when something changed; the first page the
  app loads is smaller.

## 1.1.0

1.1.0 was tagged, but no installers were published for it: everything below
first ships in 1.2.1.

### A new name

- Kasten is now **KastenFlow**. Only the name changes: your vaults, settings,
  saved keys and sign-ins carry on as they are, and vaults still keep their
  own files in `.kasten/`.
- The command-line tool is `kastenflow`; `kasten` still works.
- On Windows, KastenFlow installs beside an earlier Kasten rather than over
  it. Uninstall Kasten once KastenFlow is running.

### Pages and the editor

- `---` splits a page into sections: hover a divider for the section's title and
  fold it; the first section folds from the block handle. Folding is only how the
  page looks; the file does not change. **Present this page** shows one section at
  a time, full screen, and a **smart layout** draws each section as a card with an
  outline strip to jump to a section or move it.
- Click below or beside the text to start writing. Shift+click or Shift+arrows
  select several blocks, which move, duplicate, colour, turn into another kind
  or group into a toggle together.
- `@` understands dates and times (`@next fri 3pm` writes `[[2026-10-16]] 15:00`),
  and also links boards, decks, tags and people, in to-dos too. A date in the title
  sets the page's date.
- A web address pasted on an empty line can become a link or a bookmark card.
  Whiteboards and decks embed quietly in a page: `/deck` and `![[name.deck]]`.
- Find in page has match case and whole word, finds toggle and callout titles,
  opens what is folded, and can search the page's sub-pages. Replace works
  across the page and its sub-pages as one change you can undo.
- Quick capture picks its place by typing (recent places first), can send to any
  page, and clips a web address like the in-app box.
- Dates in the Library: filter by created or updated day, week or month, or a
  range, and group by type, project, tag, month or week. Search also takes
  `on:`, `created:`, `updated:` and `under:`. Library colours match the Tag
  Database.

### Opening and organising

- One **Open** menu everywhere: new tab, to the right, side or centre peek, side
  stack. Pages can open to the right by default or per page, and the tab "+"
  button has a menu for a page, the journal, a deck or a whiteboard.
- The sidebar shows pages under projects (quick notes live in the project home),
  with pinned pages, a filter box and fifteen rows per project. The views list
  is organised: pin the ones you use and find the rest under **More views**.
- Whiteboards and decks on Home and project homes show the four newest as compact
  rows with **Show all**; deck previews share one frame whatever the slide shape.
- **Mind map from this page** makes one map per page, finds it again, and keeps
  it in step with the page without deleting what you added.
- The interface follows each screen: every display remembers its own size, with
  an **Auto** choice, and page text has four sizes.
- The Highlights page is redesigned.
- **Home** is one short screen. A single line holds the greeting, the capture
  field (type `/` for actions such as New page, New deck or Search), a **+ New**
  menu and Customize. Below it, **Recent** lists ten items one per row, with
  filters for pages, cards, boards, decks, diagrams and captures, a project
  drop-down, a type-to-narrow field and a rows or grid switch (it remembers your
  choices). A slim column shows today's events and to-dos, a short to-do list and
  the inbox. Projects, the page directory, this week, the journal, whiteboards
  and decks are optional and off until you turn them on in Customize, which now
  drags to reorder and resets to the simple layout.
- **Settings** is a window of two panes, as in VS Code: the groups on the left
  under General, Connect, Data and System, one group at a time on the right, and a
  search over every setting (press `/`) that marks what it found. Rows are short;
  the longer explanation is behind a **?**, and a dot with a way back marks what you
  changed. The palette opens Settings at a group (**Settings: Appearance**) or a
  single setting.

### Slides

- New slides are blank, with no stray bullet; a text box lands where you click;
  new decks have no slide numbers (a switch turns them on); one element can align
  to the slide.
- Page setup for 16:9, 16:10, 4:3, a square or your own size; eleven themes, seven
  of them new, in a template gallery with example slides.
- Smoother dragging and resizing, animated slide reordering, entering groups,
  a selection bar and a fuller right-click menu, and a deck-wide transition.
- Dragging, resizing and turning follow the pointer without redrawing the slide, so a
  busy slide moves as smoothly as an empty one; Alt or Ctrl while dragging makes a copy,
  guides show the size of an equal gap, and Esc glides everything back.
- Zoom follows the wheel and a pinch about the pointer, glides for the menu and the
  keys and keeps the place you are looking at; Space or the middle button drags the
  slide about; undo, redo and align glide the elements to where they go.
- Dragging slides in the filmstrip holds their thumbnails under the pointer, opens a
  gap where they will land and scrolls by itself; a deleted slide folds away, Enter
  adds a slide, and a run of arrow-key nudges is one step of undo.
- A click on a text box writes in it, with the caret where you clicked.
- Bullets and numbers hang properly, nine levels deep,
  in twelve styles (disc, circle, square, arrow, check, dash, 1. 1) a. A. i. I.), with restart,
  continue and a number to start at; `- `, `* `, `1. ` and `a. ` start a list as you type, Tab and
  Shift+Tab move a level, and Enter on an empty item ends it. A marker follows its words: set the size
  of the words and the bullet follows, an empty bullet has the size of the line it came from, and a
  marker can be 25% to 400% of its words, in a colour of its own. Text can shrink to fit its box or
  resize the box, wrap off, raised and lowered, small capitals, letter spacing, change case, paste with
  its bold, links, colours and lists, and PowerPoint keeps all of it.
- Clicking away lets go: a click on empty space, on the grey round the slide or on the bare top bar
  clears the selection (one click, also when a text box is open), a click on a slide in the filmstrip
  leaves the blocks on the slide, and the name of a section picks the slides in it. Several picked
  slides go back to one when you click the slide.
- Copy, cut and paste work wherever the focus is in the editor, on blocks and on slides, with no
  permission prompt; they steer clear of the text box you are typing in. A paste is 16 down and right
  of a copy (further each time), where it was on another slide or in another deck, or in place
  (Ctrl+Shift+V); slides can be copied, cut and pasted between decks (notes, look, transition and
  sections come along), and dragging slides with Alt or Ctrl copies them. A picture, words or
  the text of a web page pasted from another program land where the pointer is.
- Layouts of your own. Design a slide, choose **Save slide as layout** and it joins the
  built-in layouts, as a live thumbnail, in the New slide menu. Edit a layout and every slide
  that uses it follows (slides keep their words and any slot you moved by hand); **Reset slide
  to layout** puts the slots back. A **Layouts** manager renames, copies, orders, edits and
  deletes them, and a layout can be marked as the one new slides start from (a third choice
  beside Blank and Same as current), which is how to give your blank slide its own background,
  footer, logo or stripe.
- Templates of your own. **Save as template** keeps a deck's colours, fonts, layouts and shape as
  a plain file in the vault's `templates/slides/` folder; the New deck gallery lists them as
  **My templates** beside the built-in ones (rename, copy, trash), and **Apply a template**
  restyles a deck without touching its words. Layouts of your own export to PowerPoint as real
  layouts.
- A better **Insert**. The menu has two levels (Text & content, Media, Shapes & lines, Data,
  Pages & links, Smart parts), each item with an icon, a line saying what it makes and its
  keys. The **Insert gallery** (Ctrl+/, or the plus on the toolbar) finds anything by typing.
  The keyboard shortcuts moved to Ctrl+Shift+/.
- **Insert → Page…** puts a page of your vault on a slide four ways: embedded (a live,
  read-only view that keeps up with the page), its contents as slide text or as a slide for
  each heading, one section of it, or a link to it. What came from a page remembers it:
  **Update from page** makes it again from the page as it is now (in one step of undo),
  **Break link** keeps what is on the slide, and a deck can update every page at once from the
  Tools menu. Links to pages open in a peek at the side from the editor (Ctrl+click), and in a
  calm panel at the side in a presentation, which Esc puts away and returns to the slide.
  Link a page from **Insert link** too.
- Web pages and embedded pages are laid out for a window of their own (Desktop 1280 by 800,
  Wide, Slide, Tablet, Phone, or a size you choose) and scaled to the box, so a page in a small
  box keeps its layout instead of being squeezed. Fit the width, the whole page or fill the box,
  or zoom from 25% to 300%: Ctrl and plus, minus or zero (and Ctrl with the wheel) zoom the
  selected page instead of the slide. In a presentation a page is looked at until you click it,
  then Ctrl and plus, minus or zero zoom it, and Esc gives the keys back to the slide.
- Decks can hold charts (bars, lines, pie), timers and QR codes, which assistants and files can
  make; the menus do not offer them yet.

### Whiteboards

- Quieter boards. Choosing something shows one small colour dot, and the colours
  open only when you press it (the keys 1 to 9 pick one, 0 takes it off). The bar
  over a selection holds just the few actions that fit what is chosen, with
  **More** for the rest. Pink, brown and grey join the six colours.
- The tools are a slim strip on the left; one small control in the lower left
  holds undo, zoom and the minimap; Present and a **More** menu sit at the top
  right. The bars rest faintly until the pointer comes, and **focus mode**
  (`\`) hides them all. Settings → Whiteboards keeps the strip at full strength,
  shows the minimap, and picks what a double-click makes: a card or a sticky.
- Sections are soft frames with a small name chip; a connector tool (`L`) joins
  things; **More → Export as an outline** copies a board as Markdown.

### Graph, calendar and web

- A **Graph** of your notes (whole vault, a project or around a page) and a
  full-screen **project overview** with saved tables.
- Subscribe to calendars by their private iCal address (Google, Outlook, iCloud,
  your own domain): events show beside your notes, with an hour grid in the week.
  Read only; nothing is written to your notes.
- **Sign in with ChatGPT** as an AI provider, using your own ChatGPT plan.
- An optional **built-in browser tab** with a capture bar, and a Chrome and Edge
  extension that sends pages and selections into a **Captures** table. Both are
  off until you turn them on.

### Diagrams

- A **Diagrams** view for flowcharts, architecture drawings and sketches,
  drawn in draw.io (diagrams.net, Apache-2.0). The editor is not part of the
  download: **Install diagram editor** fetches one pinned version, checks its
  size and checksum, and keeps it in Kasten's data folder; **Remove** takes it
  away again. It runs in a sandboxed frame with no way out to the web.
- A diagram is a plain `.drawio` file with a `.drawio.svg` picture beside it.
  Pages, slides and whiteboards show the picture, so nothing needs the editor
  to see a diagram. The two files move, rename, duplicate, go to the trash and
  come back together, and links and whiteboard cards follow a renamed diagram.
- Changes are saved as you draw, with the picture; a diagram changed
  elsewhere while open keeps your version in a copy beside it.
- `/diagram` and `![[name.drawio]]` show a diagram in a page and edit it in
  place; a whiteboard card shows its picture; **Insert → Image → Diagram…**
  puts one on a slide as a PNG, and **Edit diagram** changes it from there.
- Agents list, read, make and rewrite diagrams as XML in the MCP server and the
  chat; a rewrite that takes a lot out, and anything sent to the trash, wait
  for review.

## 1.0.0

- Windows installer for local use.

## 0.1.0

The first public release, for Windows, macOS and Linux.

### Write and plan

- Pages made of blocks: `/` for any block, `[[` to link a page,
  covers, icons, callouts, toggles, tables, equations and colours, with
  properties under the title and find and replace (Ctrl+F).
- A new page is a draft until you type: nothing is written for a page you
  leave empty.
- Per-page font, width and text size, kept in the page's own frontmatter.
- Project homes, a task board of every to-do, a calendar of your notes by
  day, and a journal with today as a full page and the days before beside
  it.
- Whiteboards with cards, stickies, shapes, arrows and a pen, presented
  section by section.
- An inbox, a card library, and tags that become databases shown as a
  table, a board, a gallery or a calendar.
- A PDF reader whose highlights become cards that link back.
- Import from Obsidian, Notion, Heptabase or any folder of Markdown.

### Slides

- A slide editor for decks that are plain `.deck` files in
  the vault: themes, layouts, shapes, tables, pictures, sections, speaker
  notes, undo, and find and replace.
- Parts that draw themselves: code with syntax colours and lines in focus,
  LaTeX formulas, conversations, token charts, card grids, citations, step
  labels, embedded pages and video.
- Steps and a Morph transition. Present full screen with a presenter
  window (notes, next slide, timer), an overview, a laser pointer and
  backup slides.
- Export to PowerPoint (a slide for each step), PDF, PNG, Markdown and one
  web page that plays offline. Import from PowerPoint as new slides, as a
  replacement, or as a new version that keeps your edits.
- A lint for slides on demand (Tools → Lint), with thumbnail badges you can
  switch on. Nothing warns while you work.
- Full screen inside the app (the sidebar and tabs go away), a handle on
  every block to move it, one-key adds (T for a text box, R, O, L, A, I),
  and Ctrl+A that fits the place: elements, a text box's text, the outline,
  the filmstrip.
- An assistant tab beside the slide that knows what you have selected and
  marks what it changed with a star until you accept it, and a deck from a
  note.
- A picture gallery that shows where each picture is used, figures clipped
  from PDFs at 300 dpi that cite their paper, and citations from `.bib`
  files in the vault.
- Deck tools in the MCP server and the chat, within the same guardrails
  (removing many slides waits for review), and a `slides` command with its
  own MCP server for decks outside a vault.

### Start ready

- Six starter kits (Daily planner and journal, Second brain, Zettelkasten,
  Getting Things Done, Student, Research), each added in one step that
  Undo takes back.
- 58 templates, with `{{date}}`, `{{time}}`, `{{weekday}}`, `{{week}}`,
  `{{month}}` and `{{year}}` filled in. Type `/` on an empty page and pick
  Template… to start from one, and save any page as a template.
- A journal template, and a default template for each project.

### AI that asks first

- Ask AI about a selection while you write, continue writing or summarise
  a page. Nothing enters the page until you choose Replace or Insert, and
  one Undo takes it back.
- A chat that reads your open pages and writes new ones, and brainstorming
  on a board.
- Any MCP agent, such as Claude Code, through the app's own `--mcp`
  command, within the same guardrails: no deletes, no history rewriting,
  large changes waiting for review, and a whole session undone in one
  step.
- Provider presets for Anthropic, OpenAI, OpenRouter, Ollama, LM Studio and
  vLLM, a model list, and a test before saving. Bring your own model, or
  none.
- Lock a page for agents from its menu.

### Keep everything

- Every change is a git commit in the vault and can be taken back; the
  whole vault can go back to any point, and that is undoable too.
- Backup to GitHub with Sign in with GitHub, to any git host with a token
  or SSH, or as a checked daily backup file in a folder Dropbox, Google
  Drive or OneDrive keeps, with the newest seven kept.
- Restore on a new computer, and Get latest to bring changes across
  without overwriting: when both computers changed a page, both versions
  are kept.
- Empty trash, for a person only and undoable.
- Unsaved typing survives a crash, and a vault in a synced folder is
  flagged.

### On the desktop

- Quick capture from anywhere with a global shortcut
  (Ctrl+Shift+Space, or Cmd+Shift+Space on a Mac), into the Inbox, today's
  journal or a project.
- A tray icon, and closing the window keeps Kasten running; Settings can
  switch this off.
- One window, back where you left it, with no white flash on start.
- Updates install in place after their signature is checked.
- Notifications when a backup is failing or an update is ready.
- A motion setting, a light and dark theme, and the Inter typeface.

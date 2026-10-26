# Smart pages

A smart page is a page that draws itself from your notes: a dashboard, a tracker, a
map, a timeline, a board, a calendar or a gallery that always shows what your notes
say now. The data stays in your notes; the page only looks at them. Change a note and
the page follows. Change something on the page (tick a to-do, move a card) and the
note changes.

- [Make one](#make-one)
- [Look at it, edit its code, see its history](#look-at-it-edit-its-code-see-its-history)
- [Allow to run](#allow-to-run)
- [How it is kept safe](#how-it-is-kept-safe)
- [Use one inside another page](#use-one-inside-another-page)
- [Present, print and export](#present-print-and-export)
- [Templates](#templates)
- [Smart pages and AI agents](#smart-pages-and-ai-agents)
- [Routines with Claude Code and Codex](#routines-with-claude-code-and-codex)

## Make one

- **From a starter:** **+ New → New smart page** (on Home, a tab's **+** menu or a
  project's home), then pick **Dashboard**, **Tracker**, **Gallery**, **Map** or
  **Timeline**. Or type `/smart` in the capture field, or use *New smart page* in the
  command palette.
- **From a page you have:** its ••• menu → **View → Turn into smart page…**, then
  pick a starter. Your text stays as the page's notes.
- **Ask an AI:** in the chat, **Make a smart page from this**. The assistant proposes
  it and you review it. See [Smart pages and AI agents](#smart-pages-and-ai-agents).
- To go back: **View → Back to a normal page**. Nothing is deleted; the page stops
  drawing itself.

A smart page is an ordinary page file with `layout: smart` in its header, plus a folder
beside it, named like the page with `.smart` on the end, holding its code. The folder
moves, renames, duplicates and goes to the trash with the page. [The vault
format](vault-format.md#smart-pages) describes it.

## Look at it, edit its code, see its history

A smart page opens in its smart view, with three tabs at the top:

- **Smart** is the page itself.
- **Notes** is the page's own text, an ordinary page you can write in. It is also what
  agents and search see.
- **History** lists earlier versions of the page's code. Pick one to see what changed,
  and **Restore this version** puts it back as a new change you can **Undo**. It
  restores the code only, not the page's text.

**Edit code** (a button on the page, or *Edit this smart page's code* in the palette) opens
the files on the left, an editor in the middle with colours for HTML, CSS and
JavaScript, and the page itself beside it, which reloads after each save. Ctrl+S saves
now; saving also happens as you type. If a file changed elsewhere meanwhile you choose
**Keep mine** or **Use the file on disk**. A **N errors** button under the page lists
what went wrong in the page, newest first, with **Clear errors**.

The page options (a button on the page) include **Allow pictures from the web**, which
is off, and explained below.

Words inside a smart page's `index.html` are found by search.

## Allow to run

A page you made yourself runs at once. A page an **agent** made while you had agents on
**Review everything** (or that you accepted from the review queue) waits for you: you
see a card, "Made by Claude Code", with **Allow to run**. One click, once. The same
applies to a copy of such a page. Look at it first: **Notes** and **History** are
available before you allow it. After you allow it, later changes to it by agents run
without asking again (and are in History, with Undo). With History off, KastenFlow
cannot tell who made a page ("Not known who made this"), so in Review every page
waits for the click.

A page an agent made in Balanced or Autonomous mode runs at once, because you were not
asking to look at what agents write. It still runs in the same closed box, below. See
[Agent modes](agents.md).

**Settings → Pages → Smart pages → Run smart pages** is a master switch. Off, every
smart page stops at once, shows its notes and a line, "Smart pages are off", with **Turn
on**.

## How it is kept safe

A smart page is code, so it runs in a closed box.

- It runs in a **sealed frame** inside KastenFlow. It can use only the files in its own
  folder.
- It has **no network**. It cannot load a web page, send anything to a website or talk
  to another program. (Pictures from the web are the one exception, and only if you
  tick **Allow pictures from the web** for that page. That setting warns you in words:
  a page that may load pictures could send what it has read to any website, by putting
  it in a picture's address. Leave it off unless you need it.)
- It cannot reach your computer, your vault's files, KastenFlow's own commands or other
  pages' files. It cannot open a new window or leave for another address.
- It **asks the app for your notes**, through a short list of requests: look up notes of
  a tag (with filters and sorting), read, search, list, today's journal, a board, tasks,
  a project, and open a note. To change something it can set a property, add tags, add
  a note, append text or tick a to-do. A page cannot ask more than 50 times a second.
- Those changes obey the **same rules as an agent's**: locked notes are refused, and if
  the vault or project is on Review everything, a change waits for you. A page is never
  trusted more than an agent.
- Files are limited: text and pictures only (html, js, css, json, svg, txt, png, webp,
  jpg), no programs; each file 2 MB at most, the folder 10 MB, 500 files.
- Pages that are open but out of sight are paused.

## Use one inside another page

Write `![[Page name]]` on a line of its own to show a smart page inside another page, or
`![[Page name#view]]` to show one of its named views. It starts when you scroll to it.
A page can run **four** smart blocks at once; further ones say **Click to run**. The
block follows the size the page asks for (never taller than 1,200 pixels).

## Present, print and export

- **Present this page** shows it full screen; Esc leaves.
- **Print** uses the printing style of the page.
- **Present & export → Export as HTML file** saves one file with the page and its data
  as they are right now. It works in any browser, offline, and cannot change anything.
  Show the Smart view once first, so there is something to save. What the page only
  reads after a click is not in the copy.

## Templates

**Save as smart template** (the page's View submenu; *Keep this smart page as a template* in
the palette) keeps the page's code as a template in your vault's `templates/smart/`
folder. It then appears with the starters under **My
templates** when you make a smart page. A hand-made template is checked as a whole and
refused if any part is not allowed. A page waiting for **Allow to run** cannot be
saved as a template.

Projects have templates of their own too: **Save as a setup…** in a project's menu keeps its
structure for new projects.

## Smart pages and AI agents

Agents (Claude Code, Codex, the chat) can make and fix smart pages when you ask:

- `smart_create` makes a page and its files as one change; `smart_check` looks for
  mistakes (HTML not closed, web addresses, files that are not there, queries that
  do not match their tag, size limits); `smart_read` shows the files and the errors the
  page reported while it was open in the app; `smart_edit` and `smart_write_file`
  change files; `smart_delete_file` sends one to the trash. See [MCP tools](mcp-tools.md).
- They get instructions and a short reference to the page's ready-made parts (kanban,
  calendar, map, timeline, countdown, gallery, table, stat, bar, line, donut, sparkline
  and legend), so a page uses the same look as the app and follows your light or dark
  theme.
- An agent can make the page and read what went wrong, but it cannot see the picture of
  it: it says that it could not run the page, and you look.
- An agent cannot turn a page into a smart page by changing its header, and a page
  an agent made while you hold agents to Review everything does not run until you
  allow it.
- The skill `skills/kasten-smart-pages` teaches Claude Code how to do this well, with
  three worked examples.
- In the chat there are three actions: **Make a smart page from this**, **Improve this
  smart page's layout** and **Fix its errors**. They propose changes for you to review.

## Routines with Claude Code and Codex

A routine is an agent run that repeats, such as a daily check of the conference notes.
Smart pages suit it: the routine updates the notes (one `batch` call, so one run is one
change you can undo), and the page shows the result the next time you look. The
routine and the page never need to talk.

- Connect Claude Code with `claude mcp add ...` (see [Connect AI
  agents](guide.md#connect-ai-agents)). For Codex, run
  `kasten-mcp --vault ~/Notes --setup codex`: it prints a block to paste into
  `~/.codex/config.toml`. It only prints.
- Each run is a session named after the routine ("routine: conference tracking"). Home →
  **Agents today** and History → **Today by agents** show what each did, with **Undo**
  for a session.
- Routines work with KastenFlow closed, because they talk to the `kasten-mcp` program.

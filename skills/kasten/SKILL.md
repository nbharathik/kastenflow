---
name: kasten
description: Work in the user's KastenFlow notes vault through the kasten MCP server - capture ideas to the inbox, add to journal days, edit sections of pages, link related notes, set tag properties, build whiteboards, draw diagrams and make slide decks. Use when the user asks to note, capture, organise, plan, brainstorm or look something up in their notes, projects, journal or boards, to draw a flowchart or an architecture diagram, or to turn notes into a talk.
---

# Working in a KastenFlow vault

KastenFlow keeps the user's notes as Markdown files in one folder: cards (short
notes), pages (long ones), a journal (one page per day), projects, tags with
properties, and whiteboards. You reach it only through the `kasten` MCP
tools. Every change you make is a git commit in your session, so the user can
see it and undo the whole session with one click. Work as a careful
assistant in someone else's notebook.

## Conventions

- **Capture first.** A quick thought, link or to-do the user mentions goes
  to the inbox with `capture`. The first line is the card's title and the
  rest its body (the title is not repeated), so make it a short, specific
  phrase ("Ask the team about the CHI venue"), not "Note". The
  user files cards into projects later; don't file for them unless asked.
- **The journal is for the day.** Use `journal_append` for things that
  happened or are planned today, such as meeting notes, decisions and to-dos
  (`- [ ] …`). Put them under a heading of the day when one fits
  (`under_heading: "Notes"`). The date defaults to today in UTC; pass
  `date` when the user's local day differs.
- **Link, don't copy.** Mention other notes as `[[Their title]]` (exact
  title, found with `search` or `list_notes`). When several notes share a
  title, name the one you mean by its path, without `.md`:
  `[[projects/trip/pages/plan|Plan]]`. Links are how the user finds related
  work again. Prefer linking an existing note over creating a
  near-duplicate. `[[2026-10-01]]` links a journal day.
- **Edit the smallest part.** Add with `append`, or change one section
  with `replace_section`, which touches only that heading's text. Never
  rewrite a whole note when a section edit will do. `propose_edit` is for
  real rewrites and always goes to the user's review queue.
- **Many changes at once go in one `batch`** (tagging twenty notes, filing a
  pile of cards): see "Changing things safely" below for the rule and the
  tools a batch can hold.
- **Read before you write.** `read_note` a page before editing it, so your
  change fits its structure and headings. Keep the user's voice and
  formatting. Don't reformat text you were not asked to change.
- **Lay a page out by its blocks.** To make columns, toggles, callouts,
  tables, ticked tasks or embeds, read the page with `read_page_blocks` and
  change it with `edit_page` (the recipe below). Each step names blocks by the
  id and hash you were given, so the hash must match: if a block changed since
  you read it (the tool says "changed since"), nothing was written; read the
  page again and redo the steps with the new ids. Prefer it to rewriting a page.
- **Properties go through tags.** A note tagged `paper` has the
  properties in `tags/paper.yaml`. Look at `list_tags` or `query_tag` first,
  then set values with `update_props`: select options as spelled in the
  schema, dates as `YYYY-MM-DD`, and relations as note titles or paths
  (a path when several notes share the title), which are stored as ids.
  Propose schema changes with `update_tag_schema`; they wait for review.
- **Tag databases are the user's boards and tables.** `query_tag` with
  `view` (such as `"Board"`) returns the notes as the user sees that view,
  and a kanban view comes with its columns and counts. Moving a card to
  another column is `update_props` on its select property, such as
  `{"status": "Done"}`.
- **Brainstorm on boards.** For ideas, plans and comparisons, make cards
  (`create_note`, type `card`), then put them on a whiteboard:
  `create_board`, then `add_to_board` with `layout: "grid"` or
  `"cluster_by_tag"`. Link them with `connect`, using short labels such as
  "leads to" or "blocks", and gather them with `group_on_board` under a
  section title. To change a board in other ways, use `board_edit` with typed
  steps: reword a sticky, shape, section or link (`set_text`), add a web link,
  section or shape, give a shape another outline (`reshape`), take an arrow off
  (`unlink`), show a note's card as its title or in full (`card_size`) and fold
  a section (`collapse`), besides moving, resizing and restyling. All steps are
  made or none; taking many cards or arrows off at once waits for the user.
- **Projects.** A project is a folder under `projects/`; pass its folder
  name (as `list_notes` shows it in `project`) to `create_note` or
  `move_note`. Without one, cards go to the inbox and pages to the library.

## Changing things safely

- **Many changes: one `batch`.** When you are about to make more than a few changes, send one `batch` of up to 100 (each `{"tool": "append", "args": {...}}`, in order, at most 1 MB) instead of many calls. It is all or nothing: if one change is refused you are told which one and nothing is changed; if any change would wait for the user's review, the whole batch waits as one proposal; otherwise the user can take it all back with one undo. A batch can hold these tools: `capture`, `create_note`, `append`, `replace_section`, `update_props`, `add_tags`, `remove_tags`, `rename_note`, `move_note`, `journal_append`, `create_board`, `add_to_board`, `connect`, `group_on_board`, `edit_page`, `set_parent`, `reorder_children`, `set_tag_views`, `set_view_order`, `update_tag_schema`. Everything else (`trash_note`, `create_project`, `set_project_state`, `propose_edit`, `undo_session`) is called on its own. In a batch, `update_tag_schema` only makes the schema of a tag that has none, and it makes the whole batch wait for the user. A change cannot name a note that an earlier change in the same batch makes: make that note first.
- **Modes: how much you may do alone.** The user sets this for the whole vault, or for one project, and `server_status` shows it as `mode`. In Review, every change you make waits as a proposal for the user. In Balanced (the usual), ordinary changes are made at once and bigger or riskier ones wait. In Autonomous, which lasts for a set time, your changes are made at once, even ones that would wait, and the user can go back to how things were before your session. In every mode, deleting for good, locked notes and hidden folders stay off limits. Never try to change the mode, and never turn plugins or setups on or off: those are the user's choice, and no tool does it for you. Do not look for another way round.
- **Proposals.** A result with `"status": "pending_review"` means the change waits for the user. Say in a line what is waiting, then move on. Do not send the same change again, and do not split a held change into smaller ones to get it through.
- **Show live views, do not copy them.** Put an embed on a line of its own: `![[tags/projects.yaml#Board]]` for a tag's view (the view's name after the `#`, as `query_tag` lists them), `![[projects/trip/plan.canvas]]` for a whiteboard, `![[projects/trip/flow.drawio]]` for a diagram. Leave an embed line exactly as it is when you edit around it.
- **Sub-pages and their order.** `set_parent` puts a page inside another page (leave `parent` out to take it out again). `reorder_children` puts a page's sub-pages in the order you give, and sub-pages you leave out follow alphabetically; an empty list goes back to alphabetical. Order pages with it, never by renaming them. A page cannot go inside, or be put in order inside, a locked page.
- **Project state has its own tool.** `update_props` refuses `status`, `health`, `next_action`, `last_review` and `review_after` on a project's page, and says so. Use `set_project_state` for those. `create_project` can start from a setup (`research`, `writing` or `presentation`, or one the user saved: `list_setups` gives its id). `save_project_setup` saves a project as a setup new projects can start from, and always waits for the user.
- **Locked notes are read-only.** Every change to one is refused, in a batch too, and so is anything that would change a locked note on the way (a rename that rewrites its links, a diagram file it names). Read it if you need to. Tell the user it is locked; do not work around it.
- **Edit a page by its blocks, byte for byte.** `edit_page` steps name blocks by the id and hash `read_page_blocks` gave. They are made together or not at all, and a block you did not name keeps every byte of its text, including text and settings you do not understand. If a block changed since you read it, nothing was written: read the page again and redo the steps. Never rewrite a whole page to move one block.
- **What the user is looking at.** `get_selection` gives the text the user has selected in KastenFlow: up to five pieces, each with its file, heading and place (for a slide, the selected elements). Call it when they say "this", "here" or "the selected part". It needs the app open, and says plainly when nothing is selected, the selection is out of date or the app is closed. It is the user's own text, shared for two minutes after you ask.
- **Routines.** A run nobody watches (Claude Code or Codex over stdio, with the app closed) is one session: keep it to one `batch`, so it is one change to take back. `activity_digest` says what agents did lately and what still waits for the user.

## Every tool, by area

- Look and read: `search`, `read_note`, `list_notes`, `query_tag`, `get_journal`, `get_history`, `list_tags`, `list_templates`, `list_trash`, `list_tasks`, `list_projects`, `list_comments`, `list_collections`, `list_references`, `list_sessions`, `activity_digest`, `server_status`, `get_selection`
- Write notes: `capture`, `create_note`, `append`, `replace_section`, `update_props`, `add_tags`, `remove_tags`, `rename_note`, `move_note`, `journal_append`, `journal_day`, `duplicate_note`, `restore_note`, `set_note_meta`, `apply_template`, `trash_note`, `propose_edit`, `set_task`
- Many changes at once: `batch`
- Pages by blocks: `read_page_blocks`, `edit_page`
- Sub-pages: `set_parent`, `reorder_children`
- Projects: `create_project`, `set_project_state`, `list_setups`, `save_project_setup`
- Tags and templates: `update_tag_schema`, `set_tag_views`, `set_view_order`, `create_template`, `update_template`
- Comments, saved searches and references: `add_comment`, `resolve_comment`, `create_collection`, `update_collection`, `add_reference`
- Whiteboards: `list_boards`, `read_board`, `create_board`, `add_to_board`, `connect`, `group_on_board`, `board_edit`
- Diagrams: `list_diagrams`, `get_diagram`, `create_diagram`, `update_diagram`, `trash_diagram`, `diagram_describe`, `diagram_find_shapes`, `diagram_lint`, `diagram_preview`, `diagram_new`, `diagram_edit`, `diagram_export`, `rename_diagram`, `move_diagram`, `duplicate_diagram`
- LaTeX (when the plugin is on): `latex_list`, `latex_read`, `latex_edit`, `latex_build`, `latex_create_document`, `latex_write_file`, `latex_append`, `latex_delete_file`, `latex_add_asset`, `latex_cite`, `latex_send_page`, `latex_export_pdf`, and with the Diagrams plugin on too `diagram_to_latex_figure`
- Smart pages (when the plugin is on; while it is off only `request_smart_pages` is listed, and it asks the user): `smart_create`, `smart_read`, `smart_edit`, `smart_write_file`, `smart_delete_file`, `smart_check`, `smart_render`, `request_smart_pages`
- Undo: `undo_session` takes back your own session; anything of another session waits for the user.

Slide decks have their own tools (see "Slide decks" below).

<!-- PLACEHOLDER formulas-timeline: formulas and the timeline view. Not written yet; fill it in here. -->

## Setups, the digest and routines

- **Setups.** `list_setups` gives the ways a new project can start (the built-in ones and the setups the user saved), each with the `id` that `create_project` takes as `setup`. `save_project_setup` turns a project into a setup; it changes nothing in the project and always waits for the user.
- **The digest.** `activity_digest` (`since`: `24h`, `3d`, `today`, a day like `2026-10-23`, or a time; the last 24 hours when left out) gives, for each agent session in that time, the client's name, how many changes it made, the notes it touched, how many of its proposals still wait, and whether it can be taken back. The user's own edits are never in it. Call it first in a routine to see what the last run did, and use it to tell the user what changed. Say plainly when it is empty.
- **Routines.** A routine is a Claude Code or Codex run on a schedule. It connects to `kasten-mcp` over stdio, so it works with the app closed (`kasten-mcp --setup claude-code` and `kasten-mcp --setup codex` print the lines that connect). Each run is a session named as the client names itself in the handshake, so two runs show as two sessions with the same name and different start times; a name you write in a tool call is not read as who you are.
- **A routine's run.** Read what it needs, then make all its changes in one `batch`: the run is one change in History and the user takes it all back with one undo. It may stamp `last_checked` with `update_props` (put in the same `batch`) on the notes it looked at, where the note has that property. It cannot change the mode, open a plugin or turn a setup on; changes that wait for review are the user's to decide, so say so in the run's last line and do not send them again.

## Smart pages

**When to make a smart page.** A smart page is a folder of code (`index.html`, `app.js`, a `smart.yaml`) that the app runs as a live page. Make one for a dashboard, a tracker, a map, a timeline, a calendar, a board or a gallery of the user's notes. Write prose and ordinary notes as a normal page. The data always lives in notes and is never written into the HTML: the page reads the notes, so editing a note changes the page. The page has no network: no web address, no `fetch`, no script from a CDN. It may use only its own files and the kit at `smart://kit/1/`.

**How.** Make the page in one call with `smart_create` (a title, the files, and the queries it reads); only a person turns an existing page into a smart page, so `set_note_meta` refuses `layout: smart`. Then run `smart_check` and fix every error it reports. After the user has opened the page, `smart_read` lists the errors the app saw when it ran it: read them and fix them with `smart_edit` (the file's `base_hash`, then `replace` steps) or `smart_write_file`. `smart_check` does not run the page and `smart_render` does not draw it, so say what you could not see.

**The kit in brief.** Load `smart://kit/1/kit.js`, the `lib/` files and only the components you use, then call `kasten.watch({ tag: "paper" }, notes => ...)` to keep notes live (also `kasten.query`, `kasten.read`, `kasten.open`, and, to change a note, `kasten.update({ id, props })`, `kasten.addTags({ id, tags })`, `kasten.append({ id, md })`). Each component is `kit.components.<name>(target, { label, data })` and gives back an object with `update(data)`: `stat`, `table`, `bar`, `line`, `donut`, `sparkline`, `legend`, `kanban`, `timeline`, `calendar`, `map`, `gallery`, `countdown`. The whole reference and three finished pages (a conference tracker, a reading dashboard, a project status board) are in the resource `kasten://smart/kit` and the `kasten-smart-pages` skill.

**On a dashboard page.** A smart page can stand in a column beside a view, as an embed of its title, like any other view.

## Building a dashboard page

Read a page with `read_page_blocks` (its blocks, each with an id and a hash), then change it with `edit_page` steps that name blocks by those ids and hashes. All steps are made together or none is, and a block you did not name keeps every byte. If a block changed since you read it you are told so and nothing is written: read the page again and use the new ids and hashes.

A dashboard shows live views, not copies:

1. Add each view on a line of its own with an `insert` step, or an `embed` step after a block: `![[tags/projects.yaml#Board]]` for a tag's view, `![[projects/trip/plan.canvas]]` for a whiteboard, `![[projects/trip/flow.drawio]]` for a diagram, `![[library/talk.deck]]` for a deck.
2. Put a short summary first: an `insert` step with two or three sentences and links, then a `callout` step around it (kind `tip` or `note`, with a title).
3. Read the page again; the new blocks have ids now. Set neighbouring views side by side with a `wrap_columns` step (`blocks`, and a `ratio` such as 40/60). Two or three columns read best. `unwrap_columns` takes columns apart.
4. Fold what the reader does not need first, such as long tables or notes, into a `toggle` step with a title.

Read the page once more to check the order. `deck_from_note` turns a finished page into slides. In a chat that previews changes, the page shows as one change for the user to accept or reject.

## LaTeX documents

When the LaTeX plugin is on, a LaTeX document is a folder with a root `.tex` file, and `latex_list` shows them. Start one with `latex_create_document`, or from a page with `latex_send_page` (all of it or one section). Read a file with `latex_read`: it gives the text and its `hash`; for a long file give `around_line` or `lines` (such as 40-80) to get numbered lines only. Change a small part with `latex_edit`: the `search` text must be in the file once, and `base_hash` must be the hash you read. Write a whole file with `latex_write_file` (leave out `base_hash` for a new file), add text with `latex_append` (at the end, or after a piece of the file you give as `after`: use it in the root file, whose end is past `\end{document}`), and take a file out with `latex_delete_file` (it goes to the trash). If you are told the file changed since you read it, nothing was written: read it again and redo the change. A locked document is read-only. Taking out much of a file, a root file, and anything in a project set to review waits for the user's review.

Figures are PNG (or JPG or PDF), never SVG. Kasten never runs Python or any program: make a chart on your side and send the PNG with `latex_add_asset`, which gives back the path for `\includegraphics`. Cite a reference from the user's References with `latex_cite` and its key from `list_references`: it writes `\cite{key}` and keeps the entry in `references.bib` once. A citation or a sent page waits where the user reviews changes; a picture does not.

`latex_build` does not run TeX itself: it tells you what the app's last build said, with the file and line of each error, and when a file changed after it. To build now, call it with `wait` set to true: the app builds and gives the errors and warnings, the page count and the PDF's size. Building needs the app open, and you are told if it is closed or the build is too slow. To fix errors, make small `latex_edit` steps, then build again with `wait` and compare the counts; when your changes wait for the user's review, that build is of the text you proposed. When the build is clean, `latex_export_pdf` keeps the PDF in the document's folder; it waits for review where the user reviews changes. Leave the user's wording, commands and packages alone unless a fix needs them changed, and say what you changed.

A diagram becomes a figure with `diagram_to_latex_figure`: the KastenFlow app draws it as a PNG, the call keeps it in the document's figures folder and gives back the `\includegraphics` line, with the width you ask for. It needs the app open and both the Diagrams and the LaTeX plugins. `diagram_export` with format png keeps the same kind of picture in assets/.

## Slide decks

The same server offers the deck tools (`list_decks`, `get_deck`, `create_deck`,
`deck_from_note`, `update_elements` and the rest). The `kasten-slides` skill
teaches the loop of outlining, building, linting and fixing; this is what is
different in a vault.

- **Name a deck the way `list_decks` shows it**: by path
  (`projects/photo-organiser/decks/talk.deck`, `library/talk.deck`), or by its
  title or file name when only one deck has it. A new deck goes to the library,
  or to a project when you pass `project` (its folder name, as `list_notes`
  shows it). A deck is never replaced.
- **Start from what the user wrote.** `deck_from_note` makes a deck from a
  note (and from the notes it links to, with `include_linked`): its headings
  become slides, its lists the slides and its prose the speaker notes, with
  its pictures and the citation keys the `.bib` files know. Refine it with
  the other tools afterwards.
- **Lint after every batch.** Each change comes back with lint's problems on
  the slides it touched. Run `lint_deck`, fix what it reports by its hints,
  and only then tell the user you are done.
- **Your work is marked.** What you make or change in a deck gets a small star
  for the user until they accept it or edit it themselves. You cannot accept
  it or take the star off. Say which slides you changed so they know where to
  look.
- **Pictures live in `assets/`.** `add_asset` keeps one there (the same bytes
  are the same picture), `search_assets` finds them, and `place_image` puts
  one on a slide. `export` writes the PowerPoint file to `assets/`, and
  `import_pptx` reads a `.pptx` of the vault into a new deck, with its
  pictures, as one change.
- **A few more deck tools.** `move_slides` moves some slides (by id) to a
  position without listing all of them, `set_rich_text` writes a text box's
  words with marks Markdown cannot say (a colour, a size, a highlight, a
  link), `set_slide_steps` sets how many clicks a slide has, and
  `apply_deck_template` puts the look of another deck, such as one of the
  user's templates in `templates/slides/`, on a deck while every slide keeps its
  words. Templates are read, never changed, and a deck's edits wait for review
  like any other write in Review mode.
- **Rendering may not be available.** If `render_slide` or `render_grid` say
  so, rely on `lint_deck` and don't retry.
- Decks are text, so a change of the user's made a moment ago is kept: your
  change is applied to the deck as it is now. If the two cannot be put
  together, the tool says the deck changed since; read it again and redo the
  change.

## Diagrams

Flowcharts, architecture drawings and sketches are draw.io diagrams: a
`.drawio` file (uncompressed `mxfile` XML) with a `.drawio.svg` picture beside
it. **Draw them with the typed tools, not with XML**; the `kasten-diagrams`
skill has the whole method and the style catalogue. In short:
`diagram_new` (from a `spec`, a Mermaid flowchart or a `template`) lays a
diagram out; `diagram_describe` reads it; `diagram_edit` changes it with steps
(`add_node`, `add_edge`, `update`, `move`, `group`, `restyle`, `delete`,
`layout`, ...); `diagram_lint` and `diagram_preview` check it;
`diagram_find_shapes` looks icons up; `diagram_export` keeps an SVG in
`assets/`. `list_diagrams`, `get_diagram`, `create_diagram`, `update_diagram`
and `trash_diagram` also exist.

- **Name a diagram the way `list_diagrams` shows it**: by path
  (`projects/photo-organiser/diagrams/login-flow.drawio`) or by its title. A new
  one goes to the library, or to a project when you pass `project`. A diagram is
  never replaced: a name that is taken is numbered.
- **Read before you change.** `diagram_describe` gives ids, labels, kinds and
  places. Steps are applied to the diagram as it is when they run, so a change
  the user made a moment ago is kept. A layout that moves most of the boxes of
  a diagram the user arranged waits for review.
- **Raw XML is for files you were given.** `get_diagram` gives the XML;
  `create_diagram` and `update_diagram` take whole XML. With `update_diagram`,
  keep the `id` of every cell you do not mean to change: a change that takes
  more than 40% of the cells out (an id written again counts as taken out)
  waits for review. If the user changed the diagram meanwhile, theirs stays and
  yours is kept in a copy beside it (`status: "conflict"`, with its path).
- **The picture.** What you make or change is drawn with a simple built-in
  picture (a draft) at once; the diagram editor draws its own the next time
  the diagram is open, and the draft never replaces a picture the editor drew
  for the same version. Show a diagram in a page with `![[name.drawio]]` on a
  line of its own.
- `trash_diagram` always waits for the user.

## Guardrails you will meet

- A result with `"status": "pending_review"` means the change waits for the
  user as a proposal (id in `proposal`, the reason in `reason`). Tell the user
  briefly what is waiting and move on; don't retry the same change.
- Reviews are triggered by removing more than 40% of a note, touching more
  than 25 notes in 10 minutes, more than 5 trashes in a session, full
  rewrites, tag schema changes and every template made or changed
  (`create_template`, `update_template`). Batch fewer, smaller changes.
- For decks: taking more than 3 slides out of decks in 10 minutes waits for
  review, even in a session the user trusts. Slides count when they are
  removed and when they are left with nothing on them (`delete_elements`
  on all of a slide's elements), and a batch with `replace_deck` counts every
  slide it puts something else in place of. Added up over your calls, not
  one call at a time: splitting a large removal into small ones is still a
  large removal. `trash_deck` always waits, and so does `trash_diagram`.
- Locked notes, hidden folders, writes over 200 KB (for a deck, what you
  sent, not the deck's size) and any other write to `templates/` are refused.
  Say so and suggest what the user could do; don't work around it.
- Pictures and files you add to `assets/` are refused past 10 MB each, 30 in
  10 minutes or 50 MB in 10 minutes (the user can change these in Settings →
  AI agents). A PowerPoint import that would go past one comes in not at all,
  and leaves nothing behind.
- Nothing is deleted: `trash_note` moves a note, with every sub-page
  inside it, to the trash with your `reason`, and the user can restore it.
  Each sub-page counts toward the trash limit.
- Every write result carries your `session` id. If the user wants your work
  gone, they can run `kastenflow undo-session <id>` or use History in the app.

## Setup (for the user)

The installed KastenFlow app is the MCP server (`kasten-app --mcp`). Settings →
AI agents in the app copies these lines with its full path.

```sh
# Claude Code, over stdio (the vault must keep history)
claude mcp add --scope user kasten -- kasten-app --mcp --vault ~/Notes

# Clients that connect by URL: http://127.0.0.1:7433/mcp with a bearer token
kasten-app --mcp --vault ~/Notes --http
# token: ~/Notes/.kasten/cache/mcp-token
```

A build from source can use `kasten-mcp` with the same arguments.

An agent with shell access can bypass MCP. Add deny rules for destructive
commands on the vault path (for example `rm`, `git reset`, `git push --force`
on `~/Notes`) in Claude Code's permission settings, and keep a protected git
remote as the backup (see the README).

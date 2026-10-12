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
- **Read before you write.** `read_note` a page before editing it, so your
  change fits its structure and headings. Keep the user's voice and
  formatting. Don't reformat text you were not asked to change.
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
  section title.
- **Projects.** A project is a folder under `projects/`; pass its folder
  name (as `list_notes` shows it in `project`) to `create_note` or
  `move_note`. Without one, cards go to the inbox and pages to the library.

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
- **Rendering may not be available.** If `render_slide` or `render_grid` say
  so, rely on `lint_deck` and don't retry.
- Decks are text, so a change of the user's made a moment ago is kept: your
  change is applied to the deck as it is now. If the two cannot be put
  together, the tool says the deck changed since; read it again and redo the
  change.

## Diagrams

Flowcharts, architecture drawings and sketches are draw.io diagrams: a
`.drawio` file (uncompressed `mxfile` XML) with a `.drawio.svg` picture beside
it. The tools are `list_diagrams`, `get_diagram`, `create_diagram`,
`update_diagram` and `trash_diagram`.

- **Name a diagram the way `list_diagrams` shows it**: by path
  (`projects/photo-organiser/diagrams/login-flow.drawio`) or by its title. A new
  one goes to the library, or to a project when you pass `project`. A diagram is
  never replaced: a name that is taken is numbered.
- **Write the XML yourself.** `create_diagram` takes `xml`; without it the
  diagram starts blank. The shape is `<mxfile><diagram name="Page-1">
  <mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>` then the
  cells, then the closing tags. A box is an `mxCell` with `vertex="1"`,
  `parent="1"`, a `value` (its label), a `style` such as
  `rounded=1;whiteSpace=wrap;html=1;` and an `mxGeometry` (`x`, `y`, `width`,
  `height`, `as="geometry"`). An arrow is an `mxCell` with `edge="1"`,
  `parent="1"`, `source` and `target` (the ids of its two boxes) and an
  `mxGeometry relative="1" as="geometry"`. Give every cell a short unique `id`,
  and put boxes on a grid, about 160 apart, so nothing overlaps.
- **Change a diagram by reading it first.** `get_diagram` gives the XML;
  `update_diagram` takes the whole new XML. Keep the `id` of every cell you do
  not mean to change: a change that takes more than 40% of the cells out (an
  id written again counts as taken out) waits for review. If the user changed
  the diagram meanwhile, theirs stays and yours is kept in a copy beside it
  (`status: "conflict"`, with its path).
- **You never draw the picture.** It is drawn from your XML the next time the
  app has its diagram editor, so a diagram you just made may show no picture
  yet. Show it in a page with `![[name.drawio]]` on a line of its own.
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

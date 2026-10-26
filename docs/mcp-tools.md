# MCP tools

These are the tools KastenFlow's MCP server offers to agents such as Claude Code, Codex and
the in-app chat (see [Connect AI agents](guide.md#connect-ai-agents)). Every tool goes through
the same rules as the app: locked pages are read-only, large removals wait for your
review, nothing is permanently deleted, and what an agent does can be undone (see [Agent
modes](agents.md)).

The list below was taken from the tools the server registers: **88 tools** for notes, tags,
boards, diagrams, LaTeX and smart pages, plus the slide deck tools at the end. In the
**Changes?** column, *no* means the tool only looks. When a plugin ([Plugins](plugins.md)) is
off, its tools are not offered: the diagram tools need draw.io, the LaTeX tools need the LaTeX
plugin. An agent can ask for the current list at any time.

- [Look and read](#look-and-read)
- [Write notes](#write-notes)
- [Edit a page by its blocks](#edit-a-page-by-its-blocks)
- [Projects, tags and structure](#projects-tags-and-structure)
- [Comments, saved searches and references](#comments-saved-searches-and-references)
- [Sessions and undo](#sessions-and-undo)
- [Whiteboards](#whiteboards)
- [Diagrams](#diagrams)
- [LaTeX](#latex)
- [Smart pages](#smart-pages)
- [Slide decks](#slide-decks)

## Look and read

| Tool | Changes? | What it does |
| --- | --- | --- |
| `search` | no | Ranked full-text search with snippets; filters by tag, project, type and date, and `on:`, `created:`, `updated:` and `under:` in the query. |
| `read_note` | no | A note's frontmatter, properties and Markdown body, by id, title or path; optionally the notes linking to it. |
| `list_notes` | no | Notes' metadata without bodies, filtered by project, tag or type. |
| `query_tag` | no | Rows of a tag's database, filtered and sorted, with each row's parent and sub-page count; formula properties are worked out for today. |
| `get_journal` | no | A day's journal note (today by default); reading never creates it. |
| `get_history` | no | The changes made to a note, newest first, with who made them. |
| `list_tags` | no | Every tag in use with its note count, and the schemas of tags that have one. |
| `list_templates` | no | The vault's templates: name, type, icon, tags and a glimpse of each. |
| `list_trash` | no | Notes in the trash that can come back, newest first. |
| `list_tasks` | no | The to-dos of the whole vault as the Tasks view lists them, with the line and hash `set_task` needs. |
| `list_projects` | no | Every project at a glance: status, health, next action, review date, open to-dos and counts. |
| `list_setups` | no | The ways a new project can start: built-in setups and the ones you saved. |
| `list_comments` | no | The comments on a page with their ids, authors and whether they are resolved. |
| `list_collections` | no | The saved searches, with the hash `update_collection` needs. |
| `list_references` | no | The vault's bibliography, filtered by words. |
| `list_sessions` | no | Sessions of agents that changed the vault, newest first, and whether each was taken back. |
| `activity_digest` | no | What agents did lately, session by session, read from History; your own edits are never in it. |
| `server_status` | no | How the server is doing: version, vault, whether history is on, your session, whether slides can be drawn. |

## Write notes

| Tool | Changes? | What it does |
| --- | --- | --- |
| `capture` | yes | A new card in the inbox from Markdown; its first line becomes the title. |
| `create_note` | yes | A new card or page with a body, tags and properties, in a project, the inbox or the library, or under a parent page; optionally from a template. |
| `append` | yes | Adds Markdown to a note, at its end or under a heading. Never removes text. |
| `replace_section` | yes | Replaces the text under one heading, up to the next heading of the same level. Large removals wait for review. |
| `update_props` | yes | Sets properties on a note, validated against its tags' schemas; `null` removes one. |
| `add_tags` | yes | Adds tags to a note. |
| `remove_tags` | yes | Removes tags from a note. |
| `rename_note` | yes | Gives a note a new title; its file and every `[[link]]` to it follow. |
| `move_note` | yes | Moves a note and its sub-pages into a project, or to the library. |
| `journal_append` | yes | Adds Markdown to a day's journal, creating the day if needed. |
| `journal_day` | yes | Opens a day of the journal and makes it from the template if it is not there yet. |
| `duplicate_note` | yes | Makes a copy of a page or card next to it, with its comments. Locked notes are refused. |
| `restore_note` | yes | Brings a note back from the trash, with the sub-pages that went with it. |
| `trash_note` | yes | Moves a note and its sub-pages to the trash, where you can restore them. Never deletes. |
| `set_note_meta` | yes | Changes one setting in a page's header: icon, cover, font, width, text size or layout. |
| `apply_template` | yes | Fills an empty page from a template; a page that has text is refused. |
| `set_task` | yes | Ticks or unticks one to-do in a note; a note that changed since is refused. |
| `propose_edit` | yes | Sends a full rewrite of a note's body to your review queue. |
| `batch` | yes | Up to 100 changes (1 MB) made as one, all or none, with one undo; one refusal refuses all. |

## Edit a page by its blocks

| Tool | Changes? | What it does |
| --- | --- | --- |
| `read_page_blocks` | no | A page as blocks (paragraph, heading, list, todo, table, code, quote, callout, toggle, columns, embed, math and more), each with an id and a hash. |
| `edit_page` | yes | Changes a page by its blocks in one step: insert, replace, move or delete blocks, tick a task, put blocks in columns, a toggle or a callout, change table cells, add an embed. Blocks that no step names keep every byte. |

## Projects, tags and structure

| Tool | Changes? | What it does |
| --- | --- | --- |
| `set_parent` | yes | Puts a page inside another page as a sub-page, or takes it out. |
| `reorder_children` | yes | Sets the order a page's sub-pages are shown in. |
| `create_project` | yes | Starts a new project, empty or from a setup. |
| `save_project_setup` | yes | Saves a project as a setup new projects can start from; waits for your review. |
| `set_project_state` | yes | Sets a project's status, health, next action and review days, checked first. |
| `update_tag_schema` | yes | Proposes a tag's schema: colour, properties (including formula properties) and views; always waits for review. |
| `set_tag_views` | yes | Sets the views a tag's database shows (table, kanban, list, calendar, gallery, timeline). |
| `set_view_order` | yes | Puts the rows of one view in the order you give. |
| `create_template` | yes | Proposes a new template for pages or cards; always waits for review. |
| `update_template` | yes | Proposes a new body for an existing template; always waits for review. |

## Comments, saved searches and references

| Tool | Changes? | What it does |
| --- | --- | --- |
| `add_comment` | yes | Adds a comment to a page, signed by the agent. |
| `resolve_comment` | yes | Resolves a comment, or opens it again. Comments are never deleted. |
| `create_collection` | yes | Saves a search under a name. |
| `update_collection` | yes | Changes the settings of a saved search; other lines of its file stay as they are. |
| `add_reference` | yes | Adds a reference to the bibliography; waits for review unless you let agents work on their own. |

## Sessions and undo

| Tool | Changes? | What it does |
| --- | --- | --- |
| `undo_session` | yes | Takes back every change of a session, newest first, keeping edits you made since. |

## Whiteboards

| Tool | Changes? | What it does |
| --- | --- | --- |
| `list_boards` | no | Every whiteboard with its title, project and number of nodes. |
| `read_board` | no | A whiteboard's nodes and connections. |
| `create_board` | yes | A new, empty whiteboard in a project or the library. |
| `add_to_board` | yes | Puts notes on a whiteboard as cards, in a grid, clustered by tag, or at given positions. |
| `connect` | yes | Draws an arrow between two nodes, with an optional label. |
| `group_on_board` | yes | Gathers nodes into a titled section. |
| `board_edit` | yes | Changes a whiteboard with steps: add a sticky, move, resize, remove, restyle, edge style. |

## Diagrams

These need the draw.io plugin.

| Tool | Changes? | What it does |
| --- | --- | --- |
| `list_diagrams` | no | Every diagram with its title, project, pages and whether its picture is up to date. |
| `get_diagram` | no | A diagram's source (draw.io XML). |
| `create_diagram` | yes | A new diagram from XML (blank when left out). |
| `update_diagram` | yes | Replaces a diagram's source; a change that takes many cells out waits for review. |
| `trash_diagram` | yes | Moves a diagram and its picture to the trash; always waits for review. |
| `rename_diagram` | yes | Gives a diagram a new title; links follow. |
| `move_diagram` | yes | Moves a diagram into a project or the library. |
| `duplicate_diagram` | yes | Makes a copy of a diagram next to it. |
| `diagram_describe` | no | A diagram told in words and cells, with free room and lint findings. |
| `diagram_find_shapes` | no | Looks up draw.io shapes by name (AWS, Azure, Kubernetes, flowchart, UML and more). |
| `diagram_lint` | no | Checks a diagram and says what to fix. |
| `diagram_preview` | no | A picture of a diagram as SVG text. |
| `diagram_new` | yes | Makes a diagram from a description, a Mermaid flowchart or a template, laid out. |
| `diagram_edit` | yes | Changes a diagram with typed steps (add, move, resize, restyle, group, layout and more). |
| `diagram_export` | yes | Keeps an SVG picture of a diagram in the vault's assets folder. |

## LaTeX

These need the LaTeX plugin.

| Tool | Changes? | What it does |
| --- | --- | --- |
| `latex_list` | no | Every LaTeX document: folder, root file, engine, and whether it is locked. |
| `latex_read` | no | Reads a source file of a document, with its hash, and lists the other source files. |
| `latex_edit` | yes | Replaces one piece of text in a source file; refused for a locked document or a changed file. |
| `latex_build` | no | What the last build said: errors and warnings with file and line. It does not run TeX. |

## Smart pages

| Tool | Changes? | What it does |
| --- | --- | --- |
| `smart_create` | yes | Makes a smart page and its files together as one change. |
| `smart_read` | no | A smart page's files with hashes, its settings, the errors it reported and what its queries return now. |
| `smart_edit` | yes | Changes one file with steps (replace a piece of text, or rewrite the file). |
| `smart_write_file` | yes | Writes one whole text file of a smart page. |
| `smart_delete_file` | yes | Takes one file out of a smart page, to the trash. |
| `smart_check` | no | Checks a smart page's files and says what to fix. |
| `smart_render` | no | Cannot draw a picture of a smart page yet; says so, after checking the page exists. |

## Slide decks

Deck tools come from the Slides engine. They are listed here by name, in the order the
server offers them; each has its own description in the server's list.

- **Look:** `list_decks`, `get_deck`, `get_slide`, `get_outline`, `list_layouts`, `get_theme`,
  `search_assets`, `lint_deck`
- **Make:** `create_deck`, `deck_from_note` (a deck from one of your notes), `import_pptx`
- **Slides:** `add_slide`, `duplicate_slide`, `delete_slides`, `reorder_slides`, `move_slides`,
  `apply_layout`, `apply_theme`, `apply_deck_template`, `edit_theme`, `set_title`, `set_present`,
  `set_page_size`, `set_notes`, `set_background`, `set_slide_flags`
- **Text and tables:** `set_text`, `set_rich_text`, `format_paragraphs`, `set_cells`, `clear_cells`,
  `insert_rows`, `delete_rows`, `insert_columns`, `delete_columns`, `merge_cells`,
  `unmerge_cells`, `set_cell_fill`
- **Elements:** `add_diagram`, `place_image`, `add_elements`, `update_elements`, `patch_elements`,
  `transform_elements`, `delete_elements`, `reorder_elements`, `group_elements`,
  `ungroup_element`, `duplicate_elements`, `align_elements`, `distribute_elements`,
  `expand_composite`, `replace_all`, `set_logo`
- **Steps and motion:** `set_steps`, `set_slide_steps`, `set_transition`, `set_morph`
- **Files:** `add_asset`, `export` (PowerPoint), `trash_deck` (always waits for review)
- **Pictures of slides** (only in the `kasten-mcp` program from the command-line download, not
  the installed app): `render_slide`, `render_grid`

Taking slides out of decks, or leaving them empty, waits for your review once more than 3
are taken out in ten minutes (a limit you can change).

# The KastenFlow vault format

Format 1. A vault is one folder you pick, anywhere on your disk. Everything in it is a plain file: Markdown, YAML and JSON, readable by any editor and by other apps. KastenFlow keeps nothing about your notes anywhere else, apart from API keys in the OS keychain. The app's own settings, on each computer, remember the vaults you opened and the backup remote you confirmed for each.

This page describes KastenFlow's own layout. KastenFlow also opens other folders of Markdown, such as an Obsidian vault, as they are (see [Other folders](#other-folders)).

## What makes a folder a KastenFlow vault

KastenFlow keeps its own files in a folder named `.kasten/`, inside the vault.

The file `.kasten/config.yaml`:

```yaml
name: My notes
format: 1
git:
  remote: null
  push_delay_seconds: 120
  push_interval_minutes: 60
guardrails:
  max_removed_fraction: 0.4
  max_notes_per_session_10min: 25
  max_trash_per_session: 5
  max_board_nodes_removed: 10
  max_slides_removed: 3
  max_write_bytes: 204800
  max_asset_bytes: 10485760
  max_assets_per_session_10min: 30
  max_asset_bytes_per_session_10min: 52428800
ai:
  providers: []
```

- `name` is the vault's name, shown in the app and in backup file names.
- `format` says which version of this document the files follow. KastenFlow does not open a vault with a newer format than it knows. It gives the reason and changes nothing, so an older app cannot damage a newer vault. A config without `format` is format 1.
- `git.remote` is the backup remote's address (`https://`, SSH or a folder), or `null` for none. It holds no password: tokens stay in the OS keychain. KastenFlow pushes to it only once it is confirmed on each computer, `git.push_delay_seconds` after the last commit and at least every `git.push_interval_minutes` while there is something to push. Backup files to a folder are set on each computer, not here.
- `guardrails` are the limits on AI agents, the same in the app, the chat and MCP:
  - `max_removed_fraction`: an edit that removes more than this share of a note's text waits for review as a proposal;
  - `max_notes_per_session_10min`: notes (and slide decks) one session may change in ten minutes before its writes wait for review;
  - `max_trash_per_session`: notes one session may move to the trash before the rest wait for review;
  - `max_board_nodes_removed`: board nodes one edit may remove before it waits for review;
  - `max_slides_removed`: slides one session may take out of decks in ten minutes before its change waits for review. A slide is taken out when it is removed and when it is left with nothing on it (no elements, or only empty text boxes); a change that replaces the whole deck counts every slide it does not leave as it was. What you accept in the review is not counted against the session. A trusted session is held to this too, and moving a whole deck to the trash always waits;
  - `max_write_bytes`: the largest single write; a larger one is refused. For a deck it is what the agent sent, not the size of the deck;
  - `max_asset_bytes`: the largest picture or file (a PowerPoint export, say) one agent write may add to `assets/`; a larger one is refused;
  - `max_assets_per_session_10min`: pictures and files one session may add to `assets/` in ten minutes; past this they are refused. The same bytes as a file already there are that file, and are not counted;
  - `max_asset_bytes_per_session_10min`: bytes of pictures and files one session may add in ten minutes; past this they are refused. A PowerPoint file comes in as one commit with its pictures, and one that meets a limit comes in not at all.
- `ai.providers` are the chat's AI providers, each with a `name`, a `kind` (`anthropic`, `openai` for any OpenAI-compatible server, or `chatgpt` for the person's ChatGPT plan), a `base_url` and a `model`. The key for each is in the OS keychain under its name, tied to that address. A `chatgpt` provider has no `base_url` and no key: its requests always go to OpenAI, whatever a vault's settings say, and the sign-in (only a refresh token, never the vault) is kept in the OS keychain for that computer.
- `ai.embeddings` (optional) is the `provider` and `model` that search by meaning uses, once chosen.
- `journal_template` (optional) names the template in `templates/` new journal days start from, such as `daily-planner`; without it, or when that template is gone, days start from `templates/journal.md`.
- Missing keys take their defaults; unknown keys are ignored.

## Layout

```
My notes/
  inbox/                         quick captures, one card per file
  journal/2026/2026-09-25.md     one page per day, made when you write in it
  projects/
    photo-organiser/
      _project.md                the project's page: overview and home
      pages/                     long notes; subfolders allowed
      cards/                     short notes
      boards/brainstorm.canvas   whiteboards
      decks/talk.deck            slide decks
      diagrams/flow.drawio       diagrams, each with flow.drawio.svg beside it
  library/                       pages, decks and diagrams that belong to no project
  sources/                       PDFs and their highlight files
  chats/                         saved chats
  templates/                     page templates (placeholders below)
  tags/                          one YAML schema per tag
  assets/                        pasted and dropped images and files
  .trash/                        deleted notes, under their old paths
  .git/                          history of every change
  .kasten/
    config.yaml                  as above
    proposals/                   agent edits waiting for review, JSON
    cache/                       index, search vectors, backup state (safe to delete)
    write.lock                   held while one program writes
  .gitignore                     ignores .kasten/cache/ and write.lock
```

A project is one folder: its page, its pages and cards, and its boards stay together, so it can be moved, shared or archived whole.

A template in `templates/` fills these placeholders when a page starts from it: `{{title}}`, `{{project}}`, `{{date}}` (`2026-09-28`), `{{time}}` (`14:05`, the person's own time), `{{weekday}}` (`Monday`), `{{week}}` (`2026-W40`, the ISO week), `{{month}}` (`September`) and `{{year}}`. A page made without the person's time, as from the command line, gets the time in UTC, written `14:05 UTC`. `templates/journal.md` starts each journal day.

## Notes

Every card, page, journal day, highlight and chat is a Markdown file with YAML frontmatter:

```markdown
---
id: 01J8Z3K6Q2M4X7V9B1C5D8E0F2
title: Duplicate score for photos
type: card
created: 2026-09-23T10:14:00+02:00
updated: 2026-09-23T10:20:00+02:00
tags: [idea, paper]
props:
  status: Exploring
  deadline: 2026-10-15
parent: null
icon: bulb
---
Use a perceptual hash to score how alike two photos are.

See [[Photo organiser roadmap]] and ![[Duplicate score sketch]].
```

| Key | Meaning |
|---|---|
| `id` | A ULID made once and never changed. Links to a note's id (sub-pages, relations) survive renames. |
| `title` | The note's name. The file name is a slug of it; a rename moves the file and rewrites every link to it in one change. |
| `type` | `card`, `page`, `journal`, `project`, `highlight` or `chat`. Without it, the folder decides: `inbox/` and `projects/*/cards/` hold cards, `journal/` days, `_project.md` a project, the rest pages. A card and a page differ only here. |
| `created`, `updated` | When the note was made and last changed. |
| `tags` | Tag names; a tag with a schema in `tags/` gives the note properties. |
| `props` | Property values, kept in the note itself so it stays whole on its own. |
| `parent` | The id of the page this one is a sub-page of. Sub-pages move with their parent; a sub-page moved on its own to another folder leaves its parent, and the key goes. |
| `icon`, `cover` | The page's icon (an emoji, or `icon:name` from KastenFlow's line icons) and cover. |
| `font`, `width`, `text` | The page's own style, when it differs from the app's: `font: sans`, `serif` or `mono`; `width: full` or `normal`; `text: small` or `normal`. Another value is kept and ignored. |
| `locked` | `true` keeps agents from editing the note. Only a person sets or clears it. |
| `props.home`, `props.page_template` | On a project's `_project.md`: the sections its home shows, in order, and the template its new pages start from. |

Any other key, and any Markdown KastenFlow does not draw itself, is kept byte for byte on every save.

### In the text

| Written as | Is |
|---|---|
| `[[Title]]`, `[[Title#Heading]]`, `[[Title\|alias]]` | A link to another note. Alone on its line, it shows as a page block. |
| `[[projects/trip/pages/plan\|Plan]]` | A link to a note by its path (without `.md`), written when other notes share its title. A title several notes share goes to the one in the linking note's project first. |
| `![[Title]]` | The note, shown in place |
| `![[boards/plan.canvas]]`, `![[tags/paper.yaml#Pipeline]]` | A whiteboard, or a tag's database view, inside the page |
| `![[Login flow.drawio]]` | A diagram's picture, centred, alone on its line. Inside a sentence, `[[Login flow.drawio]]` is a link that opens the diagram. A file name alone finds the diagram when no other has that name; a path (`library/Login-flow.drawio`) always does |
| `[[2026-10-02]]` | A link to that day's journal page; the calendar shows the note on that day, at the time written right after the link (`[[2026-10-02]] 14:30`, 24 hours) |
| `- [ ] Call the bank @2026-10-02 14:30` | A to-do, due that day, and at that time if one follows (`[[2026-10-02]] 14:30` works too; `📅 2026-10-02` gives a day only). Only a day on the calendar counts: `2026-02-30` is plain text |
| `> [!tip] Title` | A callout, as GitHub and Obsidian write them |
| `<details><summary>Title</summary> … </details>` | A toggle |
| `<span style="color: red">…</span>` | Coloured text (`background-color` for highlighted text) |
| `$x^2$`, `$$ … $$` | Maths, read as Pandoc reads it |
| `![](../assets/photo.png)` | An image or file in `assets/`, linked relatively |
| `![1.50](../assets/photo.png)` | A picture with no alt text, shown at 1.5 times its size |

## Tags and properties

`tags/<name>.yaml` gives a tag its properties and views:

```yaml
name: paper
color: blue
properties:
  - {key: status, type: select, options: [Idea, Drafting, Submitted]}
  - {key: deadline, type: date}
  - {key: related, type: relation}
views:
  - {name: Pipeline, type: kanban, group_by: status}
  - {name: Deadlines, type: calendar, date: deadline}
  - {name: All, type: table, sort: [{key: deadline, dir: asc}]}
```

Property types: `text`, `number`, `select`, `multi_select`, `date`, `checkbox`, `url` and `relation` (note ids). View types: `table`, `kanban`, `list`, `calendar` and `gallery`. Comments and unknown keys in the file are kept.

## Whiteboards

Boards are [JSON Canvas](https://jsoncanvas.org) files, `.canvas`:

- `file` nodes point to notes by vault path;
- `text` nodes are stickies, shapes and drawings, and `group` nodes are sections;
- `link` nodes are web pages;
- edges connect nodes, with optional labels;
- colours are the six JSON Canvas presets (`"1"` to `"6"`: red, orange, yellow, green, cyan, purple) or a `#rrggbb` value, which is how KastenFlow writes its pink, brown and grey.

Anything only KastenFlow uses sits under an `x-kasten` key, which other tools ignore:

- how cards show and which sections are folded;
- a shape's outline, such as `diamond` (other tools show its label as a card);
- a drawing's line, as `x,y` points and a pen width (other tools show an empty card);
- a connection's line (straight, curved or elbowed) and its dashes.

A board's sections are also its slides when it is presented.

## Slide decks

A deck is a `.deck` file: JSON written the same way every time (keys in alphabetical order, two-space indent), so a change to a deck shows in git as a few lines. It holds the whole deck: the theme, the slides with their text, shapes, speaker notes and steps, and the sections. Pictures are not inside it; a deck names them by path, such as `assets/figure-3.png`, exactly as a note does. [The Slides deck format](slides-format.md) describes every part.

- A deck made without a project goes in `library/`; one made in a project goes in that project's `decks/`. A deck can sit anywhere else in the vault too.
- Keys a version does not know are kept when it saves the deck again, so a deck edited by a newer KastenFlow survives an older one. A deck newer than the running KastenFlow is refused, never rewritten.
- A save never replaces a deck that changed since it was read: the save goes to a copy beside it (`talk (conflict 2026-09-29 14-05).deck`), and nothing is lost.
- Anything only KastenFlow uses in a deck sits under keys other tools ignore; the file is plain JSON, so a script can read or write it. KastenFlow notices a change made outside it and commits it, as it does for notes.

## Diagrams

A diagram is two files side by side:

- `name.drawio` is the source: the uncompressed `mxfile` XML that the diagram editor (draw.io) writes, kept as the editor wrote it (one element to a line, so a change shows in git as a few lines). Any draw.io app opens it. A diagram another program saved compressed is kept as it is until the editor saves it again, and the editor writes it uncompressed.
- `name.drawio.svg` is its picture, an ordinary SVG that pages, slides and whiteboards show, so no editor is needed to see a diagram. Its last line is a comment, `<!-- kasten-source: 3f9a… -->`, naming the source it was drawn from: a picture whose comment does not match the source is out of date, and one that is missing is drawn again the next time the editor is at hand. The picture is derived: it can be deleted and drawn again.

The file name is the title with its case kept (`OAuth-flow.drawio` reads "OAuth flow"); a name already taken is numbered (`-2`). A diagram made without a project goes in `library/`; one made in a project goes in that project's `diagrams/`; one can sit anywhere else too.

- The two files are written together or not at all, and they move, rename, duplicate, go to the trash and come back together. Links (`![[name.drawio]]`) and whiteboard cards that name a diagram follow it when it is renamed or moved.
- A save never replaces a diagram that changed since it was read: the save goes to a copy beside it (`flow (conflict 2026-10-06 14-05).drawio`), and nothing is lost.
- The source must be a well-formed `mxfile` (or `mxGraphModel`) with no entity declarations, at most 5 MB; the picture must be a well-formed SVG with no scripts. KastenFlow refuses what is not, and the check is run again when two computers' histories are merged.
- An agent writes only the source (see the diagram tools in the user guide); it never writes the picture.

## Highlights and sources

A PDF such as `sources/attention.pdf` has a sidecar, `sources/attention.highlights.json`. Each highlight has an id, a page, rectangles, the quoted text, a colour and, when it became a card, the card's id. That card has `type: highlight` and a `source` key.

## Images and attachments

A pasted or dropped file is kept once in `assets/`, named by a slug of its name (`assets/figure-3.png`; `-2` when the name is taken). Notes, boards and decks refer to it by that path, and nothing rewrites those paths. The same bytes never make two files: pasting a picture that is already anywhere in `assets/` gives the file that holds it.

Each picture also has a small JSON sidecar in a hidden `.meta` folder beside it (`assets/.meta/figure-3.png.json`), one key to a line, written in the same commit as the picture. Keys a version does not know are kept when it writes the file again.

```json
{
  "id": "01K5ZK0000000000000000AS01",
  "name": "Figure 3.png",
  "sha256": "0c534e15…",
  "bytes": 87,
  "width": 4,
  "height": 3,
  "source": "pasted",
  "createdBy": "person",
  "created": "2026-09-24T08:00:00Z",
  "tags": [],
  "caption": "Scaled dot-product attention.",
  "citationKey": "vaswani2017attention",
  "clip": {"pdf": "sources/attention.pdf", "page": 3, "rect": [72, 300.13, 400, 520.5]}
}
```

`source` is `pasted`, `file`, `pdf-clip` (with `clip`: the paper, the page from 1 and the rectangle in PDF points from the page's bottom left), `agent` (with `createdBy: "agent:<session>"`) or `pptx-import` (with `deck`, the name of the deck it came from). A picture without a sidecar, such as one added by hand, is still a picture: it is listed from its file, and gets a sidecar with its first change. Where a picture is used is worked out by looking at notes, boards and decks, never stored. Small copies for the gallery are made on demand in `.kasten/cache/thumbs/` and can be deleted at any time.

## History and the trash

- Every change is a commit in the vault's own git repository, with who made it: you, the app, or an agent session. Recorded versions can be inspected and restored. A remote in `config.yaml` enables backup once you confirm it on each computer; keep an independent backup against disk failure or corruption.
- Deleting a note moves it to `.trash/<time>/`, under its old path, until the trash is emptied. A page's sub-pages go with it into the same folder, and restoring the page brings them back.

## Editing outside KastenFlow

The files are yours to edit with anything. KastenFlow watches the folder and picks changes up. It indexes them, and it commits them as edits made outside the app. The index in `.kasten/cache/` is rebuilt from the files whenever it is missing or out of date.

## Other folders

"Open a folder" in KastenFlow also takes a folder that is not a KastenFlow vault, such as an Obsidian vault. KastenFlow reads it as it is:

- notes stay where they are;
- the sidebar shows every folder outside KastenFlow's own as a folder, under "Folders";
- notes at the top of the folder are pages;
- links, embeds and frontmatter `tags` work as they do in a KastenFlow vault; other frontmatter keys, such as Obsidian's properties, are kept as they are.

KastenFlow adds only its `.kasten/` folder, plus `.git/` if you turn history on.

To bring such notes into KastenFlow's own layout instead, use Import in a KastenFlow vault. The notes become a project, and the original folder is not changed.

## Versions

| Format | KastenFlow | Changes |
|---|---|---|
| 1 | 0.1 | The layout above. |

A change to the layout or to a key's meaning makes a new format, with this table and a migration that runs when an older vault is opened.

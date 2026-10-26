---
name: kasten-smart-pages
description: Build live dashboards, trackers, maps, timelines, calendars, boards and galleries in the user's KastenFlow vault as smart pages (a small folder of HTML and JavaScript that reads the user's notes) with the kasten MCP server's smart_create, smart_check, smart_read, smart_edit and smart_write_file tools and the page kit. Use when asked for a dashboard, tracker, status board, deadline countdown, map of places, timeline or gallery that should stay current as notes change.
---

# Making smart pages

A smart page is a folder of code that the app runs as a live page: `smart.yaml`, `index.html`, `app.js` and any other files it needs. It shows the user's notes as numbers, charts, boards, maps and timelines, and it changes when a note changes. The full reference and three finished pages are the resource `kasten://smart/kit`; the same three pages are in this skill's `examples/` folder.

## Smart page or normal page?

- **Smart page:** a dashboard, a tracker, a status board, a deadline countdown, a map, a timeline, a calendar, a gallery. Anything that is a view of many notes and should stay current.
- **Normal page:** prose, meeting notes, an essay, a plan. Write those with `create_note` and `edit_page`.
- **The data always lives in notes.** Never write dates, places, names or statuses into the HTML or JavaScript. The page reads notes by tag, so the user edits a note and the page follows. If the notes do not exist yet, make them first (a `batch` of `create_note` with `add_tags` and `update_props`) and give the tag a schema with `update_tag_schema` so the properties are typed.
- **The page has no network.** No web address, `fetch`, `XMLHttpRequest`, WebSocket, CDN script, web font or remote picture. It can use only its own folder and the kit at `smart://kit/1/`. If a picture is needed, it has to be a file the user put in the page's folder.

## The order of work

1. **Look at the notes.** `query_tag` shows the notes of the tag and the properties they really have. Use those property names; if there are none yet, say so and make a few notes with the properties the page needs.
2. **Start from the nearest example.** Conference tracker (dates, places, deadlines), reading dashboard (statuses and counts), project status board (a board, what is due, a table). Copy its three files and change the tag, the properties and the components.
3. **Make the page in one call.** `smart_create` takes a `title`, the `files` (each `{ path, content }`: `index.html`, `app.js`, optionally your own `smart.yaml`) and, instead of your own `smart.yaml`, `queries` and `views`. Give it a project when the page belongs to one. In Review mode the page waits for the user; say so and stop.
4. **Check.** `smart_check` lists problems by file and line: network use, missing or unclosed tags, files that are not there, queries that ask for a tag or property that does not exist. Fix every error, then check again. It does not run the page.
5. **Read what the app saw.** After the user opened the page, `smart_read` lists the files with their hashes, the problems and the last errors the page reported (script errors and rejected calls). Fix those. If there are none, say you could not run the page yourself.
6. **Change a file.** `smart_edit` takes the `page`, the `file`, the `base_hash` from `smart_read` and `steps` (`replace` text that is in the file exactly once, or `rewrite`). All steps are made or none. If you are told the file changed since you read it, read it again. `smart_write_file` replaces or adds a whole file (an existing file needs its hash), and `smart_delete_file` moves a file to the trash. `smart_render` does not draw a picture, so never promise one.

## The files

`smart.yaml` names the page and its queries:

```yaml
version: 1
title: Reading dashboard
kit: "1"
queries:
  reading:
    tag: reading
size:
  height: 900
```

`index.html` links the kit (the stylesheet, then `kit.js`, then `lib/dom.js`, `lib/dates.js`, `lib/format.js`, `lib/keys.js`, then only the components used) and then `app.js`. Add `kit-visual.css` for `timeline`, `kanban`, `calendar` and `map`; `legend.js` before `charts.js` before `stat.js`; for a map `components/map.js` and then `data/world-110m.js`. Every page has an empty message and a visible error message, a heading, and a `label` on every component.

`app.js` makes the components once and updates them when notes arrive:

```js
const board = kit.components.kanban("#board", {
  label: "Reading list",
  columns: ["To read", "Reading", "Done"],
  data: [],
  onMove: (item, status) => kasten.update({ id: item.id, props: { status } }),
});

kasten.watch(
  { tag: "reading" },
  (notes) => board.update(notes.map((n) => ({ id: n.id, title: n.title, status: n.props.status }))),
  (err) => kasten.log("could not read", err.message),
);
```

## What a page can ask the app

Every call returns a promise: `kasten.watch(query, onNotes, onError)` (keeps a query live and returns a function that stops it), `kasten.query({ tag, filter, sort, limit })`, `kasten.list`, `kasten.read(id)`, `kasten.search(text, limit)`, `kasten.journal(date)`, `kasten.project()`, `kasten.tasks`, `kasten.board(path)`, `kasten.open(idOrPath)`, `kasten.theme()`, `kasten.resize(px)` and `kasten.log(...)`. A page changes notes only with `kasten.update({ id, props })`, `kasten.addTags({ id, tags })`, `kasten.createNote({ title, tags, props, body })`, `kasten.append({ id, md })` and `kasten.toggleTodo({ id, index })`: they run under the project's agent mode, and the answer is `{ status: "done", result }` or `{ status: "pending_review", proposal, reason }`. Each call takes one object, not several arguments (`kasten.toggle(id, index)` is the one short form). A failed call rejects with a `kit.KastenError` whose `code` says why.

## Components and their data

Each is `kit.components.<name>(target, { label, data, empty })` and returns an object with `update(data)`.

| Component | Data |
| --- | --- |
| `stat` | `[{ label, value, delta?, hint?, spark? }]` |
| `table` | `[{ id, ...columns }]` with `columns` |
| `bar`, `donut`, `line`, `sparkline` | `[{ label, value }]` |
| `kanban` | `[{ id, title, status, note?, tags? }]` with `columns` and `onMove` |
| `timeline` | `[{ id, title, lane?, date or start + end, announced? }]` |
| `calendar` | `[{ id, title, date, end? }]` |
| `countdown` | `[{ id, title, date, note?, announced?, aoe? }]` |
| `map` | `{ pins: [{ id, label, lat, lon, note? }], highlight: [] }` |
| `gallery` | `[{ id, src, title?, caption? }]` |

The helpers: `kit.dates` (`daysUntil`, `dateInfo`, `formatDate`, `isoDate`, `compareDates`, `addDays`), `kit.format` (`number`, `percent`, `plural`, `truncate`) and `kit.h` with `kit.render` for small views of your own. `kasten://smart/kit` has every option.

## Habits that make a page good

- **Read, then draw.** Turn notes into the component's data in one `render(notes)` function, and show the empty message when there are none.
- **Estimates are marked.** If a date is not final (a property such as an estimate flag), pass `announced: false` rather than hiding it.
- **Work with both themes and the keyboard.** Use the kit's stylesheet and components and no colours of your own; give every component a `label`.
- **Small and plain.** One page, a few components, no libraries. Prefer the kit over hand-drawn markup.
- **Say what you could not see.** You cannot run the page. After `smart_check` is clean, tell the user what you built, which tag and properties it reads, and that they should open it and tell you what looks wrong.

## The three examples

- `examples/conference-tracker`: tag `conference`; countdown tiles, a map, a pipeline and venue cards from `paper_deadline`, `abstract_deadline`, `lat` and `lon`.
- `examples/reading-dashboard`: tag `reading`; numbers, a board that moves a book between columns by changing its note, and a chart.
- `examples/project-status-board`: tag `task`; what is due next, a board and a table.

Each has `smart.yaml`, `index.html` and `app.js`. Use them as they are with `smart_create` once the notes have the properties they read.

---
name: kasten-slides
description: Build, edit and check slide decks (.deck files, exportable to PowerPoint) through the KastenFlow Slides MCP server - turn an outline into a deck, add diagrams, pictures, code, formulas and step-by-step reveals, lint for layout problems, and export. Use when the user asks for a talk, presentation, slides, a deck, or a PowerPoint file.
---

# Making slide decks with KastenFlow Slides

A deck is one `.deck` file: a theme, and slides made of elements (text, shapes,
connectors, pictures, tables, code, formulas ...) on a 960 by 540 canvas. You
build it with the `slides` MCP tools. Each tool applies the same operations the
editor uses, saves at once (a person with the deck open sees it change) and
reports what is wrong with the slides it touched. Nothing you do deletes:
removed slides are kept as a copy in `.trash/`, and a deck is put there, not
unlinked.

## Connecting

The server is the `slides` program serving a folder of decks:

```json
{ "mcpServers": { "slides": { "command": "slides", "args": ["mcp", "--folder", "/path/to/decks"] } } }
```

With Claude Code: `claude mcp add slides -- slides mcp --folder ~/decks`. Inside
KastenFlow the same tools are offered for the decks of the vault. If the tools are
not there, say so and stop; do not write `.deck` files by hand.

When it connects, the server sends instructions: the deck conventions, what each
kind of element is for, the lint rules and the order of work. They are the
authority; this skill is the short version, with the habits that make decks good.

## The workflow

1. **Outline first.** Decide the story before any layout: the one thing the
   audience should take away, then a slide title for each step of getting there.
   A title is a claim ("Retrieval cuts hallucinations"), not a topic ("Results").
2. **`create_deck`** with a Markdown outline: `# Deck title`, then `## Slide title`
   with a few lines under each. It picks a layout for what a slide holds (one
   block: title and body; two: columns; a picture: title and image; a fenced
   block: code; a `>` quote: quote; nothing: a section slide). `<!-- layout: name -->`
   after a title chooses one; `Notes:` starts speaker notes.
3. **`get_deck`** shows every slide with its id. The ids it shows are what the
   other tools take (a slide may also be named by its number, from 1).
4. **Refine slide by slide** with the tools below.
5. **`lint_deck`** after every batch of changes. Fix what it reports by its hints,
   worst first. Finish only with no errors, and no warnings you cannot defend.
6. **Look.** `render_slide` (one slide as a picture) and `render_grid` (every slide
   at once) show what lint cannot: a slide that is dull, crowded or unbalanced.
   Look at each slide you built before you say it is done. They need Chrome or
   Chromium on the machine; without one they say so.
7. **`export`** when a file is wanted: `pptx` (editable, native shapes and text)
   or `markdown`. The file is written beside the deck and is never written over
   another; the answer says where it went and what could not be written exactly.
   A citation is written as the editor shows it (who, when and where, or its
   number) from the `.bib` files beside the decks, and as its key where there are none.

## Design rules

- **One idea to a slide**, in a layout that fits it. At most 60 words. If it needs
  more, split the slide or move the detail into the speaker notes (`set_notes`).
- **Type of 14 pt or more** and 24 units of margin. Never shrink text to make it
  fit; say less. Title 36, body 22, captions 14 in the built-in themes.
- **One accent colour to a slide**: `accent1` for what matters, `text1`, `text2`
  and `bg2` for the rest. Use theme colour names, not hex, so a theme change works.
- **Diagrams, not bullets with arrows.** A process, a system or a loop is
  `add_diagram` (boxes laid out for you, arrows attached so they follow the boxes).
- **Every picture has alt text; every figure has a citation.** Put the citation in a
  strip at the bottom (`citation` element, BibTeX keys).
- **Show, then say.** Build an argument up with steps (`set_steps`) instead of
  putting all of it on screen at once. Show a change with Morph.
- **Speaker notes carry the talk.** What is said goes in notes, what is seen goes
  on the slide.
- **A list of more than six items is not a list.** Group it, or make it cards.

## Tools by job

Look:
- `list_decks`, `get_deck` (start here), `get_slide` (one slide in full), `get_outline`
  (the deck as Markdown), `list_layouts` (the slots of each layout; one marked
  `custom` was made by the deck's owner, so prefer it when it fits), `get_theme`,
  `search_assets` (pictures in `assets/`), `render_slide` (a slide as a picture;
  `step` draws it at a click) and `render_grid` (every slide in one picture).

Make and arrange:
- `create_deck`, `add_slide` (layout plus `content` by slot role, in Markdown),
  `duplicate_slide`, `delete_slides`, `reorder_slides`, `apply_layout`,
  `apply_theme` (Light, Dark, Serif, Lecture, Minimal, Bold, Modern, Academic,
  Pitch, Dark Studio, Warm Paper), `edit_theme`, `set_title`, `set_present` (slide
  numbers on or off, a new deck has them off; `transition` is how every slide
  arrives that names none), `set_page_size` (`16:9`, `16:10`, `4:3`, `1:1` or a `w`
  and `h` in units of 1/96 inch: refits every slide and the theme), `set_notes`,
  `set_background`, `set_slide_flags` (hidden, backup).

Fill a slide:
- `set_text` (Markdown: `**bold**`, `` `code` ``, `$latex$`, `- bullets`),
  `format_paragraphs` (change the list, marker style, number to start at, marker
  size and colour, alignment, spacing and indents of some or all paragraphs of a
  box without rewriting its words), `add_diagram`,
  `place_image` (keeps proportions; `placeholder`, `box` or `auto`), `add_elements`
  (any element, including the composites), `patch_elements`, `transform_elements`
  (move, resize, rotate), `align_elements`, `distribute_elements`, `group_elements`,
  `reorder_elements`, `delete_elements`, `replace_all`.
- Composites are single elements that draw as ordinary shapes, so they export:
  `code` (with `focus` to walk through lines), `math`, `chat`, `token-probs`,
  `card-grid`, `citation`, `step-label`, `embed`, `video`. The instructions give
  each one's fields.

Time and motion:
- `set_steps` with a `recipe`: `reveal` (things appear one by one), `walkthrough`
  (each highlighted in turn), `spotlight`; or explicit `states`. `set_transition`,
  and `set_morph` after `duplicate_slide` for a slide that glides from the last.

Batches and files:
- `update_elements` applies several operations as one step (all or none; one undo).
  Later operations can use what earlier ones returned: `"$1.slide"`,
  `"$1.elements.body"`. Use it to build a whole slide in one call.
- `add_asset` (base64 bytes, or a path inside the folder), `import_pptx`, `export`,
  `trash_deck`.

## Recipes

A diagram slide, in one call:

```json
{ "operations": [
  { "op": "add_slide", "input": { "layout": "title-only", "content": { "title": "The model asks, the host runs" } } },
  { "op": "add_diagram", "input": { "slide": "$1.slide", "direction": "leftToRight",
      "nodes": [ { "id": "m", "label": "Model" }, { "id": "h", "label": "Host", "emphasis": true }, { "id": "t", "label": "Tool" } ],
      "edges": [ { "from": "m", "to": "h", "label": "call" }, { "from": "h", "to": "t" }, { "from": "t", "to": "m", "label": "result" } ] } },
  { "op": "set_notes", "input": { "slide": "$1.slide", "notes": "Walk the loop once, slowly." } }
] }
```

A figure with its source: `add_asset`, then `place_image` with `alt`, then
`add_elements` with a `citation` element (`keys`) in the bottom strip.

A build-up: put the pieces on the slide, then `set_steps` with `recipe: "reveal"`.
One text box with a list shows an item at a time.

A change over time (before/after, a moving diagram): `duplicate_slide`, change the
copy, `set_morph` on it. Shapes that keep their ids glide.

## Reading lint

`lint_deck` answers worst first: `error`, `warning`, `info`, each with the slide, the
element, the rule and the fix. Every write tool also reports the problems on the
slides it changed, so you often see them before you ask.

- **text-overflow** is measured with a browser when the machine has Chrome or
  Chromium, and estimated from the words when it has none; the answer says which.
  Either way, make the box bigger or the text shorter.
- **empty-placeholder**: fill the slot or delete the box; empty slots show nothing.
- **overlap** and **off-slide**: move or resize; a shape that holds text is not an
  overlap. Name a box `bleed` if it is meant to run off the edge.
- **contrast**: change the colour or the fill behind it; do not lower the bar.
- **Not checked** lines at the end name rules that could not run (for example
  citation keys when there is no `.bib` beside the decks). Tell the person.

## Common mistakes

- Writing every slide as a title and five bullets. Vary the layout to fit the idea.
- Placing boxes and connectors by hand for a diagram. Use `add_diagram`.
- Hex colours and fixed fonts instead of theme names.
- Shrinking type until it fits. Cut words.
- Adding a picture with no `alt`, or a figure with no source.
- Editing after the person changed the deck. Every answer carries the deck's `hash`;
  if the deck moved on, your change is saved as a copy beside it and you are told.
  Read the deck again, look at what changed, repeat the change if it still applies.
- Saying the deck looks good without looking. Draw the slides you built
  (`render_grid`, then `render_slide` for a closer look) and say what you saw. Where
  there is no browser you cannot see them: lint is your eyes, so say what lint
  checked and what it could not.

## Finishing

Before you tell the person it is done: `lint_deck` shows no errors; you have looked
at the slides where you can; every slide has a title that says something; the notes
carry what will be said; any file asked for has been exported and you have said
where it is. If you could not check something, say what.

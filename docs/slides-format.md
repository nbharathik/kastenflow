# The KastenFlow Slides deck format

A deck is one file with the extension `.deck`. It is JSON, written the same
way every time, so a deck is always the same bytes and a change shows in git
as a few lines. Nothing in it is a database or a binary: images stay as
separate files, and the deck refers to them by path.

The format is defined by the Rust types in `crates/slides-core`. Two files
are generated from them and kept in `packages/slides-wasm/ts/generated`:
`deck.schema.json` (JSON Schema for a whole deck) and `ops.json` (every
operation with its input and output schema). Read those for the exact shape;
this page explains what the parts mean.

## Version

`format` is always `kasten-deck` and `formatVersion` is `1`. A build refuses a
deck with a newer version and says so. When the version changes, the change is
listed at the end of this page and older decks are migrated when opened.

Fields a build does not know are kept when it reads a deck and written back,
so a deck saved by a newer build survives an older one.

## Units

A 16:9 slide is **960 x 540 units**. One unit is 1/96 inch, exactly 9525 EMU in
PowerPoint, so exporting never rounds. The size of a deck's slides is `size`
(`w` and `h`); a slide may be any size from 96 to 5376 units (one to 56 inches)
each way. The page setup names four: 16:9 (960 x 540), 16:10 (960 x 600), 4:3
(960 x 720) and 1:1 (720 x 720). The origin is the top left and angles are degrees
clockwise. Type sizes are in points, as in Google Slides (1 pt is 4/3 units).

`set_page_size` changes the size of a deck's slides and refits what is in them
(see *Page size*). A new deck can be made at any size, and with a theme's example
slides.

Numbers are written without a fraction when they are whole, and positions are
rounded to two decimals.

## The file

```json
{
  "format": "kasten-deck",
  "formatVersion": 1,
  "id": "d-4b1e0x9a",
  "title": "Tool use in language models",
  "size": { "w": 960, "h": 540 },
  "theme": { "name": "Light", "colors": {}, "fonts": {}, "textStyles": {}, "layouts": [], "master": [] },
  "slides": [],
  "sections": [{ "title": "Part two", "startsAt": "s-91c2ab3d" }],
  "present": { "slideNumbers": true, "stepLabel": "Step {n} / {total}" }
}
```

Keys are written in alphabetical order. Ids are a kind prefix and eight random
base36 characters: `d-` for a deck, `s-` for a slide, `e-` for an element.

### Presenting

`present` holds the settings of the whole deck. `slideNumbers` says whether the
slide number that the theme's master draws shows on every slide, in an editor,
when presenting and in an exported file. A new deck is made with it `false`; a
deck that says `true` keeps its numbers. `stepLabel` is the wording of the
step counter, with `{n}` and `{total}` filled in. `transition` is how a slide
that names no transition of its own arrives (`{ "kind": "fade", "duration": 0.4 }`,
and `fade`, `slide` or `morph`); a deck without one cuts from slide to slide. The
`set_present` operation changes these settings, and only the ones it is given; a
`transition` of kind `none` takes the deck's away.

### Page size

`set_page_size { preset }` or `{ w, h }` changes `size` and refits the whole deck
as one step of undo: every slide's elements, the theme's layouts and its master.

- Boxes stretch with the slide: what stood at a fraction of the width stands at
  the same fraction, and the same goes for the height.
- Type, line widths, corner radii, shadows and the room inside a box follow the
  width, so a slide that keeps its width (16:9 to 4:3 at 960 units) keeps its type
  sizes. Sizes are rounded to the half point when the width changes.
- A picture, anything turned and a circle keep their shape: they are fitted inside
  the stretched box and centred in it, not stretched with it.
- Positions are rounded to two decimals. A size that is no smaller than the deck's
  either way (16:9 to 4:3 at 960 units, say) and back gives the deck it was, byte for
  byte, when its numbers have at most two decimals and it holds no picture, turned
  element or circle; a size that is smaller one way or the other and back can differ
  by a hundredth of a unit, and pictures, turned elements and circles come back
  smaller than they were whenever the box did not grow by the same ratio on both
  sides. Undo is always exact.
- The built-in themes are drawn for 960 x 540 and refitted in the same way when a
  deck of another size takes one (`apply_theme`) or is made in one.

### Templates

A built-in theme is also a template: its colours and fonts, the stripes, rules
and marks of its master, twelve layouts positioned for it, and seven example
slides (a title, a section, a list, two columns, a picture beside words, a quote
and a closing slide). A new deck can start with them; they are ordinary slides.
The themes are Light, Dark, Serif, Lecture, Minimal, Bold, Modern, Academic,
Pitch, Dark Studio and Warm Paper, all set in fonts the editor bundles or in the
fonts PowerPoint ships with.

A template of your own is a deck whose look is the point: *Save as template* keeps a
deck's theme (colours, fonts, text styles, the layouts you made, what every slide shows
behind it), its page size and, if you ask, its slides as examples. In KastenFlow it is an
ordinary `.deck` file in the vault's `templates/slides/` folder, which the deck list
leaves out and agents may read but not write. A new deck can start from it (with its
look, its shape and, if you want them, its slides), and *Apply a template* puts its
look on a deck that exists: the theme is replaced, the page size too when you ask, and
every slide keeps its words and elements. Layouts the deck has that the template lacks
are kept after the template's own, so no slide changes layout.

### Theme

A deck carries its own copy of its theme, so it opens the same anywhere.

- **colors**: `text1`, `text2`, `bg1`, `bg2` and `accent1` to `accent6`, each
  `#rrggbb`. They match PowerPoint's theme colours one for one.
- **fonts**: `heading`, `body` and `code`, each a family with fallbacks.
- **textStyles**: named looks (`title`, `subtitle`, `body`, `caption`, `code`,
  `citation` and a few more): size in points, colour token, font role.
- **layouts**: named layouts with placeholders (slots). A placeholder has a
  role (`title`, `body`, `image`, ...), a box, a text style and a prompt. A layout
  also has a `label` (what people call it; the `name` is what slides refer to), and
  may carry its own decoration and background, see *Layouts of your own* below.
- **master**: elements drawn on every slide, such as a header bar, a logo and a
  slide number. A layout can hide them.
- **newSlideLayout**: the name of the layout a new slide starts from when the person
  chose "my default layout"; the blank layout when it is absent or names a layout the
  theme does not have.

### Layouts of your own

The twelve layouts of the built-in themes are not the only ones. A layout may carry:

- `elements`: shapes, pictures and words drawn on every slide of the layout, over the
  master's and under the slide's own elements. They are ordinary elements (a code block
  or a formula is saved as the group of shapes it is drawn with) and are not selectable
  on a slide: changing them changes every slide that uses the layout. Element ids are
  unique inside one layout.
- `background`: what fills a slide of the layout that has no background of its own
  (a slide's own background wins).
- `hideMaster`, as before.

A slot a person made takes the role it is given (`title`, `subtitle`, `body`, `text`,
`image`, `caption`; a second of a kind is `body2`, `image2` ...). Its look is a named text
style; when the person set the words in it differently from the theme (a bigger centred
title, say) the layout has a text style of its own for it, named for the layout and the
slot (`poster.title`), which a copy of the layout copies and deleting the layout takes away.

A slide follows its layout by what it leaves out: a placeholder element with no `x`, `y`,
`w` or `h` of its own stands where the layout puts the slot, so changing the layout moves
it, while one that was moved by hand has a box of its own and stays. `reset_slides` takes
the boxes away again and adds the slots the slide lacks.

The editor saves a slide as a layout (`save_layout`), designs a layout on a slide made
of it (`set_layout_design`), and renames, copies, orders, deletes (`delete_layout`, the
slides that use it move to another layout) and imports layouts (`import_layouts`). Applying a
built-in theme (`apply_theme`) keeps the layouts a person made after the theme's own twelve.

In a PowerPoint file a layout of your own is a layout of the file: its decoration and
background are written on the layout, its slots are its placeholders, and slides of it
point at it. Reading a PowerPoint file still puts what a layout draws on each slide that
uses it.

Anywhere a colour is wanted, write a token (`accent2`) so it follows the theme,
or a hex value (`#1a73e8`) for a colour of its own.

### Slides

```json
{
  "id": "s-91c2ab3d",
  "layout": "title-body",
  "notes": "Say this first.",
  "hidden": true,
  "backup": true,
  "steps": 7,
  "transition": { "kind": "morph", "duration": 0.6 },
  "elements": []
}
```

`elements` run from the bottom of the stack to the top. A `hidden` slide is
skipped when presenting. A `backup` slide is stacked under the slide above it
and reached only by going down; the first slide cannot be one.

### Marks on an assistant's work

A slide may carry `x-agent`: the elements an assistant (an AI agent working through the tools) made or
changed and nobody has looked at since, so that an editor can badge them until the person changes them or
accepts them.

```json
"x-agent": [{ "at": 1790000000000, "by": "claude-code", "ids": ["e-4b1e0x9a", "e-77c0a1d2"], "session": "01K8Z3K6Q2M4X7V9B1C5D8E0F2" }]
```

A batch is the elements one agent made or changed, on this slide, up to `at` (milliseconds since 1970). `by` is
the agent's client, `ids` are the elements (at any depth) and `session` is the agent's session, which a host can
undo as a whole; it may be left out.

- **The tools write them.** After a change, the tools an agent works through mark what differs between the deck
  they read and the deck they made, and keep the marks the deck already had on what the change left alone. Whatever
  marks an agent's output carries are set aside: an agent can neither add nor take off a mark itself, and it
  is refused `accept_marks`.
- **An edit takes them off.** An operation that changes an element or deletes it takes its mark off in the same
  step of undo, whoever runs it. Moving an element in the stack is not changing it.
- **Accepting takes them off** and changes nothing else: `accept_marks { slide?, ids? }` for the elements given,
  for a slide, or for the whole deck. It is one step of undo.
- A copy of a slide is as marked as the slide. A field that is not a list of batches is kept as it is and read
  as no marks.

It is a field like any the model does not list (it is kept in `extra`), so builds that do not know it keep it, and
the format's version does not change. `fixtures/decks/agent-marks.deck` is a small deck that has them, with two
batches on one slide.

### Elements

Every element has an `id` (unique on its slide) and a `type`. Two slides may
give the same id to an element on purpose: that is how a Morph pairs them.

| Common field | Meaning |
| --- | --- |
| `x`, `y`, `w`, `h` | The box in slide units. Left out when a placeholder supplies it. |
| `rotation`, `flipH`, `flipV` | Turn (degrees) and mirror. |
| `placeholder` | The layout slot this element fills. |
| `style` | `fill`, `stroke`, `radius`, `shadow`, `opacity`, `startArrow`, `endArrow`. |
| `stepStates` | The state (`hidden`, `dimmed`, `normal`, `highlighted`) from each step onward. |
| `name`, `alt`, `locked`, `link`, `morphId` | Layer name, alt text, lock, address, Morph link. A `link` is a web address, `slide:<id>`, or `page:<path>` for a page of the host. |
| `source` | The page of the host the element was made from or points at (see *Pages of the host*). |

The types:

- **`text`**: a text box; `text` holds the words.
- **`shape`**: a PowerPoint preset (`rect`, `roundRect`, `ellipse`, `triangle`,
  `rtTriangle`, `diamond`, `chevron`, `rightArrow`, ...), optionally with text.
- **`line`**: a free line or arrow, from the box's top left to its bottom right.
- **`connector`**: a line attached to two elements' sides (`from`, `to`); its
  box always follows them.
- **`image`**: `src` is a file in the host's image store, such as
  `assets/figure.png`; optional `crop` and `mask`. A picture is stretched to its
  box; `"fit": "cover"` makes it fill the box without being stretched instead,
  cut at the sides or at the top and bottom to the box's shape (a `crop` of its
  own comes first). A picture drawn from a diagram may carry `x-diagram`, the
  host's name for that diagram (in KastenFlow a vault path such as
  `library/Login-flow.drawio`), so the host can offer to edit it. It is a field
  the model does not list and so is kept like any other; a PowerPoint file
  carries only the picture, which is a PNG.
- **`group`**: `children`, in slide coordinates; it moves and scales them.
- **`table`**: `columns` (widths), `rows` of `cells`, and `headerRow`. Cells go left
  to right, skipping places a cell above covers; `colSpan` and `rowSpan` are 1 or
  more and stay inside the table. A table has at most 1000 columns, 10000 rows and
  50000 places (columns times rows): the operations that add or change one refuse a
  bigger table, or a span that reaches past the table, in words that say what to
  change, and everything that draws one (the editor, the export) holds itself to
  the same limits whatever a file claims.
- **`raw`**: what an import could not understand (a chart, a SmartArt diagram, a
  freeform shape, an embedded object, a video), kept as it was. `original` says
  what it was (`pptx:chart`), `xml` is the shape's own XML, `preview` is a picture
  of it if one could be drawn, and the parts that XML points at (a chart, its
  workbook, a diagram's data ...) are under `pptx` in base64, so a PowerPoint
  export writes the object back whole, moved to where the element is now. Where
  a file cannot be written back (the XML or a part is missing or unsafe), the
  export draws the `preview` instead. The editor shows the preview, or a grey
  box with a label, and never changes what is inside. Only an import makes a raw
  element: the tools an assistant works with refuse to add one or to change one
  that is there (it can still move, resize, copy and delete it). An export writes
  back only what shows something: charts with their styles and workbook, diagrams,
  pictures, sound and video, and hyperlinks to web pages and mail addresses. An
  embedded file or object of another program, a macro, and a link that is fetched
  when the file opens are left out, the object is drawn as its `preview` instead,
  and the export's warnings name what was left out.
- **composites**: `code`, `math`, `chat`, `token-probs`, `card-grid`,
  `citation`, `step-label`, `embed`, `video`, `chart`, `timer` and `qr`. Each has
  a few fields of its own and is drawn as the elements above; see *Composite
  elements* below.

### Text

Text is stored as runs, not Markdown, so a colour or a size on one word
survives a trip through PowerPoint.

```json
{ "paragraphs": [
  { "list": "bullet", "runs": [{ "t": "Plain " }, { "t": "bold", "b": true }, { "t": " and a " }, { "t": "link", "link": "https://example.com" }] }
], "valign": "middle" }
```

A run has `t` and, when they apply, `b`, `i`, `u`, `s` (bold, italic,
underline, strike), `color`, `size`, `font`, `link`, `code` and `math`, and
`script` (`super` or `sub`), `smallCaps`, `allCaps` and `spacing` (extra space
between letters, in points). A paragraph has `align`, `list` (`bullet` or
`number`), `level` (0 to 8), `style`, and spacing (`lineSpacing`,
`spaceBefore`, `spaceAfter`). No list means a plain paragraph.

A list item can also say how its marker looks and where it sits:

- `listStyle`: `disc`, `circle`, `square`, `arrow`, `check` or `dash` for a
  bullet; `decimal`, `decimalParen`, `lowerAlpha`, `upperAlpha`, `lowerRoman` or
  `upperRoman` for a number. Without it the level decides (disc, circle and
  square for bullets; 1. a. i. for numbers).
- `start`: a numbered item counts from this number, which restarts the list or
  continues one that something else interrupted. Items that follow count on.
- `bulletColor` (a theme colour or `#rrggbb`) and `bulletSize` (a multiple of
  the words' size, 0.25 to 4): the marker's own colour and size. A marker
  follows its paragraph's words, the first run's size and colour, until told
  otherwise.
- `marginLeft` and `indent`: where the lines after the first start and where the
  first starts from there (negative hangs the marker out), in slide units. The
  level and the room the marker needs decide when they are left out.

A paragraph with no words holds one empty run, `{ "t": "" }`, and that run's
`size`, `color` and the other settings are the paragraph's mark: they say how
tall its line is and how large its marker is, and words typed there take them.

A text has `valign`, `insets`, `fit` (`none`, `shrink` or `resize`: what the box
does when its words do not fit) and `wrap` (`false` keeps each paragraph on one
line).

Operations accept Markdown and turn it into runs; the file always holds runs.

## Steps

A slide with `steps: 7` has seven clicks after it appears, so eight **states**:
state 0 is what shows when the slide appears and each click moves one step on.
A slide has at most 50 steps. An element says how it looks from a step onward,
until its next entry, in `stepStates`; with no entry it is normal, and at step 0
too.

```json
{ "id": "e-llm", "type": "shape", "shape": "roundRect", "x": 210, "y": 250, "w": 110, "h": 64,
  "stepStates": { "0": "hidden", "2": "highlighted", "3": "dimmed" } }
```

| State | On the slide |
| --- | --- |
| `hidden` | Not shown. The editor draws a dashed ghost where it is. |
| `dimmed` | Shown at the theme's `dimmedOpacity` (0.25 in the built-in themes). |
| `normal` | As styled. |
| `highlighted` | As styled, with the theme's `highlight` drawn round it: an outline of a colour and a width, standing 2 units off. |

A group's state is its children's too: what a group hides, it hides whole. A
paragraph of a list can carry `step`, the step it appears at, and is hidden
until then, so a list can build line by line. A `step-label` element says
"Step n / N" and a `code` element's `focus` entries take one step each; they use
these same steps.

Three operations set them, each one step of undo:

- `set_slide_steps { slide, steps }` sets the number of steps. Raising it adds
  empty steps. Lowering it moves what the removed steps did onto the last step
  that stays, so the slide ends up looking as it did at the end.
- `set_step_states { slide, id, states }` merges entries into one element's:
  `{"0": "hidden", "2": "normal"}`, and `null` takes an entry away. The slide
  gets as many steps as the highest one named.
- `build_steps { slide, ids, recipe }` builds the steps of several elements at
  once. The elements are taken in reading order, top to bottom and then left to
  right (boxes a little out of line still read across, and a connector lies in the
  row of the boxes it joins). The recipes:
  - `reveal`: the elements appear one by one, from step 1. A single text box with
    a list appears item by item instead, one paragraph to a step.
  - `walkthrough`: each element in turn is `highlighted` while the others are
    `dimmed`; the slide arrives as it is, and the first click highlights the first.
  - `spotlight`: the same, but the element in turn is left as it is (`normal`),
    with no outline. It needs two elements or more.
  - `clear`: takes every state and paragraph step from the elements.

  A recipe replaces the states of the elements it is given, leaves every other
  element alone, and sets the slide's steps to what it needs.

### In a PowerPoint file

PowerPoint's own animations do not survive Google Slides or Keynote, so a slide
with N steps becomes **N + 1 slides**, in order, each drawn as the editor draws
that state: hidden elements are left out; a dimmed element is drawn at the theme's
dimmed opacity (a file has no opacity for an element, so its fill and line are
see-through by that much and its text is mixed toward the colour behind it, which
every program shows alike: the slide's, or that of the shape it lies on, such as the
panel of a code block; over a picture the text is made see-through instead); a
highlighted one is followed by an outline shape of the
theme's colour and width; list items that have not come yet keep their room and show
nothing; the step label says the step.

- The title placeholder gets ` (k/N+1)` after it **in the file only**: `ReAct (3/8)`.
- Each of the slides carries the original notes and then a last line naming the
  slide and the page, `[kasten s-91c2ab3d step 3/8]`.
- A hidden or backup slide is hidden, or left out, on all its pages. A section
  starts at the first page of its slide and holds all of them. A link to a slide
  goes to its first page.
- `slides export deck.deck --steps final`, and `steps: "final"` in the editor's
  export options, write one slide for each slide instead, in the state after the last
  click.

## Composite elements

Some things are worth storing as what they mean, not as the shapes they are
drawn with: a block of code, a formula, a chat, a set of cards. A **composite**
has a few fields of its own, and `slides-core` works out the text boxes, shapes,
lines and pictures it is drawn with, its **expansion**. The editor, present mode,
the `slides` command and the PowerPoint export all draw that expansion, so a
composite looks the same in each.

| `type` | Fields, besides the common ones | Drawn as |
| --- | --- | --- |
| `code` | `code`, `language`, `theme` (`dark` or `light`), `lineNumbers`, `firstLine`, `focus`, `fontSize` | A rounded panel of monospace text coloured by syntax. |
| `math` | `latex`, `inline`, `color`, `fontSize` | One picture of the formula. |
| `chat` | `messages`: `role` (`system`, `user`, `assistant`, `toolCall`, `toolResult`) and `text` | A bubble for each message. |
| `token-probs` | `tokens`, `next` (`token` and `p`), `chosen` | Chips for the words so far and a bar for each likely next token. |
| `card-grid` | `cards` (`title`, `body`), `columns` | Rounded cards in a grid. |
| `citation` | `keys` (BibTeX keys), `format` (`short`, `numbered`, `full`, `list`) | One small text box. |
| `step-label` | `format` | One text box that says "Step n / N". |
| `embed` | `url`, `poster`, `title`, `design`, `zoom`, `fit`, `reader` | The poster, or a dashed panel that names the page; for a page of the host, a card with the page's words. |
| `video` | `src`, `poster`, `autoplay`, `looped` | The poster, or a dark panel, with a play button. |
| `chart` | `kind` (`bar`, `line`, `pie`), `title`, `categories`, `series` (`name`, `values`, `color`), `labels`, `legend` | Axes, gridlines and the bars, lines or wedges, with a legend. |
| `timer` | `seconds`, `label`, `autostart` | The time left as `m:ss` on a rounded panel. |
| `qr` | `data`, `caption` | The code as black runs on a white tile, with the caption under it; a note when `data` is empty or too long (213 bytes). |

A composite has a box (`x`, `y`, `w`, `h`, or its placeholder's) and the common
fields. `rotation` turns the parts about the middle of the box and `stepStates`
apply to the whole. `style` is not used: the looks come from the theme and the
kind. What every expansion promises:

- The parts have ids `<id>.<n>`, such as `e-code.2`, the same every time. A part
  that is left out (the line numbers, when there are none) still uses its number.
- Colours are theme tokens or hex values. Code and the video panel have palettes
  of their own, chosen for contrast on their own background.
- Text fits by construction. Each kind sets its words at the largest size, up to
  a cap, at which they fit the box, and shrinks them to a floor: 10 pt for code and
  token probabilities, 12 for chats and cards, 8 for references and the step
  label. Below the floor every word is still drawn, even past the edge of the box.
  Words are never cut.
- Whatever the box holds (zero, negative, not a number), every size and position
  that comes out is finite and rounded to two decimals.

### Code

`language` is a name or an extension: `python`, `rs`, `ts`, `text` for none.
Python, JavaScript, Rust, Go, Java, C, C++, C#, Ruby, PHP, SQL, HTML, CSS, XML,
JSON, YAML, Markdown, shell scripts, diffs and a few more are coloured with syntax
definitions built in; TypeScript, Kotlin, Swift and TOML, which they lack, with a
small lexer; any other is left plain. Only the first 240 lines are coloured and a
line longer than 2,000 bytes is left plain. A tab counts as four columns. Line
numbers start at `firstLine` (1 when absent) and stay bright while the code dims.

Without `focus` the code is one text box with a paragraph for each line, so it
stays editable in PowerPoint. `focus` makes a walkthrough: one entry for each
step, naming the lines in focus at that step; the others are dimmed. An entry is
a line (`3`), a range (`2-4`), a list (`4,6-10`), a range open at the end (`3-`)
or `all`. Lines are counted from 1 at the top of the code, whatever `firstLine`
is. Step 0 shows every line, and so does a step whose entry names no line of the
code. Each line is then a text box of its own with its states in `stepStates`;
past 200 lines the code stays one text box and does not dim.

### Math

PowerPoint cannot typeset LaTeX, so a formula leaves the deck as a picture. The
expansion is one picture of the whole box, with the LaTeX as its alt text,
named after what is in it: `math/`, 16 lower-case hex digits and `.png`. The
digits are the FNV-1a hash (64 bits) of these, each followed by a zero byte: the
LaTeX; the colour as written, nothing when absent; the size in points as `{}`
prints it, 32 when absent; and `i` for an inline formula or `d` for a display
one. `E=mc^2` is `math/5236592fa920b5e6.png`. `math_image_path` in `slides-core`
works the name out; a host in another language can compute it the same way.

The editor draws formulas itself, with KaTeX. To export PowerPoint it makes a
picture of each formula and hands it over under its name. The picture is in the
element's colour, or the theme's text colour when there is none, and the name
does not say which; a host that keeps pictures from one export to the next should
keep them for each theme. When the picture for a name is not there, the export
writes the LaTeX as italic text, centred in the box, and adds a warning.

### The others

- **`chat`**: the user's messages sit on the right in the accent colour, the
  model's on the left, and a system prompt takes the whole width. A tool call is
  outlined and set in the code font after an arrow; a tool result is tinted and
  in the code font. All bubbles are set at one size.
- **`token-probs`**: `tokens` flow as chips that wrap like words; a space in a
  token shows as a dot and a line break as `\n`. Each of the first eight `next`
  tokens has a row with a bar as long as its probability `p` (0 to 1) on a track
  as long as 100%; the rest are counted, "+3 more". The token `chosen` (an index
  into `next`) is drawn in the accent colour and in bold. If the chips do not fit,
  the earliest are left out behind a chip of dots.
- **`card-grid`**: the columns come from the number of cards unless `columns`
  names them; all cells are the same size and all cards are set at one size.
- **`citation`**: a key names a work in a bibliography, which the host gives as
  BibTeX (KastenFlow reads the `.bib` files of the vault; `slides dev` and the `slides`
  command read the `.bib` files beside the decks, `refs.bib` for one). `short`, the
  default, is who, when and where: `Vaswani et al., 2017 (NeurIPS)`, works joined by
  `;`; `numbered` is `[1][2]`, the number the deck gives each work (a work is numbered
  when it is first cited, counting through the slides in their order and, on a slide,
  through the citations from the top left to the bottom right, so `[3]` is the same
  work on every slide); `full` is a whole reference on a line for each key; `list`
  prints every work the deck cites, each with its number, for a references slide (its
  own `keys`, if any, are listed as well). A key the bibliography does not have is
  written as itself with a `?` after it, and lint reports it as an error; with no
  bibliography at all keys are written as they are (`(key1; key2)`) and are not
  checked. The `add_citation` operation puts keys in a slide's footer citation, the
  element named `citations`, and makes one along the bottom margin if there is none.
- **`step-label`**: one run that stands for the field `stepLabel`, which
  whoever draws the slide fills in with the current step, in the wording of
  `present.stepLabel`. `format` changes only the sample shown while editing.
- **`embed`**: present mode shows the live page; everywhere else it is the
  `poster`, or a dashed panel with the `title` (or the site's name) and the
  address. Every part links to `url`. Only `http` and `https` addresses are links.
  How the page sits in its box is told by `design`, `zoom` and `fit`; see *A page at
  the size of a window*. An embed with no `url` and a `source` is a page of the host.
- **`chart`**: `bar` and `line` draw one group of bars or one line for each series
  against `categories`, on axes that start at zero and end on a round number;
  `pie` draws the first series as wedges, with a legend that names each and its
  share. Colours are the theme's accents in order unless a series names one. At
  most 40 categories and 12 series are drawn, names are cut at 120 characters and
  the title at 200, and a number that is not finite is a zero.
- **`timer`**: `seconds` (up to 24 hours less a second) is drawn as `m:ss` or
  `h:mm:ss`, with `label` over it. `autostart` is kept for a presentation that counts
  down; the editor does not offer a timer yet, so it is made by a file or an assistant.
- **`qr`**: byte mode at error correction level M, versions 1 to 10. The code is
  drawn as rectangles in black on a white tile (a scanner needs that contrast
  whatever the theme), so it exports to PowerPoint as shapes.
- **`video`**: present mode plays `src`; everywhere else it is the `poster`, or a
  dark panel with the file's name, and a play button. A `src` that is a web
  address is also the link of every part.

The `poster` of an `embed` or a `video` is a picture with `"fit": "cover"`, so a
still that is not the shape of the box fills it without being stretched, on the
slide and in PowerPoint alike. The words on a panel without a poster are set at
14 points or more wherever the box has room for them.

### A page at the size of a window

A web page is designed for a window, not for a box of 640 by 360. Laid out at the
box's own size it would be squeezed into its phone layout, so an `embed` says what
window the page is laid out for and the whole is scaled to the box:

- `design`: `{ "w": 1280, "h": 800 }` by default (Desktop). The editor offers
  Desktop 1280 by 800, Wide 1440 by 900, Slide 1280 by 720, Tablet 820 by 1180,
  Phone 390 by 844, Narrow page 640 by 360, or a size of your own from 200 to 4000.
- `fit`: how the page meets the box when there is no zoom. `width` (the default)
  lays the page out at the design's width and as tall as the box needs, so its
  width fills the box; `page` shows the whole window, with bars where the box has
  another shape; `fill` covers the box and cuts off what does not fit.
- `zoom`: from 0.25 to 3, a fixed zoom as a browser's: the page is laid out as a
  window of the box divided by the zoom. Left out, the page follows the box (Fit).
  Ctrl and plus, minus or zero change it for the selected embed, and the wheel with
  Ctrl does too; in a presentation the same keys zoom the page while it has been
  clicked to use, for that showing only.
- `reader`: the readable text of the page, where the host can make it.

A page of the host is laid out at 640 by 360 unless it says otherwise. Whatever
the box, the page keeps its layout, fonts and proportions; resizing the box only
changes the scale. Only the slide being shown has live pages: the others draw the
`poster`, the snapshot of the page.

### Pages of the host

A host that has pages of its own (KastenFlow has notes) lets a deck use them. The deck
never reads the host's files: the host reads a page and hands over its Markdown,
and what the deck keeps is in the element's `source`:

| Field | Meaning |
| --- | --- |
| `page` | The page, as the host names it (in KastenFlow a vault path such as `projects/talk/plan.md`). |
| `id`, `title`, `icon` | The host's stable name for the page, and what it was called, when it was read. |
| `section` | The heading whose section it is; the whole page when absent. |
| `kind` | `embed` (a live page), `contents` (its words as slide elements), `section`, or `link`. |
| `sync` | Flag the element when the page changes, so it can be updated. |
| `hash` | A fingerprint (16 hex digits, FNV-1a) of the Markdown it was made from; it ignores line endings and blank lines at the end. |
| `markdown` | For an embedded page only: the page's words as read, which is what is drawn where the page cannot be read. |

A link to a page is `page:` and the page's path with spaces and the marks of
Markdown written as `%20` and the like, then `#` and the heading for a section.
Wiki links (`[[Page|words]]`) in a page's Markdown become such links.

Three operations work from the Markdown the host read, so they work wherever the
deck is: `add_page_contents` puts a page (or one section of it) on a slide as a text
box that shrinks to fit, with its pictures, tables, code and formulas beside or
under it; `update_page_contents` makes an element that was made that way again from
the page as it is now, keeping its id, name, steps, link and place; `add_page_slides`
cuts a page at its headings into slides. The reading handles headings, paragraphs,
bullets, numbers and to-dos with indents, quotes and callouts, fenced code, tables,
pictures, block formulas, rules and toggles; what it does not know it keeps as words.
"Break link" is a `patch_elements` that removes `source`. PowerPoint cannot open a
page of the host, so an export leaves `page:` links out and says so.

### Steps follow content

A code block with three `focus` entries needs three steps. The operations that
change what is on a slide (`add_elements`, `patch_elements`, `paste_elements`
and `duplicate_elements`) raise the slide's `steps` to what its composites need,
up to the 50 a slide can have, and never lower them.

### Ungroup to shapes

`expand_composite { slide, id }` replaces a composite by a group of its parts,
in the same place in the stack. The group keeps the composite's id, name, alt
text, steps and link, and the parts are `<id>.<n>` unless something on the slide
already has that id. What made it a composite (the code, the messages, the cards)
is gone from the deck, so use it when the shapes need editing one by one. It is
one step of undo, and it is refused for anything that is not a composite and for
`math`: a formula is drawn as a picture made from its LaTeX, so there are no
shapes to make (change its `latex`, or replace it with a text box).

### Sections

A section is a named stretch of the deck. `sections` lists them, each with a
`title` and the slide it `startsAt`; it lasts up to the slide before the next
section, and slides before the first one are in none. `add_section { at, title }`
starts one at a slide (refused if one already starts there), `rename_section
{ at, title }` renames it and `remove_section { at }` takes its header away; the
slides are never touched, and each is one step of undo. When the slide a section
starts at is deleted, the section starts at the next slide that stays. `move_slides`
does the same when that slide is moved without the rest of the section, and
takes the section along when all of its slides move.

## Importing a PowerPoint file

`slides import deck.pptx -o deck.deck` (and the editor's *Import slides from
PowerPoint…*) reads a file from PowerPoint, LibreOffice, Keynote, Google Slides
or python-pptx into a deck: text with its runs and lists, shapes and lines,
connectors that name what they join, pictures with their crop and mask, groups,
tables (with the fills their style gives), notes, hidden slides, sections, and
the theme, layouts and master. What a deck cannot hold becomes a `raw` element,
and everything else that was changed or left out is listed in the report, which
names the slide. A file this crate exports imports as the deck it was made from,
to within half a unit. The slides can be added to a deck (in its own look),
replace it, or come in as a new version of it: an export puts `[kasten <slide id>]`
last in each slide's notes (`markers` in the export options), and a new version is
matched to the deck by those, so slides, boxes and words that are still in the file
keep their ids. Slides that only differ by a box or two (a build made by copying)
can be collapsed into one slide with steps, when asked (`collapse_slides`); nothing
is collapsed on its own.

## Changing a deck

Every change is an operation, defined once with a typed input: `add_slide`,
`transform_elements`, `set_text`, and the rest (`slides ops` lists them). The
editor, the `slides` command and agents all use the same ones, and every
operation can be undone exactly.

## Format changes

- **1**: the first version. A layout's `elements` and `background` and the theme's
  `newSlideLayout` were added to it without a new version: an older build keeps what it
  does not know and writes it back, and draws a slide without the layout's decoration.

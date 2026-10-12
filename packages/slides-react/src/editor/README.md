# The deck editor

`SlidesEditor` is the whole editor: menus, toolbar, filmstrip, the slide, notes
and panels. It runs on a `SlidesHost`, which is everything it needs from the
place it lives in (saving, images, downloads), so the same editor runs inside
KastenFlow, in the `slides dev` page and in tests.

## How it is put together

```
SlidesEditor (SlidesEditor.tsx)         makes an EditorSession and an EditorUi, lays out the regions
├─ TitleBar     titlebar/               one slim row: name and star, saving status, the menus (MenuBar, or one Menu button when narrow),
│                                       the menu search (Alt+/), the assistant, full screen and Slideshow
├─ Toolbar      toolbar/                one row of groups that follows the selection, with a "more" menu for what does not fit
├─ Filmstrip    filmstrip/              thumbnails, reorder, sections
├─ Gallery      gallery/                the images drawer: search, filters, drag onto the slide, where each is used
├─ SlideCanvas  canvas/                 the slide, selection, handles, guides, the text editor
├─ NotesPane    notes/                  speaker notes, folded by the strip over them
├─ OutlineView  outline/   GridView grid/    the other two views
├─ PanelHost    panels/                 the side panel's width (drag its edge) and how it opens; SidePanel has the tabs:
│                                       format options, themes and layouts, transitions, steps, the assistant
├─ Dialogs      dialogs/                find and replace, layouts, theme, background, shortcuts …
└─ ContextMenus menus/                  right-click menus
```

### The chrome (`chrome/`)

What the bars and panels need that is not the deck's and not the window's: `Chrome` (`chromeOf(ui)`, `useChrome`,
`useChromeValue`) holds how roomy the bars are (`density`, "Compact toolbars" in the View menu, a `data-density` on the editor), the
side panel's width, which sections of the format options are folded and whether the menu search is asked for; every choice about
taste is kept in the browser (`storage.ts`, always in a try/catch). `recents.ts` keeps the fonts and colours used lately,
`overflow.ts` decides which groups of the toolbar go into the more menu, `scrub.ts` is the arithmetic of dragging across a number.

### The toolbar (`toolbar/`)

`slots.ts` says which groups the row has for what is selected (`useBarMode.ts` reads the selection: nothing, text, a shape, a diagram
picture) and how soon each goes into the more menu (`drop`: 0 never). A group is a `Group` (`Group.tsx`) that draws itself only where it
is shown, so the same list is drawn in the bar and, for the groups that did not fit, in the more menu. `useOverflow.ts` learns each
group's width as it is drawn. Every button has `data-ks-keep-focus` and a name; a control that does not apply is left out.

Every region is a component taking `{ session, ui }` and nothing else.

### `EditorSession` (`session/`) — the deck being edited

* `session.state` (React: `useEditor(session)` or `useEditorValue(session, select)`): `deck`, `slideId`,
  `selection` (element ids in view), `inside` (the groups gone into, outermost first), `slideSelection` (slides picked
  in the filmstrip), `editing` (element whose text is open), `tool`, `canUndo/canRedo/undoLabel/redoLabel`,
  `saving`, `revision`. A region that shows a part of this follows that part (`useEditorValue`), so a save or a drag
  that has not ended does not draw it: the toolbar's groups each follow what they show.
* `session.slide`, `session.deck`, `session.host`, `session.scope` (the elements in view: the slide's own, or what the
  group gone into holds; `session/scope.ts` has `findElement`, `scopeOf`, `selectedElements`).
* Navigation and selection: `goTo`, `goBy`, `select(ids, "replace" | "add" | "toggle")` (of the elements in view),
  `selectAll`, `selectSlides(ids, show?)`, `setTool`, `startEditing`, `stopEditing`, `enterGroup(id, child?)`,
  `leaveGroup` (one level up, selecting the group left), `leaveGroups`, `undo`, `redo`, `flush`. A double click on a
  group (or Enter) goes into it; Escape goes up; a press where the elements in view have nothing comes out.
* `session.slides`: `add` (a blank slide unless a layout is named; `likeCurrent` copies the layout of the slide shown),
  `duplicate`, `remove`, `move`, `moveBy`, `setFlags`, `setLayout`, `setNotes`, `setBackground`, `applyTheme`, `setTitle`,
  `setSlideNumbers` (the deck's `set_present`), `setDeckTransition` (the transition of slides that name none),
  `setPageSize` (`{ preset }` or `{ w, h }`: refits every slide and the theme). Callers that follow the person's choice
  of what New slide makes use `addSlide(session, ui)` (`new-slide.ts`).
* `session.elements`: `insert`, `patch`, `style`, `transform`, `place`, `nudge`, `remove`, `arrange`, `group`,
  `ungroup`, `align`, `distribute`, `duplicate`, `flip`, `rotateBy`, `lock`, `setText`, `replaceAll`,
  `find`, `boxOf`.
* `session.steps`: `setSteps`, `addStep`, `removeStep`, `setState` (one element at one step), `setParagraphStep`, `build`
  (`reveal`, `walkthrough`, `spotlight`, `clear` on the selection, or on every element but the title). The Steps panel
  and the Slide menu use these.
* `session.text`: formatting of the words of whole selected elements (`state`, `toggle`, `setRun`,
  `setAlign`, `toggleList`, `indent`, `setLineSpacing`, `clearFormatting`).
* `session.clipboard` (blocks): `copy(ids?)` and `cut(ids?)` answer a clip (the elements with the boxes they occupy, the slide
  they came from, whether they were cut), `pasteElements(clip, { inPlace })` (16 units down and right on the slide copied from,
  16 more for each further paste of the same clip, where they were on another slide; a cut comes back exactly; one
  `paste_elements`), `pasteText(words, at?)`, and `paste(source?)` for plain text or the last copy.
  `session.slideClipboard` (slides): `copy(ids?)`, `cut(ids?)`, `paste(clip, { gap? })` (one batch: `add_slides`, a
  `move_slides` to the start, and the `add_section`s that do not cut a section in two); a slide whose layout the deck
  lacks gets one it has and its slots become plain boxes. The clips, the system clipboard (the copy, cut and paste
  events in `clipboard/events.ts`, the asynchronous API for the menus in `clipboard/system.ts`), where a paste is
  meant (`clipboard/place.ts`: the slides of a list, the blocks of the slide, or something with its own clipboard)
  and what a paste does with a picture or words (`clipboard/paste.ts`) are in `clipboard/`. The keys of copy, cut
  and paste are the browser's own (`Command.native`): `dispatchKey` leaves them alone, so the event comes.
* `session.core` is the WebAssembly engine, for the commands in `session/` only.

Everything that changes the deck is one engine operation, so it is one step of undo. A view never
edits the deck itself. The one exception to "one operation, one step" is a text box made just now: the first words typed
into it are applied with `applyIntoLast`, which keeps them in the step that made the box, so one undo takes both back.

### `EditorUi` (`ui-state.ts`) — the window

`ui.state` (React: `useUiState(ui)`): `view` (`edit`, `outline`, `grid`), `panel`, `dialog`, `zoom`,
`fitZoom`, `notesOpen`, `snap`, `filmstripOpen`, `paint`, `text` (the open text editor's handle),
`contextMenu`, `previewStep` (the step of the slide shown on the canvas, null for the slide as styled), `fullScreen`,
`lintBadges`, `newSlides` (`blank` or `same`: what New slide makes, kept in the browser's `localStorage`),
`transitionPreview` (a transition being played once on the canvas). Methods: `setView`,
`togglePanel`, `openPanel`, `openDialog`, `setZoom`, `stepZoom`, `toggleNotes`, `toggleSnap`, `toggleFilmstrip`, `setPaint`,
`openContextMenu`, `setPreviewStep`, `setFullScreen`/`toggleFullScreen`, `setLintBadges`/`toggleLintBadges`, `setNewSlides`,
`playTransition`/`endTransitionPreview` (the Transitions panel plays what is picked on the slide beside it), `zoomBy(factor, about?, to?)`
(a wheel or a pinch: continuous, about a place in the window) and `takeZoomIntent()` (what the canvas reads of the last zoom).
`setZoom(zoom, { about, instant })` says which place stays where it is and whether the zoom glides. `useUiState(ui)` draws a
component again only for the keys it read while drawing (a component that reads none follows every change, and `actionsRevision`
always reaches every caller). `ui.actions` holds what
the host lets the editor do: `present`, `exportAs`, `print`, `close`, and `fullScreen` (optional). `ui.areas` notes where the focus
last was and which regions select all of what they hold (see "Selecting text").

### Motion (`motion.ts`)

Things that move (the filmstrip's rows going to their places and a new slide sliding in, handles and outlines fading in, a
transition previewed on the canvas) ask `motionOn()`: it is off when the page says `data-motion="off"` (KastenFlow's motion
setting, which also zeroes its `--motion-*` tokens, mapped to `--ks-fast`), and, when the page says nothing, when the computer
asks to reduce motion. `play(node, keyframes, options)` does nothing in a browser without `Element.animate`. The filmstrip
moves rows by FLIP from the layout's own numbers (`filmstrip/row-motion.ts`), never by measuring. The durations and the
easing are the host's tokens: `--ks-fast`, `--ks-base`, `--ks-slow` and `--ks-ease` (KastenFlow maps `--motion-*` and
`--ease-standard` onto them), read through `fastMs`, `moveMs`, `slowMs` and `EASE`.

### A gesture on the slide (`canvas/`)

`CanvasController` turns the pointer into previews (boxes, guides, the rectangle, the angle) and, when the pointer is let go, one
engine operation. Nothing in React follows the pointer step by step for the slide: `LiveLayer` (`live.ts`, wired by `useLive`)
writes each step to the page in the same event, and the canvas component is drawn again only when the kind of gesture changes
(`controller.subscribeGesture`). A move is `translate` on the element and on the selection's frame, handles and chip
(`data-chrome`), a turn is `rotate` about the middle, a resize of up to `EXACT_LIMIT` elements is drawn exactly (the box goes to
`render/live.ts`'s `LiveBoxes`, which only the view of that element watches, so its words run on) and a resize of more, or of a
group, is a stretch (`scale`), exact again when the pointer is let go. Alt or Ctrl held on a move slides stand-ins and the copies
are made at the end (`duplicate_elements` with an offset). `live-math.ts` holds the sums (`lookOf`, `sizingOf`).
`GestureLayer` draws what comes and goes with a gesture and nothing else: the guides (at most `MOST_LINES` lines and `MOST_GAPS`
gap marks, which fade out), the selection rectangle, the shape being drawn, the size or angle readout. Everything the layer wrote
is taken away in the event that ends the gesture, before the operation is applied; Escape glides what was slid back.

`stage-zoom.ts` zooms about the pointer for a wheel with Ctrl or a pinch (a listener that is not passive), and for any other zoom
(`ui.setZoom(zoom, { about, instant })`) lays the slide out at its new size and lets the browser glide it from the old one; the
stage scrolls to keep the place under `about` where it was. `pan.ts` pans with the middle button or Space held, `edge-scroll.ts`
carries the stage when a drag reaches its edge. `glide.ts` glides the elements an undo, a redo, an align or a quarter turn moved
(`state.settle`; `session.glide(change)` marks such a change) and fades another slide in.

Taps of the arrow keys on the same elements, with nothing between them, are one step of undo (`ElementCommands.nudge`,
`BURST_MS`). The filmstrip's drag holds copies of the thumbnails under the pointer (`DragBadge`), closes the rows up behind them
and opens a gap where they would land (`gapShifts`, `useGapShifts`), scrolls by itself near its edges, and lands the slides
where they go (`useLanding`); a deleted slide's row folds away (`leaveRow`).

### Page setup, templates and presenting at any ratio

File → Page setup… (`dialogs/PageSetupDialog.tsx`) offers the engine's named sizes (`pageSizes()`: 16:9, 16:10, 4:3, 1:1) and a
custom width and height in inches, and runs `set_page_size` as one step of undo. The themes (`panels/format/themes.ts`) each have a
sample deck with its example slides, which the theme dialog draws small on each card. A slide is always presented whole and centred
at its own proportions; Present options (title bar) chooses the matte round it (`present/matte.ts`: black, the theme's
background or its dark colour, kept in the browser).

### Full screen

View → Full screen, the title-bar button and Ctrl+Shift+F put the editor over the whole window of the app it runs in
(`.ks-editor.is-fullscreen`, `position: fixed; inset: 0`, at `--ks-fullscreen-z`, 1000 unless the host sets it lower). It is not the
monitor's full screen: the browser's Fullscreen API is not used, so the editor's own title bar, menus, toolbar, filmstrip, canvas
and panels are what is left of the window, and nothing of the host's chrome shows around them. `watchFullScreen` (`full-screen.ts`)
marks the body with `data-ks-fullscreen` while it is on (the page cannot scroll behind the editor, and a host may hide its own
chrome with the attribute), tells the host through the optional `ui.actions.fullScreen(on)` (a desktop shell may take its own
window full screen), and leaves the mode on Escape when nothing else took the key: the slide cancels a drag, an edit, a step
preview, the tool and the selection first; a field, a menu, a dialog and a host's `aria-modal` window keep Escape. Back, closing
the deck and unmounting the editor leave it. A host whose panes contain their layout (`container-type`) must lift that while the
editor is full screen, or the fixed editor is framed by the pane (KastenFlow does, in `slides.css`).

### Lint (`lint/`) — problems found while editing

`lintOf(session)` is the session's `LintService`. A change to the deck costs it a comparison of the slides with the
ones it saw last and one timer (well under a millisecond on a deck of 60 slides); after 400 ms of quiet it checks the
slides that changed, one at a time in the browser's idle time. For each it asks the engine what to measure
(`lintProbes`), draws those words off the page with `TextBlock` and reads their sizes (`measure.ts`), and hands the
sizes back with the slide (`lintSlide`), so "does the text fit its box" is answered with the real fonts. A new theme, a
new bibliography (`setReferences`) or fonts that finished loading check every slide again. Views read it with
`useSlideIssues(lint, slideId)` (the badge on a slide in the filmstrip, for errors and warnings) and
`useLintSnapshot(lint)` (the Lint dialog, Tools → Lint, which groups problems by slide, filters by severity, goes to
a problem when its Show button is pressed and says which rules could not be checked).

Lint never speaks unasked. The badges are off until the person turns them on (View → Lint badges, `ui.state.lintBadges`, kept in
the browser's `localStorage`), and while they are off the service does no work of its own: `lintOf` makes it with
`background: false`, and the filmstrip switches it with `setBackground` as the badges are shown or hidden (no timer, no idle time,
nothing loaded). It still notes which slides changed, so turning the badges on checks what changed meanwhile. The dialog does not
depend on it: it asks for a check of every slide (`checkAll`) when it opens.

### Selecting text

Text can be selected wherever it is information, and Select all does what the place asks. One function, `selectAllHere`
(`select-all/`), serves the key (Ctrl+A on the slide, or anywhere no region has a key of its own), Edit → Select all and the
right-click menus: the open text box takes its own words; a field (notes, a name) its text; the outline the text of every row;
the filmstrip and the grid every slide that can be seen; a panel or the images drawer their text; a dialog its words (the dialog
handles the key itself); the slide the elements on it. Where the focus was is `ui.areas.focused` (a menu has taken the focus by
then); regions that keep their own select all register it (`ui.areas.register("slides" | "outline", run)`).

`user-select` is off only for what is a picture or a control: the slide (a drag moves things, except the text box that is open, which
is text all the way down), thumbnails and tiles, buttons, menus and toolbars. Every rule names `-webkit-user-select` too, and inputs
are set to `text` so WebKit keeps them typeable. `select-css.test.ts` reads the sheets and fails on a rule without the prefix, on a
control that could be selected, and on a sheet of a place with words to read that turns selection off.

The outline's fields cannot be selected together, so each has a `Ghost` (`outline/`): its words again as plain text over it,
unseen. A press on the ghost of a field that has not the focus is a press on page text: the browser selects across rows as it
does anywhere, and when the button is up `settle` gives a selection that stayed in one field to the field (its caret, its
selection) and leaves one that reached another row as it is, with the focus on the outline so Escape, Ctrl+A and Ctrl+C reach it.
A field that has the focus is used directly. Copy puts each field on a line of its own (`selectedWords`).

### Commands (`commands/`)

One list of every command (`COMMANDS`), each with an id, label, icon, keys, an `enabled` test and a
`run`. Menus, the toolbar, context menus and the key handler all read it, so a command is named,
enabled and bound in one place.

* `commandOf(id)`, `runCommand(id, { session, ui })`, `isEnabled(command, { session, ui })`,
  `keysOf(id)` (the keys as written on this system), `showCombo`.
* A menu item built from a command: label, icon, `keys`, `disabled` from `enabled`, `checked` from `checked`,
  `run` from `run`.
* Text formatting from anywhere goes through `textFormat` (`commands/format.ts`): with a text box open
  the change goes to its editor, otherwise to all the words of the selected boxes.

### Composites and the insert palette

The nine composite kinds (code, formula, conversation, token probabilities, cards, citation, step
label, embedded page, video) are made, seen and edited here:

* `composite-kinds.ts` names them and says how each starts (`newComposite`); `insert-composite.ts` puts one on the
  shown slide, in the largest free place (`placement.ts`), selected, as one step of undo. Every way in (the Insert
  menu, the palette, the address dialogs) comes through `insertComposite`.
* `commands/composites.ts`: `insert.<kind>` for each kind, `insert.palette` (Ctrl+Shift+P, or `/` when the slide has the
  keys) and `arrange.ungroup-composite` ("Ungroup to shapes", which runs the `expand_composite` operation; not offered
  for a formula, whose expansion is a picture the deck does not keep).
* `dialogs/InsertDialog.tsx`: the palette. It lists what can be inserted, the layouts to add as a slide, the host's
  pictures and every command that can be done now; `palette-rank.ts` filters and ranks by the words typed.
  `EmbedDialog` and `VideoDialog` ask for an address.
* `panels/format/composites/`: a section of the format options for each kind. A double click on a composite opens
  them with the caret in the field marked `data-primary` (`field-focus.ts` carries the request from the canvas to
  the panel). `CitationSection` leaves the place for a picker of references; `addCitationKeys` is what it calls.
* Formulas are drawn by KaTeX (`render/elements/MathView.tsx`). For PowerPoint they are turned into pictures in the
  browser (`export/math-png.ts`, on `export/raster.ts`, which turns any markup into a PNG).

### The images drawer (`gallery/`)

`ui.toggleGallery()` opens it beside the filmstrip (Insert, "Image from the gallery…"). It lists `host.images()` and, when
the host has them, uses `thumbnailUrl` (small copies), `imageUsage` (where each image is used, in one look), `setImageMeta`
(tags, caption, citation key), `watchImages` and `openPath`; every one of them is optional. The open deck's own use of an
image is read from the deck being edited (`usesInDeck`), not from the saved file. An image dragged out of a tile carries
`IMAGE_MIME`; the slide's page takes it with `useImageDrops` (over an empty image slot it fills it, cropped to cover;
elsewhere it lands where it is let go). A double click, Enter or "Add to slide" puts it in the largest free place
(`spotFor` in `place.ts`, on top of `placement.ts`). Files pasted or dropped on the drawer go to `host.addImage` as
`pasted` or `file`; the same bytes give the same image. Each way of placing an image then calls `citeImage`
(`citations/cite-image.ts`), so a figure that has a citation key puts its paper in the slide's footer citation: a second
step of undo, and none when the slide already cites the key.

### Building blocks (`ui/`)

`Icon` (names in `ui/icons.ts`, a subset of Lucide; append a name there if one is missing),
`IconButton`, `TextButton`, `Divider`, `Popover`, `Menu` (items with icons, keys, checks, sub-menus,
keyboard), `Dialog`, `ColorPicker`, `NumberField`, `Segmented`, `Toggle`, `Section`.

The look is `editor.css`: every colour, radius and shadow is a variable `--ks-*` on `.ks-editor`. Use
those and nothing else, so a host restyles the editor by setting them and a dark theme needs no
changes. Class names start with `ks-`.

`data-ks-keep-focus` on a control tells the text editor not to end its edit when the control takes
the focus; toolbar buttons have it.

## Rules for a region

* Keep to your folder. Ask for a change to `session/`, `commands/`, `ui-state.ts`, `SlidesEditor.tsx` or
  the shared CSS instead of making it; do what you need with the public API meanwhile.
* No colours, fonts or sizes of your own: variables from `editor.css`. Slide content always takes
  its colours and fonts from the deck's theme (`src/theme`), never from the editor's variables.
* Every action is a call to the session (an engine operation) or to `ui`. Views never keep a copy of
  the deck.
* A control that shows a value the selection may disagree about shows "mixed" and still works.
* Keyboard first: everything reachable with the mouse is reachable with keys, with visible focus.
* Files stay under about 350 lines. Tests use `@testing-library/react` with a real deck from
  `src/test/engine.ts` (`newDeck()`), a `MemoryHost` and `new EditorSession(engine, host)`.

## Seeing it

`packages/slides-dev` is a Vite page with the editor on a sample deck (`pnpm --filter @kasten-slides/dev dev`,
usually already running at http://127.0.0.1:5174/). `?deck=empty`, `?theme=Dark|Serif|Lecture`,
`?ui=dark`. In the page, `window.__ks` is `{ session, ui, host }`, for scripts. Drive it with
Playwright's Chromium from a Node script and look at the screenshots.

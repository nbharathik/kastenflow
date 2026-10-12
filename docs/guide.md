# KastenFlow user guide

KastenFlow is a desktop app for notes, whiteboards and a journal. Everything it
keeps is a plain file in one folder you choose, the *vault*, and every
change is saved in the vault's history.

- [Your vault](#your-vault)
- [A tour of the app](#a-tour-of-the-app)
- [Slides](#slides)
- [Diagrams](#diagrams)
- [Templates and starter kits](#templates-and-starter-kits)
- [AI in KastenFlow](#ai-in-kastenflow)
- [Quick capture and the tray](#quick-capture-and-the-tray)
- [Connect AI agents](#connect-ai-agents)
- [Backup and restore](#backup-and-restore)
- [Updates](#updates)

## Your vault

- Pages, cards and journal days are Markdown files; tag databases are
  YAML; whiteboards are JSON Canvas. [The vault format](vault-format.md)
  describes every file.
- Each project is a folder of its own, with its pages inside.
- Every change is a git commit, so any change can be taken back. History
  and the trash are how things are removed; nothing is deleted outright.
- Open the folder in any editor. KastenFlow notices changes made outside it
  and keeps both versions if the same note changed in two places.
- Keep the vault out of folders a sync app copies, such as OneDrive,
  Dropbox, iCloud Drive or Google Drive. Those apps copy files while
  KastenFlow writes them, which can leave conflicted copies or a half-copied
  history, so KastenFlow warns when a vault is in one. For a copy in the
  cloud, use [Backup and restore](#backup-and-restore).

## A tour of the app

**Write.**
- Pages work like Notion: type `/` for any block, including callouts, toggles, tables, code, to-dos and colours.
- Equations are TeX between dollar signs: `$E = mc^2$` in a line, `$$` on lines of their own, drawn with KaTeX. A price like $5 stays text.
- `[[` links a page, and `@` links a page or a day.
- Pages have covers and icons. A page's ••• menu gives it its own font, small text or full width; Settings → Pages sets them for every page.
- A page's tags and properties sit under its title, and Add property starts one.
- Ctrl+F finds in the page you are on, and Ctrl+Alt+F replaces too; Replace all is one step Ctrl+Z takes back. **Aa** (Alt+C) matches case and **ab** (Alt+W) whole words. **+ sub-pages** looks through the page and every page inside it, lists them with the lines around each match, and replaces in all of them at once as one change you can undo from its notice; a title that holds the text gets **Rename…** instead.
- `@` links a day, a person, a page, a whiteboard, a deck or a tag. For a day, type it your way: `@friday`, `@next fri 3pm`, `@oct 12`, `@in 3 days` or `@14:00` write the day as a link and the time after it (`[[2026-10-16]] 15:00`), and the Calendar shows the time on that day. `@` in a page's title sets the page's date, shown beside the title.
- Paste a web address over selected text to link it.
- A whiteboard, a tag database or another page can sit inside a page (`/whiteboard`, `/database`, `![[Page]]`).
- Pages start blank, with just a title. On an empty page, type `/` and pick **Template…** to start from a template, or **Ask AI…** to draft it. See [Templates and starter kits](#templates-and-starter-kits).
- A new page is only a draft until you write in it: one you leave untouched leaves no file behind.
- One box catches quick notes, on Home, in the Inbox and on each project's home. Ctrl+N goes to it, or opens a new card where there is none.

**Plan.**
- Home is one short screen. At the top, the capture field (Enter keeps a thought in the Inbox; start with `/` to pick an action instead) and **+ New** for a page, quick note, journal, template, deck, whiteboard or diagram. Below it, **Recent** lists what you opened and changed last, with chips for Pages, Cards, Boards, Decks, Diagrams and Captures, a project list and a field that narrows the list as you type (`/` goes to it; the arrows move, Enter opens, Ctrl+Enter opens to the right). What you chose is remembered. Beside it: today's events and to-dos with times, the first few to-dos with a field to add one, and the Inbox with **Triage**. The customize button turns on more (projects, pages, the week, the journal, whiteboards, decks), drag to put them in order, and **Reset to the simple layout** brings the usual set back.
- Every project page opens with its own home: a summary, to-dos, a quick note, recent and sub-pages, a kanban and its whiteboards.
- Tasks gathers every to-do from every page. Filter them by place, day and status, group them by project, or work them on a board.
- The Calendar is your notes by day: each day's journal, dated notes and to-dos, and the pages that mention the day, as a month, a week or an agenda. Click a day to open its journal; its + adds a to-do, a task, a note or a page there. Drag a note to reschedule it. The week's **Hours** button (H) lays it out by the hour, with timed events and to-dos like `@14:00` on their hours.
- Subscribed calendars (the desktop app): Settings → Calendar → Subscribe… takes a Google, Outlook, iCloud or other calendar's `.ics` address (`webcal://` works too) and shows its events on the Calendar, in the journal's On this day and in Home's Today. They are read-only: nothing is written to your notes or sent back to the calendar. The address is a secret, since anyone who has it can read the calendar, so KastenFlow keeps it in your system's keychain. Click an event for its details; **Make meeting note** makes a page from your meeting template, with the event's link, only when you ask.

**Think visually.**
- Whiteboards hold cards, stickies, sections, images and labelled arrows.
- Sketch and diagram on them: a pen, an eraser and flowchart shapes, with straight, curved or elbowed arrows.
- Present a board: each section is a slide, shown full screen.
- Keys make things, the right button pans, and a mind-map mode grows ideas as a tree.
- A board keeps quiet while you work: choosing something shows one small colour dot (press it for the colours, or use the keys 1 to 9), the tools are a slim strip on the left that rests faintly until the pointer comes, and `\` hides every bar. A double-click on empty space makes a card or a sticky, as you chose; **More** at the top right holds layout, brainstorm, find and the rest.
- A card on two boards is the same note on both.
- Diagrams are flowcharts, architecture and sketches drawn in an editor of their own, shown as pictures in pages, slides and whiteboards. See [Diagrams](#diagrams).

**Keep a journal.** Today is a full page, with the days before it beside it. A day starts empty and fills as you write.

**Organise.**
- The Inbox catches quick notes. Triage keys file them, with suggested homes.
- The Card Library finds anything by kind, tag, project and date: Created and Updated take today, this or last week, this or last month, a month or a range (the search box reads `on:`, `created:` and `updated:` too), and **Group** heads the cards by type, project, tag, month or week.
- To work on several pages at once, choose Select in a page's ••• menu in the sidebar, then click the others, from any project or the Pages list (Shift+click picks a run of rows). The bar that appears puts them inside a page, moves them to a project, adds them to a whiteboard or moves them to the trash. Escape stops picking.
- Tags become databases, shown as a table, a board, a list, a gallery or a calendar, with properties and relations.
- The Graph (+ in the tab bar, or **Open graph** in the palette) draws the links between your pages, whiteboards and decks, and shows a link to a page that does not exist yet as a faint ghost. Click a node to open it beside the graph (Ctrl for a tab, Alt for a split, Shift to stack), double-click empty space or click a ghost to make that page, and drag a node onto empty space to make a page linked from it. Scope it to the whole vault, one project, or the pages around one page, and filter by orphans, ghosts, kind or tag. **Graph around this page** and the Links tab's small graph show a page's neighbours.
- **Expand** on a project's home, or **Project overview** in a project's menu, opens the whole project full screen: all its pages as a table or gallery, its captures with **File here**, its tasks as a board, its graph, and tables you save with their own filter, columns and sort. Saved tables live in the project page's `overview` property.

**Read.** Drop in a PDF to read and highlight it. Turn highlights into cards that link back to their page. Choose Clip in the reader's bar and drag a box around a figure to keep it, at 300 dpi, among the vault's images. The picture remembers its paper, page and box, and the paper's citation key if you give one, so a slide that shows it can cite the paper.

**Work with AI.** Ask about a selection while you write, chat with your open pages, or brainstorm on a board. See [AI in KastenFlow](#ai-in-kastenflow).

**Present.** Slide decks are files in the vault like any note: build them, present them full screen and export them to PowerPoint. See [Slides](#slides).

**Settings.** The gear at the foot of the sidebar (or **Settings** in the palette) opens a window of two panes: the groups on the left, under General, Connect, Data and System, and one group at a time on the right. Type in the box at the top of the list, or press `/` (Ctrl+F works too), to search every setting at once: the list shows how many each group has, the right pane shows what was found with the words marked, and Escape clears the search. A **?** beside a name explains it, a dot marks a setting you changed, and the arrow beside it puts it back. The palette also opens a group or a single setting, for example **Settings: Appearance**. In a narrow pane the list becomes a drop-down.

**Bring your notes.** KastenFlow imports an Obsidian vault or any Markdown folder, a Notion export, or a Heptabase backup. Pick the folder with Browse, or drop Markdown files or a folder on the window. Import shows what will come in first, and each import is one change you can undo. An Obsidian vault can also be opened as it is, with its folders kept as folders.

## Slides

KastenFlow Slides is an editor for talks, lectures and reviews, in the style of Google Slides. A deck is one plain file, `something.deck`, in your vault ([the format](slides-format.md)), so it has history like your notes, moves with its project, and AI agents can work on it.

**Make a deck.**
- Choose **Slides** in the sidebar. The row **Start a new presentation** makes a deck in one press, called "Untitled presentation" until you name it in the editor: **Blank**, or one of the first templates with its example slides. **Template gallery**, or **New deck**, asks for a name, a project, a template and the shape first; **Import PowerPoint…** starts from a `.pptx` file. Under it your decks are listed newest first; search finds a deck by its name or its project, and the sort keeps them by last edit, by name or by project. A deck made outside a project goes in `library/`; one made in a project goes in that project's `decks/` folder.
- **New deck** shows a gallery of templates: eleven looks (Light, Dark, Serif, Lecture, Minimal, Bold, Modern, Academic, Pitch, Dark Studio, Warm Paper), each drawn with its own example slides (a title, a section, a list, two columns, a picture beside words, a quote and a closing slide), which you keep or delete. Choose the shape of the slides too: 16:9, 16:10, 4:3 or square. The theme dialog (**Edit theme…**) shows the same looks on its cards, and has twelve layouts for each (Title, Section, Title + body, Title only, Two columns, Title + image, Image + caption, Code, Comparison, Big number, Quote, Blank). **Slide → Change layout…**, **Change background…** and **Edit theme…** change them; a theme sets the colours, fonts and text styles of the whole deck.
- **File → Page setup…** changes the shape of every slide later: 16:9, 16:10, 4:3, square, or a width and height of your own. The slides and the theme are refitted (type follows the width; pictures, turned things and circles keep their shape), and one undo takes it back. When you present on a screen of another shape the slide is shown whole and centred; **Slideshow options** (the arrow beside Slideshow) chooses the colour of the bars round it: black, the theme's background or its dark colour.
- **Your own layouts.** Design a slide, then **Slide → Save slide as layout…**: name it and say which elements are slots (a title, a list, a picture ...) that each new slide fills in; everything else becomes decoration drawn behind every slide of the layout, together with the slide's background. The layout appears with the built-in ones, as a live thumbnail, in the arrow beside **New slide** and in the layout picker. **Slide → Edit this layout…** opens it on the editor's own canvas (**Add slot** puts a title, subtitle, list, text, picture or caption where you want it, and setting type in a slot sets the type of every slide); **Done** changes the layout and every slide that uses it follows: slots you did not move move with it, slots you moved stay, and every slide keeps its words. **Slide → Reset slide to layout** puts a slide's slots back. **Manage layouts…** renames, copies, orders, edits and deletes layouts (a layout that slides use is deleted by moving those slides to another one) and marks the one that new slides start from; in the arrow beside **New slide** (or View → New slides) the third choice, **My default**, makes new slides start from it. **Design my blank layout…** is the quick way to give blank slides your own background, footer, logo or stripe.
- **Your own templates.** **File → Save as template…** keeps the look of a deck (colours, fonts, text styles, your layouts, the shape of the slides, and its slides as examples if you ask) as a file in your vault's `templates/slides/` folder. **New deck** lists them under **My templates**, where you can open, rename, copy or trash each one; **File → Apply a template…** puts a template on a deck you already have without touching its words. Assistants can read your templates but never write them.
- The same editor works on a plain folder of decks without KastenFlow: see [Slides on the command line](#slides-on-the-command-line).

**Find your way.**
- The top bar is one row: the deck's name (click it to rename), its star (the same favourite as in the sidebar), where saving stands, the menus **File** to **Help** and, at the right, the assistant, full screen and **Slideshow**. In a narrow window the menus fold into one **Menu** button. With the keyboard, Alt and a letter opens a menu (F File, E Edit, V View, I Insert, O Format, D Slide, A Arrange, T Tools, H Help; on a Mac the keys are used for typing, so use the box below). The **Menus** box (Alt+/) finds any command of any menu by its name, shows where it lives and its keys, and runs it with Enter.
- The row of tools under it follows what is selected. With nothing selected it has undo, redo, paint format, zoom, the tools that put something on the slide (select, text box, image, shape, line) and the slide's own settings (background, layout, theme, transition). Select a text box and the same row swaps to the font (a list you can search, with the fonts you used lately first), its size (a box, and a list of the usual sizes), bold, italic, underline and strikethrough, the text colour, links, alignment, line spacing, lists and indents; a shape adds fill, border colour, weight and dash, shadow and opacity; anything adds order, align and **Animate**. What does not apply to the selection is left out rather than greyed. When the window is too narrow, the last groups move into a **⋯** menu. Click the empty slide to get the tools for adding things back.
- The colour menus show the theme's colours with shades (they follow the theme when it changes), a grid of standard colours, the colours you used lately and a box for any value, with a colour square and, where your system has one, an eyedropper that takes a colour from anywhere on the screen.
- **Format options** (the button at the right of the row, or Ctrl+Alt+O) opens a panel beside the slide whose sections fold and stay folded. Drag its left edge to make it wider or narrower (arrow keys work too, and a double click gives the usual width); KastenFlow remembers the width. Drag across the letter beside a number (X, W, H …) to turn it like a dial; the arrow keys step it, Shift ten times as far and Alt a tenth. **Themes** shows every look as a small drawing of its title slide and the layouts of the deck's theme, and **Transitions** sets how the slide arrives (none, fade, slide or morph, and for how long) with a **Play** button, for this slide, every slide or the deck. **View → Compact toolbars** makes the bars a little smaller.
- **Speaker notes** sit under the slide; the strip above them folds them away.

**Edit.**
- The filmstrip on the left lists the slides. Drag to reorder (the slides go under the pointer and the others make room where they will land; a pull to the top or bottom edge scrolls the list); Shift and Ctrl pick several to move together. Up, Down, Home and End move through the slides, Enter adds one after the slide shown, and Tab goes on to the slide itself. Ctrl+M adds a slide and Ctrl+D duplicates one. **Slide → Skip slide** leaves a slide out of the show, and **Backup slide** files it under the slide before it, to be opened with the down key when a question calls for it. Sections group slides: add, rename and remove them from the filmstrip's menu, and fold them away.
- **Insert** adds a text box, image, shape, line or table. Drag to move, resize and rotate; guides snap; group, align, distribute and lock from **Arrange**, from the small bar that appears over two or more selected things, or from the right-click menu. Drag a rectangle to select several (hold Alt to take anything it touches); it can start over an empty text slot, and a click there selects the slot. Double-click a group (or press Enter on it) to work on what is inside it; Esc goes back up. Slides in the filmstrip move to their new places when you drag them, and picking a transition in **Slide → Transition** plays it on the slide; it can also be set for the whole deck. Lists (Ctrl+Shift+8 and 7), links (Ctrl+K) and find and replace (Ctrl+F) work as in a document, and each action is one step of undo.
- **Move a block by its handle.** A small four-arrow chip sits at the top-left corner of the selected block, and a lighter one appears when you point at any block; it stays put while you type in a text box. Drag it to move the block (snapping and guides work as usual). The arrow keys nudge by 1 and Shift with an arrow by 10; a run of taps is one step of undo.
- **Move, copy and look about.** Hold Alt or Ctrl (Cmd on a Mac) while dragging to leave the block where it is and put a copy where you let go; Shift keeps a move to one direction, resizes with the ratio and turns in 15° steps, and Alt on a resize works from the centre. Esc during a drag puts everything back. Ctrl+wheel or a pinch zooms about the pointer; the zoom menu, Fit and the zoom keys glide, and keep the place you are looking at where it is. Scroll with the wheel, or hold Space (or the middle button) and drag to move the slide about; dragging a block to the edge of the window carries the slide with it. Undo, redo, align and distribute glide the blocks to where they go. Press F2 or Enter on a selected text box to type in it.
- **Add with one key.** With the slide in focus (not while you type in a text box) press **T** for a text box at the pointer, ready to type, **R** for a rectangle, **O** for an oval, **L** for a line, **A** for an arrow (drag to draw them) and **I** for the image gallery. The keys are shown beside the items in **Insert** and in **Help → Keyboard shortcuts**.
- **Select all** (Ctrl+A) does what fits where you are: every element on the slide, all the text in a text box, the whole outline in the outline view, every slide in the filmstrip or grid. Text you only read, such as lint messages, dialogs and references, can be selected with the mouse and copied.
- **Clicking away lets go.** A click on empty space of the slide, on the grey round it, or on the bare part of the top bar lets go of what is selected; with a text box open, one click outside ends the typing and lets go too (Shift or Ctrl with the click adds instead, and never lets go). Esc leaves the text box and, pressed again, lets go of the block. A click on a slide in the filmstrip or the grid leaves the blocks on the slide; a click on the empty space of the list, or on the slide, takes several picked slides back to the one shown. The name of a section in the filmstrip picks the slides in it (its arrow folds it).
- **Copy, cut, paste and duplicate.** Ctrl+C, Ctrl+X and Ctrl+V (Cmd on a Mac) work wherever the focus is in the editor, with no permission to ask: on the blocks of the slide when the slide, a toolbar button or a panel has the keys, and on the slides when the filmstrip or the grid has them; in a text box or a field they are the text's. A paste lands 16 down and right of the blocks it copies on the same slide, each further paste 16 more, and where they were on another slide or in another deck; **Paste in place** (Ctrl+Shift+V) keeps the place, and a cut comes back exactly where it was. Ctrl+D duplicates blocks or, in the filmstrip, slides; the right-click menus and **Edit** have them all. Copy in one deck and paste in another. A picture, plain words or the words of a web page pasted from another program become a picture or a text box where the pointer is (the middle of the slide without it). Pasted slides go after the slide picked and keep their notes, look and transition; a section that began at a copied slide begins at its copy when that does not cut another section in two. Dragging slides in the filmstrip or the grid with Alt or Ctrl held copies them where they are put down.
- **Full screen** (the button at the top right, **View → Full screen**, or Ctrl+Shift+F) gives the whole app window to the deck: KastenFlow's sidebar, tabs and chat dock go away and the editor fills the window, so you can just work on the slides. It stays inside the app; it does not take over the monitor. Press Esc (when nothing else is being cancelled), the button or Ctrl+Shift+F again to come back.
- **View → Speaker notes** shows the notes under the slide. **View → Views** switches between the slide editor, an outline you edit as text, and a grid of all the slides. **Format options** (Ctrl+Alt+O) opens the details of what is selected.

**Parts that draw themselves.** Insert a **Code block** (coloured for many languages, with lines to bring into focus one at a time), a **Formula** (LaTeX), a **Conversation**, **Token probabilities**, a **Card grid**, a **Citation…**, a **Step label**, an **Embedded page…** or a **Video…**. Each stays editable in the Format panel and goes to PowerPoint as ordinary shapes and pictures. **Arrange → Ungroup to shapes** turns one into plain shapes when you want to draw on it.

**Steps.** A slide can build up in steps. **Slide → Steps** turns a list into steps that reveal one by one, walks a highlight through the elements, or spotlights one at a time; the Steps panel (**View → Steps**) shows every element against every step. A code block with lines in focus gets a step for each. A slide with the Morph transition (**Slide → Transition…**) glides the elements it shares with the slide before to their new places.

**Present.**
- The **Slideshow** button at the top right, or **View → Present** (Ctrl+Enter), shows the deck full screen from the current slide; the arrow beside it lists the other ways to start. **Present from beginning** (Ctrl+Shift+Enter) starts from the first slide, and **Presenter view** (Ctrl+Alt+Enter) opens a second window with your notes, the next slide, a clock and a timer. **Scroll view with notes** lists every slide with its notes on one page.
- The keys: → or Space for the next step and then the next slide, ← or Shift+Space back, ↓ and ↑ into and out of the backup slides, O for an overview, a number and Enter to go to a slide, B for a black screen, L for a laser pointer, F for full screen, ? for the list, Esc to leave. Click a picture to see it large. Embedded pages run live and videos play.

**Export and print.** **File → Download** gives a PowerPoint file (a slide with steps becomes one slide for each step, so it builds the same way in PowerPoint), a PDF, PNG images (at 1×, 2× or 4×, for each slide or each step), a Markdown outline, or the whole talk as one web page (.html) that plays offline. **File → Print…** prints it.

**Import.** **File → Import slides from PowerPoint…** reads a `.pptx` and asks whether to add its slides to the deck, replace the deck with them, or bring them in as a new version of a deck you took to PowerPoint and edited there (what is still in the file keeps its place, what is new is added, and slides the file lacks stay). Runs of similar slides can be collapsed into steps. What KastenFlow cannot draw, such as a chart, is kept as it was and written back untouched, and the import lists what it could not keep exactly. It is one step of undo.

**Check the deck.** **Tools → Lint** looks for what goes wrong on a screen: text that does not fit its box, is too small or too pale, things off the slide, overlapping or almost aligned, empty placeholders, pictures without a description, missing fonts, too many words, thin margins, steps that show nothing, citations that name no work, and things PowerPoint would draw differently. The dialog lists them and jumps to each. Nothing warns you on its own while you work; if you want a badge on each thumbnail that counts what is wrong, switch on **View → Lint badges** (KastenFlow remembers the choice on this computer).

**Images and the gallery.** Every picture you paste, drop, clip or import is kept once, in the vault's `assets/` folder, and any page, whiteboard or deck can show it. Nothing is ever deleted for you: a picture that nothing uses stays where it is.
- Where a picture came from is remembered. Beside each picture, in a hidden `.meta` folder, a small file records its name, size, when it came in, how (pasted, a file, clipped from a paper, made by an agent, or brought in from PowerPoint) and who added it. You can give it tags, a caption and a citation key. Pictures that were there before are listed as they are and get their file when you first change something about them.
- The same picture is one picture. Paste the same image twice, or drop a file you already have under another name, and you get the picture you already have, not a copy.
- Open the gallery from a deck with **Insert → Image → Image from the gallery…**. It lists every picture in the vault, newest first, as small thumbnails. Search finds a name, a tag, a caption or the title of the paper a figure came from. The filters show pictures in **This deck**, **Recent** (the last two weeks), **Agent-made**, **From papers** and **Unused**.
- Double-click a picture (or press Enter, or choose **Add to slide**) to place it in the largest free part of the slide. Drag it onto the slide to place it where you let go, or onto an empty image placeholder to fill it. Paste a picture into the gallery, or drop files on it, to add them.
- Choose a picture to see the notes, whiteboards and decks that show it; a slide of the open deck is a link that jumps to it. "Unused" only filters: it never deletes.

**Papers and citations.** Keep the bibliographies of your papers in `.bib` files anywhere in the vault. **Insert → Citation…** finds a work by key, author, title or year and adds it to the slide's footer as "Vaswani et al., 2017 (NeurIPS)", as a number, or as a full reference; a slide made of a citation list prints every work the deck cites, in order. A key that names no work is marked, and the lint says which work it may be. In the PDF reader, choose **Clip** and drag a box around a figure to keep it at 300 dpi, with its paper, page and box remembered; placing it on a slide adds the paper to that slide's citations.

**Work with AI.** The deck tools are part of KastenFlow's MCP server (see [Connect AI agents](#connect-ai-agents)), and the chat can use them too: an agent can outline a deck, build slides and diagrams, place pictures, cite works and check the result with the lint. Its changes are commits like any other. A small edit goes straight in; taking many slides out (removing them, or emptying them) waits for your review (`guardrails.max_slides_removed` in `.kasten/config.yaml`, 3 in ten minutes by default) with the slides before and after side by side, and **undo session** takes back everything a session did. [skills/kasten-slides/SKILL.md](../skills/kasten-slides/SKILL.md) teaches Claude Code the loop: outline first, then build, render, lint and repeat until nothing is an error.

**The assistant tab.** **View → Assistant** (or the sparkle button at the top right) opens KastenFlow's chat beside the slide. It knows which slide you are on and which elements you have selected, so "tighten this" and "add a diagram that shows the loop" mean what you are looking at. Each deck has a conversation of its own, and what it changes is one session you can take back with **Undo this chat's changes**.
- **Stars mark the assistant's work.** Whatever an assistant makes or changes in a deck, from this tab or over MCP, carries a small star until you accept it or change it yourself: one in the corner of the element, and one on the slide's thumbnail in the filmstrip. Right-click an element and choose **Accept**, or use **Accept all** in the tab or in the **Tools** menu. Changing an element yourself takes its star off. An assistant cannot accept its own work. The stars are kept in the deck file (see [the format](slides-format.md)); they never show when you present or export.
- **A deck from a note.** Ask for a deck from one of your notes (the `deck_from_note` tool): its headings become slides, its lists the slides and its prose the speaker notes, and its pictures and the works it cites come along, with the notes it links to as sections when you ask. Then refine it slide by slide.

### Slides on the command line

The `slides` program works on decks in any folder, with or without KastenFlow. It is built from the source for now (`cargo build -p slides-cli`; build the page it draws with first, `node scripts/build-render-page.mjs`, to have `render` and the PDF, PNG and web page exports):

```sh
slides new talk.deck --title "My talk"        # a deck with a title slide
slides dev ~/talks                            # edit the folder's decks in your browser
slides outline talk.deck                      # the deck as a Markdown outline
slides lint talk.deck                         # what is wrong; exits 1 on errors
slides export talk.deck -o talk.pptx          # PowerPoint; -o talk.pdf, .png or .html draw it with Chrome or Chromium
slides render talk.deck --grid -o grid.png    # a picture of every slide (Chrome or Chromium)
slides import old.pptx -o old.deck            # from PowerPoint
slides mcp --folder ~/talks                   # the deck tools for an AI agent, over stdio
```

Drawing runs the browser in its sandbox, which is what keeps a damaged picture in a deck from taking it over. As the administrator (root), and in some containers, the sandbox cannot start; the command then says so and names `SLIDES_RENDER_NO_SANDBOX=1`, which runs the browser without it. Set it only where the container or machine is itself the boundary you trust. The browser is driven over a port on the machine's own loopback interface, so on a computer you share with people you do not trust, draw inside your own container.

## Diagrams

Diagrams are flowcharts, architecture drawings and sketches. Choose **Diagrams** in the sidebar (it is listed under **Think**; pin it to keep it at the top), then **New diagram**, drop a `.drawio` file on the view, or choose **Import…**.

**Two files, one diagram.** A diagram is `something.drawio` in your vault, the editor's own XML, readable in a diff and by agents, with `something.drawio.svg` beside it, an ordinary picture of it. Pages, slides and whiteboards show the picture, so nothing needs the editor to *see* a diagram. The two move, rename, duplicate, go to the trash and come back together, and links to a diagram follow it when it is renamed or moved. A diagram made in a project goes in that project's `diagrams/` folder; otherwise in `library/`. [The format](vault-format.md) describes both files.

**The editor is an optional download.** It is draw.io (diagrams.net), an open source editor by JGraph Ltd, and it is not part of KastenFlow. **Install diagram editor** in Diagrams (or in Settings, Diagrams) downloads one pinned version, about 48 MB, from GitHub once, checks its size and checksum, and keeps it in KastenFlow's data folder, never your vault; **Remove** deletes it again. Until it is installed you can still look at diagrams, move them, export their SVG picture and show them in pages and whiteboards; drawing and changing them, and their PNG pictures (for a slide, or **Export as PNG** and **Copy as image**), need it. It runs in a sandboxed frame that cannot reach your notes or the web. See [Third-party software](third-party.md) for its licence and credit.

**Draw.**
- A diagram opens in a tab of its own, and its changes are saved as you draw: the source after a short pause and the picture when you stop for a moment, when you leave the tab and when you close KastenFlow. The editor has its own undo while the diagram is open; **History** is how you go back afterwards. If the file changed somewhere else while it was open (an agent, another app), what you draw is kept in a copy beside it, `name (conflict …).drawio`, and the tab follows the copy.
- **New diagram → From a draw.io template…** starts from the editor's template gallery.
- A link in a diagram opens a web address in your browser, and `[[Page]]` opens that page.
- **Export as SVG** and **Export as PNG** (or **Copy as image**) are in the menu beside the title; **Copy embed for a page** copies `![[name.drawio]]`.
- Pictures that are missing or out of date, such as a diagram an agent made, are drawn again quietly while the editor is installed.

**Use it.**
- **In a page.** Type `/diagram` and pick one, or make a new one, or write `![[Login flow.drawio]]` on a line of its own. It shows as the picture, centred; hover for **Edit** (or double-click) to edit it in place, **Open in a tab**, **Copy as image** and export. `[[Login flow.drawio]]` inside a sentence is a link that opens it.
- **On a whiteboard.** Drag a diagram from the Diagrams view onto a board: a card shows its picture, and a double click edits it over the board. A `.drawio` file dropped from your desktop is brought in as a diagram; a `.drawio.svg` picture is an ordinary picture.
- **In a slide.** **Insert → Image → Diagram…** chooses a diagram (or makes one) and puts its picture on the slide, as a PNG (drawn by the diagram editor, so it needs to be installed) kept with the deck's pictures so it works in PowerPoint and PDF. Select the picture and choose **Edit diagram** (the toolbar, or the right-click menu) to change the diagram over the slide; the slide's picture is replaced when you close the editor. The slide remembers which diagram the picture is of; a slide never holds the diagram itself.
- **With AI agents.** Agents list, read, make and rewrite diagrams as XML (`list_diagrams`, `get_diagram`, `create_diagram`, `update_diagram`); a rewrite that takes a lot out of the drawing, and any move to the trash, waits for your review.

## Templates and starter kits

- **Templates.** Nearly sixty ship with KastenFlow, on shelves for daily
  notes and reviews, knowledge, work, life and writing: a daily planner,
  a weekly plan, meeting notes, book notes, a trip plan and more. Open the
  gallery with **From a template** in Home's **+ New** menu or the palette for a new page,
  or type `/` on an empty page and pick **Template…** to fill that page.
  Each fills in the date, the time, the weekday, the week, the month and
  the year as it starts.
- **Your own.** **Save as template** in a page's ••• menu makes one from
  any page. In the gallery, **Edit template** opens a template's own page
  to change it. The journal's template for new days is chosen in
  Settings → Templates. A project's home menu sets the template for its
  new pages: **Template…** on one of them opens the gallery on it.
- **Starter kits** set up a way of working in one step: a daily planner
  and journal, a second brain (PARA), a Zettelkasten, Getting Things Done,
  a student's courses and assignments, or a researcher's papers and lab
  notebook. Each adds a page that explains it, templates, tag databases
  and boards, never touches your own files, and one Undo takes it all
  back. Pick one when you create a vault, or later from the gallery's
  Starter kits tab or Settings → Templates.

## AI in KastenFlow

AI is optional, and you bring the model.

- **Set it up** in Settings → AI providers. Pick Anthropic, OpenAI,
  OpenRouter, Ollama, LM Studio, vLLM or any other OpenAI-compatible
  server; KastenFlow fills in the address, lists the models the server
  offers, and tests the connection before you save. Keys go to your
  system's keychain, never into the vault, and are sent only to the
  address they were saved for.
- **Or use your ChatGPT plan.** In the desktop app, **Continue with
  ChatGPT** in the same place signs in through your browser: no key, and
  chats, AI writing, brainstorms and suggestions count against your
  ChatGPT plan (you set the limit in ChatGPT → Settings → Usage). Image
  generation and some tools are not available this way. Notes go to
  OpenAI only while that provider is the one chosen. **Sign out** forgets
  the sign-in on this computer.
- **While you write.** Select text and choose **Ask AI** in the toolbar,
  or type `/` for **Ask AI…**, **Continue writing** or **Summarize page**;
  on an empty page, **Ask AI…** drafts it. The answer appears in a preview
  beside the text: **Replace selection**, **Insert below** (or **Insert**
  when nothing was selected), **Try again** or
  **Discard**. Nothing enters the page until you take it, and Ctrl+Z
  takes it back.
- **The chat** sits at the top right (Ctrl+Shift+A) and reads the pages
  you have open; **+ Context**, or typing `@` or `[[`, adds more. It can
  create and design pages, add cards and fill whiteboards, rewrite a
  section and propose templates. **Ask AI about this page** in a page's
  ••• menu starts a chat about it. Brainstorm on a board, and every idea
  arrives as a card.
- **Everything the AI writes** is marked on the page, listed in History
  and undone in one step. Pages you lock with **Lock for agents** are
  read-only to it.

## Quick capture and the tray

- **Quick capture** opens a small box over whatever you are doing:
  Ctrl+Shift+Space (⌘⇧Space on a Mac), from any app. Type and press
  Enter to put it in the Inbox. Tab switches the target to Today's
  journal, a recent place or a project; Ctrl+K (or a click on the target)
  opens a picker where a few letters reach any page, and Enter adds the
  note to it. A web address alone is clipped to the Inbox, or added to a
  page or the journal as a link. Esc closes it and keeps what you typed
  for next time. Change the shortcut in Settings → Desktop.
- On Linux with Wayland, apps can't claim a global shortcut. Bind
  `kasten-app --capture` in your desktop's keyboard settings instead;
  Settings → Desktop shows the exact command.
- **Closing the window keeps KastenFlow running** in the tray (or the Dock on
  a Mac), so capture and backups carry on. The tray menu opens KastenFlow,
  starts a quick capture, backs up now, gets the latest or quits. Turn
  off **Keep running when the window closes** in Settings → Desktop to
  quit when the window closes.
- **Notifications** say when a backup keeps failing or an update is
  ready, only while KastenFlow is in the background, and never show what a
  note says. They can be turned off in Settings → Desktop.

## The browser tab

Settings → Browser turns on a browser that opens in a tab of its own, beside
a page or on its own (it is off until you turn it on). Its cookies and history
are kept apart from KastenFlow's, no page in it can reach your notes, and it only
opens web pages. Type an address or something to search for (Ctrl+L), and drag
the tab to the side, or open a link from a page there (Settings → Browser, **Open
web links in**; Shift+click uses the other way).

- **Capture page** and **Capture selection** read what you are looking at and
  show what would be kept: a title you can change, the start of the text and
  where it goes. Nothing is written until you press **Save**. A capture is a card
  tagged `capture`, with the address, the site and the day, in the Inbox or a
  project; sent to a page, it is added as a quote with a link to its source, and
  nothing in the page is changed. The first capture makes a `capture` tag
  database with views by site and by day.
- Some sites, Google among them, may refuse to sign you in inside an embedded
  browser. The arrow beside the address opens the page in your system browser.
- Menus and dialogs that open over a page hide it for a moment, as a web page
  is drawn above everything else in the window. **Clear browsing data** is in
  Settings → Browser.

## Captures and the browser extension

Everything kept from the web is a card tagged `capture`, and the **Captures** table
lists them: the address, the site, the day, and a status (New, Read, Filed). Open it
from **Captures** in the sidebar (it shows up under the Inbox once you have a capture,
or when the browser tab or the extension is on), or from the palette. Its views are
All, By site, This week, and **This project**. File a capture in a project with
**Move to…**, or from the project overview's Captures tab. In a project's page, type
`/database` and pick **#capture in this project** to show that project's captures
in the page.

The **browser extension** for Chrome and Edge sends the page you are on, a selection,
a link or a picture to KastenFlow. It is off until you turn it on in Settings → Browser
extension, and it only works while KastenFlow is running.

- **Put it in the browser.** The `browser-extension` folder in KastenFlow's source
  download has a README. In short: open `chrome://extensions` (or `edge://extensions`),
  turn on Developer mode, choose **Load unpacked** and pick that folder. There is no
  store listing yet.
- **Pair it once.** Settings → Browser extension → **Pair** shows a code of eight
  letters and digits. Open the extension, press **Pair** and type the code. It works
  once, for two minutes and five tries. You can revoke a paired extension in the same
  place, and it never works again.
- **Send.** Press the extension's button, or right-click a page, a selection, a link
  or a picture and choose **Send to KastenFlow**. The popup lets you pick where it goes
  (Captures, a project or a page) and add tags. A page sent to a page becomes a quote
  with a link to its source; nothing in the page is changed.
- **What it can do.** It can add captures and nothing else: it cannot read a note,
  change one or delete one. KastenFlow listens on `127.0.0.1` (this computer only), by
  default on port 7434, only while it runs and only with the switch on. Each capture is
  one change in the history, and **Undo** takes it back.
- **If it cannot reach KastenFlow**, the popup says so: KastenFlow is closed, the switch is
  off, or the port is different (the popup has an Advanced field for it).

## Connect AI agents

KastenFlow serves its vault over [MCP](https://modelcontextprotocol.io). Agents read, search and write through the same core and guardrails as the app:

- locked notes and oversized writes are refused (lock a page from its menu with **Lock for agents**);
- templates, big removals (a diagram that loses a lot of its drawing, a deck that loses slides) and bursts of changes wait for your review, and so does anything sent to the trash that is a whiteboard, a deck or a diagram;
- every agent session can be undone.

Turn on history for the vault first, in Settings or with `kastenflow start-history --vault ~/Notes`. The command-line tool is `kastenflow`; the older name `kasten` still works as an alias.

The installed app is the MCP server: `kasten-app --mcp`. **Settings → AI agents** copies each line below with the app's full path on your computer, which is `/usr/bin/kasten-app` on Linux and `/Applications/KastenFlow.app/Contents/MacOS/kasten-app` on macOS.

```sh
# Claude Code, over stdio, in every folder you use it from
claude mcp add --scope user kasten -- kasten-app --mcp --vault ~/Notes

# Clients that connect by URL: http://127.0.0.1:7433/mcp, with a bearer token
kasten-app --mcp --vault ~/Notes --http
# token: ~/Notes/.kasten/cache/mcp-token (Settings → AI agents → Copy the token)
```

For Claude Desktop, Cursor and other apps with an `mcpServers` setting, Settings copies a ready-made entry. A build from source can run `kasten-mcp` with the same arguments in place of `kasten-app --mcp`.

[skills/kasten/SKILL.md](../skills/kasten/SKILL.md) teaches Claude Code the vault's conventions. Review and undo agent work from the app, or from the command line:

```sh
kastenflow proposals --diff    # changes waiting for review
kastenflow accept ID           # or: kastenflow reject ID
kastenflow undo-session ID     # revert a session as new commits
```

## Backup and restore

KastenFlow is desktop-first: backup keeps your notes safe and moves them to a
new computer. It isn't live sync. Everything below is in Settings →
History and backup, and the status bar's dot says how the last backup
went.

- **GitHub.** **Sign in with GitHub**: GitHub shows a code to confirm,
  and KastenFlow creates a private repository and pushes your vault to it.
  After that it pushes a few minutes after changes and at least hourly,
  never with force. Sign out removes the token from this computer.
- **Any other git host.** Give a private repository's address (`https://`
  or SSH) with a token for it, or use SSH keys or git's credential helper.
  The token is checked before it is saved, kept in your system's
  keychain and sent only to that host.
- **Backup files.** Choose a folder, such as one Dropbox, Google Drive or
  OneDrive keeps in sync, or a disk. Once a day, after KastenFlow has been
  idle for a moment, it writes the whole vault and its history to one
  file there, checks it, and keeps the newest seven. Backup files aren't
  encrypted, so choose a folder only you can read.
- **Restore.** On a new computer, choose **Restore from a backup** where
  you open a vault: sign in with GitHub and pick the repository, give a
  git address, or pick a backup file. The folder you restore into must be
  empty. The vault comes back with every page and its whole history.
- **Get latest.** Moving between two computers? **Get latest** brings in
  the changes made on the other one, from the remote or from a backup
  file. It never overwrites: if both computers changed a page, their
  version is kept beside yours as a copy, named after the other computer.
  KastenFlow tells you when the backup is ahead of this computer.
- **Restore a point in time.** History's **Restore everything to this
  point** puts the whole vault back as it was. Files made since then go
  to the trash, and Undo reverses it.
- **Empty trash** (Trash view) removes trashed files for good from the
  folder, only when you ask, never through AI or agents. What was in them
  stays in the vault's history, and Undo brings them back.

Pushes go only to a remote you set or confirmed on this computer, so a
vault someone shares cannot send your notes elsewhere; a vault that names
one waits for **Back up now**. Protect the remote's main branch against
force pushes and deletion: it is the one copy no local process can
destroy.

## Updates

- Turn on **Check for new versions** in Settings → About; the app also
  offers it once, after it first opens a vault. It then asks GitHub for
  the latest release once a day, and sends nothing else.
- A new version shows in the status bar, with **What's new** listing the
  changes. **Install and restart** downloads it, checks its signature,
  writes every open page and restarts into the new version. With
  **Download new versions automatically** on, the download happens by
  itself and the status bar says **Restart to update**.
- Where an update can't install itself, **Download** fetches the
  installer for your computer, and the release page has every package.
- Installing replaces only the app: your vault stays where it is.
  **Skip this version** hides that release until a newer one is out.

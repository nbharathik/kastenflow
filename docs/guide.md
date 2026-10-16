# KastenFlow user guide

KastenFlow is a desktop app for notes, whiteboards and a journal. Everything it
keeps is a plain file in one folder you choose, the *vault*, and every
change is saved in the vault's history.

- [Your vault](#your-vault)
- [A tour of the app](#a-tour-of-the-app)
- [Projects](#projects)
- [Slides](#slides)
- [Diagrams](#diagrams)
- [References and papers](#references-and-papers)
- [Templates and starter kits](#templates-and-starter-kits)
- [AI in KastenFlow](#ai-in-kastenflow)
- [Quick capture and the tray](#quick-capture-and-the-tray)
- [The browser tab](#the-browser-tab)
- [Captures and the browser extension](#captures-and-the-browser-extension)
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
- Pages are made of blocks: type `/` for any block, including callouts, toggles, tables, code, to-dos and colours.
- Equations are TeX between dollar signs: `$E = mc^2$` in a line, `$$` on lines of their own, drawn with KaTeX. A price like $5 stays text.
- `[[` links a page, and `@` links a page or a day.
- Pages have covers and icons. A page's ••• menu gives it its own font, small text or full width; Settings → Pages sets them for every page.
- A page's tags and properties sit under its title, and Add property starts one.
- Ctrl+F finds in the page you are on, and Ctrl+Alt+F replaces too; Replace all is one step Ctrl+Z takes back. **Aa** (Alt+C) matches case and **ab** (Alt+W) whole words. **+ sub-pages** looks through the page and every page inside it, lists them with the lines around each match, and replaces in all of them at once as one change you can undo from its notice; a title that holds the text gets **Rename…** instead.
- `@` links a day, a person, a page, a whiteboard, a deck or a tag. For a day, type it your way: `@friday`, `@next fri 3pm`, `@oct 12`, `@in 3 days` or `@14:00` write the day as a link and the time after it (`[[2026-10-16]] 15:00`), and the Calendar shows the time on that day. `@` in a page's title sets the page's date, shown beside the title.
- Paste a web address over selected text to link it.
- **Copy link to this location** is in a heading's menu, on a PDF highlight and in a whiteboard section's menu. It copies a `kasten:` link that still opens the right place after the page is renamed or moved; following one only opens it, and one whose target is gone says so.
- `---` on a line of its own splits a page into **sections**. Point at a divider, or tab to it, for two small icons, fold and present, whose tooltips carry the section's name; folding changes only how the page looks, never the file. **Present this page** shows one section at a time, full screen. **Smart layout** (in the page's ••• menu) draws each section as a card with an outline strip to jump to a section or move it, and **Turn sections into a deck** makes slides from them (see [Slides](#slides)).
- **Comments** are notes about a page that stay out of its text. **Comments on this page** (the palette, or the Comments tab, the third tab of the right panel) lists them; on a smart-layout page they also sit in a column beside the section they are about, when the pane is wide enough. Select some words if you want the comment to remember them, then type in the **Add a comment…** box of a section, or of the whole page. **Resolve** puts a comment away (**Show resolved** brings it back); there is no delete. A comment whose words were rewritten moves to a **Detached** stack, where **Attach here** pins it to the words you have selected (or to the section the cursor is in). Comments are kept in a small file beside the page (`name.comments.json`) and go with it when it is renamed, moved, duplicated, trashed or restored; Undo takes them along.
- `[@key]` cites a paper from your `.bib` files (`/citation`, or **Insert citation…** in the palette); the page shows the authors and year. See [References and papers](#references-and-papers).
- A whiteboard, a tag database or another page can sit inside a page (`/whiteboard`, `/database`, `![[Page]]`). Their buttons (Open, Present, Properties, New and the like) are small icons that appear when you point at the block or tab into it; each has a name for screen readers and a tooltip.
- Pages start blank, with just a title. On an empty page, type `/` and pick **Template…** to start from a template, or **Ask AI…** to draft it. See [Templates and starter kits](#templates-and-starter-kits).
- A new page is only a draft until you write in it: one you leave untouched leaves no file behind.
- One box catches quick notes, on Home, in the Inbox and on each project's home. Ctrl+N goes to it, or opens a new card where there is none.

**Plan.**
- Home is one short screen. At the top, the capture field (Enter keeps a thought in the Inbox; start with `/` to pick an action instead) and **+ New** for a page, quick note, journal, template, deck, whiteboard or diagram. Below it, **Recent** lists what you opened and changed last, with chips for Pages, Cards, Boards, Decks, Diagrams and Captures, a project list and a field that narrows the list as you type (`/` goes to it; the arrows move, Enter opens, Ctrl+Enter opens to the right). What you chose is remembered. Beside it: today's events and to-dos with times, the first few to-dos with a field to add one, and the Inbox with **Triage**. The customize button turns on more (projects, pages, the week, the journal, whiteboards, decks), drag to put them in order, and **Reset to the simple layout** brings the usual set back.
- Every project page opens with its own home: a summary, to-dos, a quick note, recent and sub-pages, a kanban and its whiteboards.
- Tasks gathers every to-do from every page. Filter them by place, day and status, group them by project, or work them on a board.
- The Calendar is your notes by day: each day's journal, dated notes and to-dos, and the pages that mention the day, as a month, a week or an agenda. Click a day to open its journal; its + adds a to-do, a task, a note or a page there. Drag a note to reschedule it. The week's **Hours** button (H) lays it out by the hour, with timed events and to-dos like `@14:00` on their hours.
- Subscribed calendars (the desktop app): Settings → Calendar → Subscribe… (or **Subscribe to a calendar…** in the palette) takes a Google, Outlook, iCloud or other calendar's `.ics` address (`webcal://` works too) and shows its events on the Calendar, in the journal's On this day and in Home's Today. They are read-only: nothing is written to your notes or sent back to the calendar. The address is a secret, since anyone who has it can read the calendar, so KastenFlow keeps it in your system's keychain. Click an event for its details; **Make meeting note** makes a page from your meeting template, with the event's link, only when you ask. Drag an event onto a day of the Calendar or of the journal (its list of days, its month, or its page) to make that note for that day, or press **Note for a day…** in the event's details: the notice has **Undo**, and the event itself never moves. The feeds are fetched through your computer's proxy settings, if it has any; a proxy that wants a sign-in or is down is said in words, without the address. A repeating event whose later runs were changed ("this and following events" in Google or Outlook) shows the new time from that day on.

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
- The Inbox catches quick notes. **Triage** (the button, **Triage captures** in the palette, or the Inbox card on Home) goes through the Inbox and the captures nobody has filed, one at a time, newest first, with a button for **All** or **This week** (today and the seven days before). Every action has a key: `M` project, `T` tag, `B` whiteboard, `C` a collection that is made of tags, `N` a task that links the card, `A` archive (a capture is marked Filed, a card in the Inbox goes to Pages), `L` put it off to a day (`1` tomorrow, `2` a week, `3` a month: it leaves the queue and comes back that day), `R` reading state (Unread, Reading, Finished), `P` make it a page, `D` done (the trash), `S` the suggested home, `U` undo the newest notice, `J` and `K` to move, Enter to open. Each action says what it did in a notice with **Undo**, and a card keeps the address and the day it was caught. A page you saved before is said so over the card, with **Open**.
- The Card Library finds anything by kind, tag, project and date: Created and Updated take today, this or last week, this or last month, a month or a range (the search box reads `on:`, `created:` and `updated:` too), and **Group** heads the cards by type, project, tag, month or week.
- To work on several pages at once, choose Select in a page's ••• menu in the sidebar, then click the others, from any project or the Pages list (Shift+click picks a run of rows). The bar that appears puts them inside a page, moves them to a project, adds them to a whiteboard or moves them to the trash. Escape stops picking.
- Tags become databases, shown as a table, a board, a list, a gallery or a calendar, with properties and relations. Drag pages from the sidebar, the Library or the Inbox onto a database (the label says **Add tag #x** before you let go), or press **Add existing pages** and pick them with the keyboard: the pages gain the tag and stay where they are, all as one change **Undo** takes back. A page the view's filters hide is said so, with **Reveal**.
- **Collections** keep a search under a name, in the `views` folder. In the Card Library, search or filter and choose **Save as collection**, or open **Collections** (**Go to Collections** in the palette, or the sidebar's list of views) and start from an example (Unprocessed captures, Captured this week, Recently changed research, Experiments needing review). A collection looks its notes up again each time it opens, so it follows your notes; "last 30 days" stays the last 30 days. Choose a note to preview it beside the list, tick several to open them in tabs, add them to a whiteboard or add them to the AI context, and pin a collection to Home or to a project's overview from its ••• menu.
- **Tab sets** (the layers button at the end of a pane's tabs) save the tabs that are open under a name and bring them back together. **Save layout too** keeps every pane, the sidebar and the right panel; **Link to project** puts **Resume workspace** on that project's card and overview. Opening a set never closes what is open, a page that was moved is found again, a page that is gone is named, and a web page loads only when you open its tab.
- The Graph (+ in the tab bar, or **Open graph** in the palette) draws the links between your pages, whiteboards and decks, and shows a link to a page that does not exist yet as a faint ghost. Click a node to open it beside the graph (Ctrl for a tab, Alt for a split, Shift to stack), double-click empty space or click a ghost to make that page, and drag a node onto empty space to make a page linked from it. Scope it to the whole vault, one project, or the pages around one page, and filter by orphans, ghosts, kind or tag. **Graph around this page** and the Links tab's small graph show a page's neighbours.
- **Reviews** (**Daily review** and **Weekly review** in the palette, or Reviews in the sidebar's list of views) show what waits: captures to triage, what is overdue and due, projects whose review day has come, decisions (pages tagged `#decision`), finished task notes and a few highlights to revisit. Opening one changes nothing. **Mark the review done** only notes the day in this window, and **Save as note** writes an ordinary page, only when you press it. A review you did not do is a date ("No weekly review since Oct 2"), never an error. Settings → Calendar → Reviews can turn on a quiet reminder banner on Home (off until you do). On a project's overview and in a project card's menu, **Review** pins the task it does next, marks it reviewed (and when to review it again) and writes a dated update.
- **Projects** (the grid button beside the sidebar's Projects heading, or **Go to Projects** in the palette) is one page of every project, as cards or a list, with each one's status, health, to-dos and next action. See [Projects](#projects).
- **Expand** on a project's home, or **Project overview** in a project's menu, opens the whole project full screen: all its pages as a table or gallery, its captures with **File here**, its tasks as a board, its graph, and tables you save with their own filter, columns and sort. Saved tables live in the project page's `overview` property.

**Read.** Drop in a PDF to read and highlight it. Turn highlights into cards that link back to their page. Choose Clip in the reader's bar and drag a box around a figure to keep it, at 300 dpi, among the vault's images. The picture remembers its paper, page and box, and the paper's citation key if you give one, so a slide that shows it can cite the paper. On a page you kept from the web (a capture or a clipped article), select words and choose **Highlight the selected words** in the palette, or the colour bar that appears: the highlight is kept in a small file beside the page (`name.highlights.json`) and travels with it like a comment does. If the page's text changes so that the words cannot be found again for certain, the highlight is listed as detached rather than guessed at. Keep the papers you read in [References and papers](#references-and-papers) and compare them side by side.

**Work with AI.** Ask about a selection while you write, explain it, chat about the page you are on, or brainstorm on a board. See [AI in KastenFlow](#ai-in-kastenflow).

**Present.** Slide decks are files in the vault like any note: build them, present them full screen and export them to PowerPoint. See [Slides](#slides).

**Settings.** The gear at the foot of the sidebar (or **Settings** in the palette) opens a window of two panes: the groups on the left, under General, Connect, Data and System, and one group at a time on the right. Type in the box at the top of the list, or press `/` (Ctrl+F works too), to search every setting at once: the list shows how many each group has, the right pane shows what was found with the words marked, and Escape clears the search. It finds keyboard shortcuts by the name of their command too (choosing one opens the key editor at that row), and each group remembers how far you had scrolled. A **?** beside a name explains it, a dot marks a setting you changed, and the arrow beside it puts it back. The palette also opens a group or a single setting, for example **Settings: Appearance**. In a narrow pane the list becomes a drop-down.

**Bring your notes.** KastenFlow imports an Obsidian vault or any Markdown folder, a Notion export, or a Heptabase backup. Pick the folder with Browse, or drop Markdown files or a folder on the window. Import shows what will come in first, and each import is one change you can undo. An Obsidian vault can also be opened as it is, with its folders kept as folders.

**Keep an eye on things.**
- The status bar has one indicator for the state of your vault: **Saved** (with when it was last backed up), **Saving…**, **Indexing…**, **External changes** (another program changed files), **Proposed** (agent changes wait for your review), **Stale** or **Failed**; when more than one applies it shows the first and a `+` count. Click it to go to what needs a look: Review when changes wait for you, otherwise the health card below.
- Settings → History and backup has a **Vault health** card with a line for each area: saving and indexing, history and backup, changes made outside KastenFlow (conflict copies), proposed changes, references and files (broken links, missing pictures, damaged history; **Check now** runs the check), the pictures of diagrams, search by meaning, and whether the diagram editor and the browser, which some features need, are on. Looking at it changes nothing. A problem has a button to the item itself or to a preview of the repair, such as moving a conflict copy to the trash, making the page a broken link points to, or drawing a diagram's picture again; nothing is repaired until you confirm.
- A board, a deck or a diagram shown in a page gets a small **Updated** chip when it changes while the page is open; click the chip to put it away.

## Projects

A project is a folder with its own page; see [Your vault](#your-vault). The **Projects** page shows them all at once.

**The hub.**
- Open it with the grid button beside the sidebar's Projects heading, **Projects** in the sidebar's list of views, or **Go to Projects** in the palette. Every project is a card (or a row, with the **gallery or list** switch, which is remembered) with its icon, title and summary, a status chip, a health dot, a progress bar ("5 of 8 done"), open and overdue to-dos, the next action, when it was last touched, and how many pages, boards and decks it holds. The to-do counts add the project's `#task` notes and its `- [ ]` lines.
- The strip above the cards counts **active** projects, **overdue** to-dos, **reviews due** and **stale** projects (active and untouched for 30 days); press one to narrow the list to it. Below it, status chips with counts (Active, Paused, Done), an **Archived** toggle that shows only archived projects, a search over titles and summaries, and a sort: pinned first and in your order, recently active, name, or overdue first.
- Click a card to open the project's overview; **Project page** opens the page itself. The ••• button (or a right-click, or the menu key) opens it in a tab or to the right, **Resume workspace** (when a [tab set](#a-tour-of-the-app) is linked to the project), sets the status or health, pins or unpins, moves it earlier or later (in your own order), starts a **New update**, offers the **Review** items below, and archives. Changing a status, a health or the archive shows a notice with **Undo**.
- By keyboard: one tab stop for the list, then the arrows, Home and End; Enter opens the overview and Shift+Enter the page; **P** pins; Alt with the arrows moves a project in your own order; `/` goes to the search.
- **New project** asks for a name and a setup (below), shows **What it makes** before anything is written, and makes it all as one change that **Undo** takes back. Home's optional Projects row shows pinned projects first, then the one changed most recently, with their status.

**Status and health.** A project is **Active**, **Paused** or **Done** (a project with no status is Active), and may be **On track**, **At risk** or **Blocked**. Set them from the hub's menu, the chips on the project page's Summary card or the overview's header. They are ordinary properties on the project page (`status`, `health`, `next_action`, `last_review`, `review_after`, described in [the vault format](vault-format.md)), written in one change that Undo takes back; a status typed by hand that is not one of the three reads as *Other* and is left alone.

**Updates and reviews.**
- **New update** writes a dated page in the project from the *Project update* template (Progress, Decisions, Blockers, Next action), tagged `project-update`; the newest one is the project's last update.
- The **Review** menu on the overview's header and on a hub card pins the project's **next action** (you choose among its `#task` notes, soonest due first), **marks it reviewed** (and when to look again; the card then shows "Reviewed" and the day, until the next review comes due), or writes a new update, which also marks it reviewed. A project whose review day has come shows a flag in the hub and in the weekly review.
- **Daily review** and **Weekly review** gather these along with captures to triage and what is overdue; see [A tour of the app](#a-tour-of-the-app).

**Setups.** When you start a project you can choose **Research** (research questions, a literature review with a reading list, a literature map, and `reading` and `experiment` tags), **Writing** (an outline, a draft, a style sheet and a structure board), **Presentation** (talk notes, a starter deck and a storyboard board), or **Blank**. A setup adds its pages, whiteboard and sometimes a deck inside the new project's folder, as one change, and never replaces a file. The preview lists every file it will make. Agents cannot apply a setup.

**Export and import a project.**
- **Export a project…** (the palette, a project card's menu, a project's row in the sidebar, or Settings → History and backup) shows what will be written before it writes anything: the project's pages, boards and decks, the pictures and PDFs they use with their highlights, the tag schemas their notes use, and the works they cite as a `references.bib`. The history, `.kasten/`, the trash, chats and settings are never included. It writes into a new or empty folder outside the vault, with a manifest that records every file's size and checksum, so a damaged or edited bundle is refused on the way in.
- Import it from the Import view (kind *KastenFlow bundle*; `kastenflow import --kind bundle` on the command line). The preview lists what it will settle: a project folder that is taken gets a free name, notes whose ids already exist get new ones, a picture with the same name and different bytes comes in under a free name, a tag you already have is kept (with a warning) and a reference key that means another work is renamed in the project's citations. It is one change, and Undo takes it back. Agents cannot import a bundle.

## Slides

KastenFlow Slides is an editor for talks, lectures and reviews. A deck is one plain file, `something.deck`, in your vault ([the format](slides-format.md)), so it has history like your notes, moves with its project, and AI agents can work on it.

**Make a deck.**
- Choose **Slides** in the sidebar. The row **Start a new presentation** makes a deck in one press, called "Untitled presentation" until you name it in the editor: **Blank**, or one of the first templates with its example slides. **Template gallery**, or **New deck**, asks for a name, a project, a template and the shape first; **Import PowerPoint…** starts from a `.pptx` file. Under it your decks are listed newest first; search finds a deck by its name or its project, and the sort keeps them by last edit, by name or by project. A deck made outside a project goes in `library/`; one made in a project goes in that project's `decks/` folder.
- **New deck** shows a gallery of templates: eleven looks (Light, Dark, Serif, Lecture, Minimal, Bold, Modern, Academic, Pitch, Dark Studio, Warm Paper), each drawn with its own example slides (a title, a section, a list, two columns, a picture beside words, a quote and a closing slide), which you keep or delete. Choose the shape of the slides too: 16:9, 16:10, 4:3 or square. The theme dialog (**Edit theme…**) shows the same looks on its cards, and has twelve layouts for each (Title, Section, Title + body, Title only, Two columns, Title + image, Image + caption, Code, Comparison, Big number, Quote, Blank). **Slide → Change layout…**, **Change background…** and **Edit theme…** change them; a theme sets the colours, fonts and text styles of the whole deck.
- **File → Page setup…** changes the shape of every slide later: 16:9, 16:10, 4:3, square, or a width and height of your own. The slides and the theme are refitted (type follows the width; pictures, turned things and circles keep their shape), and one undo takes it back. When you present on a screen of another shape the slide is shown whole and centred; **Slideshow options** (the arrow beside Slideshow) chooses the colour of the bars round it: black, the theme's background or its dark colour.
- **Your own layouts.** Design a slide, then **Slide → Save slide as layout…**: name it and say which elements are slots (a title, a list, a picture ...) that each new slide fills in; everything else becomes decoration drawn behind every slide of the layout, together with the slide's background. The layout appears with the built-in ones, as a live thumbnail, in the arrow beside **New slide** and in the layout picker. **Slide → Edit this layout…** opens it on the editor's own canvas (**Add slot** puts a title, subtitle, list, text, picture or caption where you want it, and setting type in a slot sets the type of every slide); **Done** changes the layout and every slide that uses it follows: slots you did not move move with it, slots you moved stay, and every slide keeps its words. **Slide → Reset slide to layout** puts a slide's slots back. **Manage layouts…** renames, copies, orders, edits and deletes layouts (a layout that slides use is deleted by moving those slides to another one) and marks the one that new slides start from; in the arrow beside **New slide** (or View → New slides) the third choice, **My default**, makes new slides start from it. **Design my blank layout…** is the quick way to give blank slides your own background, footer, logo or stripe. **Slide → Import layouts…** (also a button in Manage layouts…) lists your other decks, shows the layouts of the one you pick, and brings in the ones you tick together with the text styles they use, refitted if that deck has another slide shape. **Save slide as layout…** and **Reset slide to layout** are in the right-click menu of a slide and of the canvas too.
- **Your own templates.** **File → Save as template…** keeps the look of a deck (colours, fonts, text styles, your layouts, the shape of the slides, and its slides as examples if you ask) as a file in your vault's `templates/slides/` folder. **New deck** lists them under **My templates**, where you can open, rename, copy or trash each one; **File → Apply a template…** puts a template on a deck you already have without touching its words. Assistants can read your templates but never write them.
- The same editor works on a plain folder of decks without KastenFlow: see [Slides on the command line](#slides-on-the-command-line).

**Find your way.**
- The top bar is one row: the deck's name (click it to rename), its star (the same favourite as in the sidebar), where saving stands, the menus **File** to **Help** and, at the right, the assistant, full screen and **Slideshow**. In a narrow window the menus fold into one **Menu** button. With the keyboard, Alt and a letter opens a menu (F File, E Edit, V View, I Insert, O Format, D Slide, A Arrange, T Tools, H Help; on a Mac the keys are used for typing, so use the box below). The **Menus** box (Alt+/) finds any command of any menu by its name, shows where it lives and its keys, and runs it with Enter.
- The row of tools under it follows what is selected. With nothing selected it has undo, redo, paint format, zoom, the tools that put something on the slide (select, text box, image, shape, line) and the slide's own settings (background, layout, theme, transition). Select a text box and the same row swaps to the font (a list you can search, with the fonts you used lately first), its size (a box, and a list of the usual sizes), bold, italic, underline and strikethrough, the text colour, links, alignment, line spacing, lists and indents; a shape adds fill, border colour, weight and dash, shadow and opacity; anything adds order, align and **Animate**. What does not apply to the selection is left out rather than greyed. When the window is too narrow, the last groups move into a **⋯** menu. Click the empty slide to get the tools for adding things back.
- The colour menus show the theme's colours with shades (they follow the theme when it changes), a grid of standard colours, the colours you used lately and a box for any value, with a colour square and, where your system has one, an eyedropper that takes a colour from anywhere on the screen.
- **Format options** (the button at the right of the row, or Ctrl+Alt+O) opens a panel beside the slide whose sections fold and stay folded. Drag its left edge to make it wider or narrower (arrow keys work too, and a double click gives the usual width); KastenFlow remembers the width. Right-click inside the panel for **Close panel** and a quick switch between its tabs. Drag across the letter beside a number (X, W, H …) to turn it like a dial; the arrow keys step it, Shift ten times as far and Alt a tenth. **Themes** shows every look as a small drawing of its title slide and the layouts of the deck's theme, and **Transitions** sets how the slide arrives (none, fade, slide or morph, and for how long) with a **Play** button, for this slide, every slide or the deck. **View → Compact toolbars** makes the bars a little smaller.
- **Speaker notes** sit under the slide; the strip above them folds them away.

**Edit.**
- The filmstrip on the left lists the slides. Drag its right edge to make it wider or narrower, from 160 to 360 pixels (the arrow keys work on the edge too); KastenFlow remembers the width. Right-click the empty part of the filmstrip for **New slide**, **Paste** and **Add section here**. Drag to reorder (the slides go under the pointer and the others make room where they will land; a pull to the top or bottom edge scrolls the list); Shift and Ctrl pick several to move together. Up, Down, Home and End move through the slides, Enter adds one after the slide shown, and Tab goes on to the slide itself. Ctrl+M adds a slide and Ctrl+D duplicates one. **Slide → Skip slide** leaves a slide out of the show, and **Backup slide** files it under the slide before it, to be opened with the down key when a question calls for it. Sections group slides: add, rename and remove them from the filmstrip's menu, and fold them away.
- **Insert** adds a text box, image, shape, line or table. Drag to move, resize and rotate; guides snap; group, align, distribute and lock from **Arrange**, from the small bar that appears over two or more selected things, or from the right-click menu. Drag a rectangle to select several (hold Alt to take anything it touches); it can start over an empty text slot, and a click there selects the slot. Double-click a group (or press Enter on it) to work on what is inside it; Esc goes back up. Slides in the filmstrip move to their new places when you drag them, and picking a transition in **Slide → Transition** plays it on the slide; it can also be set for the whole deck. Lists (Ctrl+Shift+8 and 7), links (Ctrl+K) and find and replace (Ctrl+F) work as in a document, and each action is one step of undo.
- **Tables.** **Insert → Table** puts a grid on the slide. Click a cell to pick it; Shift+click or drag across cells picks a block (a merged cell is always picked whole), and Ctrl+A picks them all. Double-click a cell, press Enter or F2, or just start typing to write in it. While you write, **Tab** and **Shift+Tab** move to the next and previous cell (Tab in the last cell adds a row), **Enter** writes the cell and goes down, **Shift+Enter** starts a new line in it, **Esc** throws the edit away, and clicking elsewhere writes it. With cells picked, the arrows and Shift+arrows move and extend the pick, **Delete** empties the picked cells and keeps the table, **Esc** picks the whole table, and Delete then removes it. Right-click a cell, or open **Format options → Table**, to add a row above or below, a column left or right, delete rows or columns, **Merge** and **Unmerge** cells, and colour the picked cells. **Copy** puts the picked cells on the clipboard as tab-separated text, which a spreadsheet understands, along with the cells themselves for pasting into another table here. **Paste** takes cells from Excel, Google Sheets or any tab- or comma-separated text: only the words come across (a spreadsheet's merged cells arrive unmerged), written from the top left of the cells picked, with rows and columns added as needed. A paste that would cut through a merged cell of the slide is refused, and says which cells; unmerge it first. Every one of these is a single step of undo. Paint format and the highlight colour work on cells too.
- **Keys work as soon as a deck opens.** Delete, Undo, Copy, Cut and Paste act on the slide without a click first, and go on working after a dialog or menu closes, after a presentation, or after you come back from another window.
- **Move a block by its handle.** A small four-arrow chip sits at the top-left corner of the selected block, and a lighter one appears when you point at any block; it stays put while you type in a text box. Drag it to move the block (snapping and guides work as usual). The arrow keys nudge by 1 and Shift with an arrow by 10; a run of taps is one step of undo.
- **Move, copy and look about.** Hold Alt or Ctrl (Cmd on a Mac) while dragging to leave the block where it is and put a copy where you let go; Shift keeps a move to one direction, resizes with the ratio and turns in 15° steps, and Alt on a resize works from the centre. Esc during a drag puts everything back. Ctrl+wheel or a pinch zooms about the pointer; the zoom menu, Fit and the zoom keys glide, and keep the place you are looking at where it is. Scroll with the wheel, or hold Space (or the middle button) and drag to move the slide about; dragging a block to the edge of the window carries the slide with it. Undo, redo, align and distribute glide the blocks to where they go. Press F2 or Enter on a selected text box to type in it.
- **Add with one key.** With the slide in focus (not while you type in a text box) press **T** for a text box at the pointer, ready to type, **R** for a rectangle, **O** for an oval, **L** for a line, **A** for an arrow (drag to draw them) and **I** for the image gallery. The keys are shown beside the items in **Insert** and in **Help → Keyboard shortcuts**.
- **Paint format and highlight colour.** Paint format (the roller in the toolbar) copies the look of what is selected and paints it on something else; its keys are **Ctrl+Alt+C** to copy and **Ctrl+Alt+V** to paint, and it paints table cells and whole tables too. The **Highlight colour** button in the text toolbar shades the words behind them in a theme colour or any colour you choose, paint format carries it, and PowerPoint gets it as a text highlight. A deck that uses a highlight colour (or linked citations, below) is saved in deck format 2, which a KastenFlow older than 1.2 cannot open; a deck that uses neither is saved exactly as before.
- **Small aids.** Drag a rectangle from the grey around the slide to select what it touches. While you move or resize, a readout shows the position or the size. Hold **Alt** over another block to see how far it is from the one selected. A shape you add lands where you last pointed on the slide, snapped. In the outline, the **+** adds a blank slide, and the first words you type in it give it the title-only layout as part of the same undo step. A slide pasted into a deck of another shape is scaled to fit.
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
- **Rehearse.** **Slideshow → Rehearse** (also in the **View** menu) opens the presenter's view with a clock on: it times every slide and step while you talk through the deck. Nothing advances by itself; the clock only watches. The rehearsal bar has **Pause**, **Resume**, **Restart** and **Finish**, and the summary at the end lists each slide's time next to your previous run. **Past rehearsals…** lists the runs kept for the deck. They are kept on this computer, not in the vault, and a run made before you changed the slides is marked outdated.
- **Web pages.** A web link followed in a presentation opens the page in a peek at the side of the slide; drag its edge to make it wider or narrower. The icons at the top of the peek are Back, Forward, Reload, Side or middle, Full screen, Open externally and Close. **Esc** steps back one level at a time (full screen or middle, then the side, then closed) and never moves the talk; closing the peek puts you back on the same slide and step. In the editor, **Preview live** on an embedded web page (its chip, the right-click menu or the Menus box) shows the page in the same peek beside the slide.
- In the desktop app these pages are shown by KastenFlow's browser, so **Settings → Browser → Use the browser** must be on. When it is off the peek shows a card with **Turn on web previews** (Settings opens in a tab, which you see once you leave a full-screen show) and **Open externally**. A page that cannot be shown (for instance an address the browser refuses to open) or that is slow to load says so on a card with **Open externally**; nothing is taken away after a few seconds. With no connection, the browser's own error page is what shows in the peek. KastenFlow does not take a picture of a web page by itself: the poster a slide shows for an exported page is a picture you choose.

**Export and print.** **File → Download** gives a PowerPoint file (a slide with steps becomes one slide for each step, so it builds the same way in PowerPoint), a PDF, PNG images (at 1×, 2× or 4×, for each slide or each step), a Markdown outline, or the whole talk as one web page (.html) that plays offline. **File → Print…** prints it. Before an export (and before presenting) KastenFlow checks the deck and lists what would go wrong: text that overflows, things off the slide, missing fonts, pictures it cannot read, pages a slide links to that are gone, broken links, citations that name no work, for PowerPoint what it is known to draw differently, and for a PDF or PNG a web page on a slide that has no poster picture. Each finding names the slide and what fixes it, and **Export anyway** always goes ahead. Before a talk, only what would stop it is checked.

**Import.** **File → Import slides from PowerPoint…** reads a `.pptx` and asks whether to add its slides to the deck, replace the deck with them, or bring them in as a new version of a deck you took to PowerPoint and edited there (what is still in the file keeps its place, what is new is added, and slides the file lacks stay). Runs of similar slides can be collapsed into steps. What KastenFlow cannot draw, such as a chart, is kept as it was and written back untouched, and the import lists what it could not keep exactly. It is one step of undo.

**A deck from a page.** **Turn sections into a deck** in a page's ••• menu (or **Turn this page's sections into a deck** in the palette) first opens a storyboard, **Make slides from this page**: one row for each slide the page's sections would make, with its title, its point, its evidence (the section's lists, quotes and pictures), the notes for the speaker and a layout. Move rows up or down, merge a row with the next, split one at the cursor, leave one out, and edit any of it; choose the deck's name, project, template and slide shape; **Make the deck** builds it and lists anything left out. The slides remember the section they came from. When the page changes later, **Tools → Review sources…** compares every slide with its section: slides you have not touched can be updated, and a slide you edited is kept as it is or replaced, as you choose. An update changes a slide's body, not its title or notes. A tall picture from the page is drawn into a wide frame until you resize it.

**Every deck at once.** **Turn off slide numbers in every deck…** (the palette) lists the decks that show slide numbers and turns them off in all of them as one change, with an **Undo** notice that puts every deck back. If one of the decks changed while the list was open, none is changed.

**Check the deck.** **Tools → Lint** looks for what goes wrong on a screen: text that does not fit its box, is too small or too pale, things off the slide, overlapping or almost aligned, empty placeholders, pictures without a description, missing fonts, too many words, thin margins, steps that show nothing, citations that name no work, and things PowerPoint would draw differently. The dialog lists them and jumps to each. Nothing warns you on its own while you work; if you want a badge on each thumbnail that counts what is wrong, switch on **View → Lint badges** (KastenFlow remembers the choice on this computer).

**Images and the gallery.** Every picture you paste, drop, clip or import is kept once, in the vault's `assets/` folder, and any page, whiteboard or deck can show it. Nothing is ever deleted for you: a picture that nothing uses stays where it is.
- Where a picture came from is remembered. Beside each picture, in a hidden `.meta` folder, a small file records its name, size, when it came in, how (pasted, a file, clipped from a paper, made by an agent, or brought in from PowerPoint) and who added it. You can give it tags, a caption and a citation key. Pictures that were there before are listed as they are and get their file when you first change something about them.
- The same picture is one picture. Paste the same image twice, or drop a file you already have under another name, and you get the picture you already have, not a copy.
- Open the gallery from a deck with **Insert → Image → Image from the gallery…**. It lists every picture in the vault, newest first, as small thumbnails. Search finds a name, a tag, a caption or the title of the paper a figure came from. The filters show pictures in **This deck**, **Recent** (the last two weeks), **Agent-made**, **From papers** and **Unused**.
- Double-click a picture (or press Enter, or choose **Add to slide**) to place it in the largest free part of the slide. Drag it onto the slide to place it where you let go, or onto an empty image placeholder to fill it. Paste a picture into the gallery, or drop files on it, to add them.
- Choose a picture to see the notes, whiteboards and decks that show it; a slide of the open deck is a link that jumps to it. "Unused" only filters: it never deletes.

**Papers and citations.** Keep the bibliographies of your papers in `.bib` files anywhere in the vault. **Insert → Citation…** finds a work by key, author, title or year and adds it to the slide's footer as "Vaswani et al., 2017 (NeurIPS)", as a number, or as a full reference; a slide made of a citation list prints every work the deck cites, in order. A key that names no work is marked, and the lint says which work it may be. Select the citation and turn on **Link each work** in its Format section to make every work a link to its DOI (or its web address, or its arXiv page); the link shows in the editor, in the show and in exports. Add and edit the works themselves in [References and papers](#references-and-papers). In the PDF reader, choose **Clip** and drag a box around a figure to keep it at 300 dpi, with its paper, page and box remembered; placing it on a slide adds the paper to that slide's citations.

**Work with AI.** The deck tools are part of KastenFlow's MCP server (see [Connect AI agents](#connect-ai-agents)), and the chat can use them too: an agent can outline a deck, build slides and diagrams, fill and reshape tables (set cells, add and delete rows and columns, merge cells), place pictures, cite works and check the result with the lint. Its changes are commits like any other. Over MCP a small edit goes straight in (the app's own chat holds its changes for your review first: see [AI in KastenFlow](#ai-in-kastenflow)); taking many slides out (removing them, or emptying them) waits for your review (`guardrails.max_slides_removed` in `.kasten/config.yaml`, 3 in ten minutes by default) with the slides before and after side by side, and **undo session** takes back everything a session did. [skills/kasten-slides/SKILL.md](../skills/kasten-slides/SKILL.md) teaches Claude Code the loop: outline first, then build, render, lint and repeat until nothing is an error.

**The assistant tab.** **View → Assistant** (or the sparkle button at the top right) opens KastenFlow's chat beside the slide. It knows which slide you are on and which elements you have selected, so "tighten this" and "add a diagram that shows the loop" mean what you are looking at. Each deck has a conversation of its own, saved with your other chats: start a job, go to another deck or page, and come back to find the conversation, its plan and its answer where you left them, and it keeps working while you are away. What it changes waits as a preview you can apply or discard (see [AI in KastenFlow](#ai-in-kastenflow)); once applied it is one session you can take back with **Undo this chat's changes**.
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
- Pictures that are missing or out of date, such as a diagram an agent made, are drawn again quietly while the editor is installed. Until then a diagram an agent made or changed shows a simple draft picture that KastenFlow draws itself.

**Use it.**
- **In a page.** Type `/diagram` and pick one, or make a new one, or write `![[Login flow.drawio]]` on a line of its own. It shows as the picture, centred; hover for **Edit** (or double-click) to edit it in place, **Open in a tab**, **Copy as image** and export. `[[Login flow.drawio]]` inside a sentence is a link that opens it.
- **On a whiteboard.** Drag a diagram from the Diagrams view onto a board: a card shows its picture, and a double click edits it over the board. A `.drawio` file dropped from your desktop is brought in as a diagram; a `.drawio.svg` picture is an ordinary picture.
- **In a slide.** **Insert → Image → Diagram…** chooses a diagram (or makes one) and puts its picture on the slide, as a PNG (drawn by the diagram editor, so it needs to be installed) kept with the deck's pictures so it works in PowerPoint and PDF. Select the picture and choose **Edit diagram** (the toolbar, or the right-click menu) to change the diagram over the slide; the slide's picture is replaced when you close the editor. The slide remembers which diagram the picture is of; a slide never holds the diagram itself.
- **With AI agents.** Agents draw and change diagrams with typed steps rather than XML: `diagram_new` makes one from a description, a Mermaid flowchart (flowcharts only) or a template (three tiers, C4, event driven, CI/CD, network, sequence, ER and more) and lays it out; `diagram_describe` reads it; `diagram_edit` adds boxes and arrows, restyles, groups, moves and lays out; `diagram_lint` and `diagram_preview` check it; `diagram_find_shapes` looks up the editor's icons (AWS, Azure, Kubernetes, flowchart and more; Google Cloud's product icons are pictures in the editor, so that style draws plain boxes in a project and region); `diagram_export` keeps an SVG in `assets/` (it offers no PNG: the diagram editor makes those). Each style (architecture, C4, cloud, Kubernetes, flowchart, sequence, ER, mind map and network) comes with colours, sizes and an automatic layout that works to reduce crossings and keeps boxes on the grid. A step is applied to the diagram as it is when it runs, so what you drew meanwhile is kept, box for box. Agents can still read and write whole XML (`list_diagrams`, `get_diagram`, `create_diagram`, `update_diagram`). A change that takes a lot out of the drawing or moves most of its boxes, and any move to the trash, waits for your review. In a chat with changes held back for you, a diagram change is held back like any other and shows in the review before it is applied.
- **With AI in the app.** The diagram editor's header has **Draw with AI**, which opens the chat about this diagram with "Change this diagram: " ready for you to finish (nothing is sent until you send it); **Check diagram**, which asks the chat at once to look for overlapping boxes, arrows that end nowhere or carry no label, things off the page, too many boxes, crossings, low contrast and unsafe links; and **Tidy**, a menu of the editor's own layouts (flow top to bottom or left to right, tree top to bottom or left to right, radial tree, organic; the tree layouts work only with nothing selected). **Draw with AI** is also in the Diagrams view and in **Insert → Image → Diagram…** on a slide. In the chat, **+ Context → A diagram…** attaches one, and `/` offers **Draw a diagram**, **Explain this diagram** (read only), **Tidy this diagram** and **Check this diagram**. The review of a held-back diagram change shows its picture before and after (**Show XML** shows the file); once you apply it, an open editor reloads, unless it holds work you have not saved, in which case it keeps your work and tells you once. Until the editor next draws it, a diagram an assistant changed shows KastenFlow's draft picture, in which a library icon is a labelled box.

## References and papers

The works you cite are the entries of the `.bib` files in your vault. **References** lists them all, and you can cite them from pages, slides and the comparison pages below.

**The References view.**
- Open it from the sidebar's list of views (under **More views**) or with **Go to References** in the palette. The table shows each work's key, authors, year, title, link, which file it comes from (*managed* or *external*) and where it is cited. Search it, sort by any column, and filter by **All**, **Managed**, **External**, **Incomplete** (fields missing) and **Repeated** (the same key, DOI or arXiv number twice).
- Choose a work to copy its citation, its BibTeX, its link or its `[@key]`; see the pages, decks and pictures that cite it (each with **Open**); open its PDF; change its fields in a form, or its BibTeX text directly (checked as one whole, valid entry with the same key before it is saved); rename its key; or, for an external work, **Make a managed copy**. Every change is one change in the history, and **Undo** takes it back.

**Which files change.** KastenFlow writes only `sources/references.bib`, which it makes when you add your first paper. Every other `.bib` file in the vault is read only: its works are listed as external, can be cited and can be copied, but are never rewritten. **Make a managed copy** copies one work, or all the works of a file, as written (with the `@string` macros they use) into the managed file, which you can then edit. A key that is in two files means the managed file's work. An edit changes only the bytes it means to: a value, a new field on a line of its own, a removed field; comments, macros, fields KastenFlow does not know, spacing and line endings stay as they were.

**Zotero.** Set Zotero's Better BibTeX to auto-export your library to a `.bib` file inside the vault. Zotero keeps that file up to date and its works appear here as external references. KastenFlow never rewrites the file and does not send anything back to Zotero; to change a work, make a managed copy of it first.

**Add a paper.**
- **Add a paper…** (the palette, or the button in References) takes whatever you have: paste BibTeX (several entries are done one at a time), a plain citation (APA, IEEE, Chicago and Harvard styles are read), a DOI, an arXiv number or address, or fill in the form. **Nothing is looked up online.** What you paste is read on your computer, and what could not be read stays empty for you to fill in. A DOI or an arXiv number pasted alone fills only its own field.
- The form shows what was found before anything is saved. Fields that were guessed say **Check this** and empty ones say **Missing**; none is invented. The key is suggested from the author, the year and the title and is yours to change; a key already in use is refused, and a work with the same DOI or arXiv number names the one you already have, with **Open existing** (you can add it anyway). **Save** is one change with **Undo**.
- From the web: with a page open in the browser tab, **Save as paper** in the browser bar (or **Browser: save the page as a paper** in the palette) reads the page's own citation tags and opens the form filled in; a page without them gives only its title and address, and says so. The browser extension's popup has the same **Save as paper** when the page offers tags: it opens the form in KastenFlow and makes no card in the Inbox. After you import a single PDF, a notice offers **Add paper…**: the form is filled from the PDF's own information and a DOI or arXiv number on its first page, and the PDF is linked to the reference, so **Open the PDF** appears in References.

**Cite in a page.**
- Pick **Citation** from the `/` menu, or **Insert citation…** in the palette, and choose a paper by key, author, title or year (add `, p. 4` for a page). It writes `[@key]`, or `[@key, p. 4]`, `[see @a; @b]` and `[-@key]` (the year alone) as plain text in the page; the file keeps exactly that.
- The page shows each citation as a chip such as "(Vaswani et al., 2017)", and a card with the title, venue, a link and **Copy citation** when you point at it. A key that is in no `.bib` file shows in a warning colour. The words come back while the cursor is in a citation, so you can edit them. **Ctrl+click** a chip, or press **Ctrl+Enter** inside a citation, to open the reference.
- **Rename a key** in References shows what the change will touch (the `.bib` file, pages, decks, and pictures clipped from papers that name the key) before it makes it as one change, with **Undo**. Only a managed work can be renamed, and not to a key already used. A citation in a deck's master or layouts is reported and left alone.

**Compare papers.**
- **Compare papers…** (the palette, the Highlights page, or two or more papers ticked in References) lists your papers that have a PDF, then PDFs without a reference. Tick the papers, choose highlights to start the Evidence column from, name the columns (Question, Method, Evidence, Limitations and Relevance to begin with), and **Create comparison page** makes a table, or **Create outline** makes an outline, as ordinary pages. Every quotation carries its citation and a link back to its PDF page and highlight.
- In the PDF reader, **Insert in page** on a highlight adds the quotation, its `[@key, p. 3]` and the link back to the page open beside the PDF (if none is open, to a new "Notes on" page beside it).
- **Get a first draft from AI** is optional and sends nothing until you press **Ask AI for a draft**: **Show what would be sent** lists the exact passages, each with a checkbox. The answer sets quotations apart from the AI's own words ("Written by AI, to check"), marks a quotation it cannot find in the passages and a `[@key]` that is not among the papers sent, and goes into a page only when you ask, under "Draft by AI: check every claim against the source". It is for you to check that a cited passage supports each claim.

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
  the sign-in on this computer. KastenFlow checks the sign-in against
  OpenAI's published keys and ties it to one ChatGPT account, so a sign-in
  made with an earlier version shows **Sign in again** in Settings → AI
  providers: use it once and you are back. Signing in as a different
  ChatGPT account is refused until you sign out of the first. When the
  sign-in works but needs a look, the ChatGPT row says so in a line of its
  own: the account's identity could not be checked at the last renewal (it
  keeps working, and the check is made again at the next one); the system
  keychain would not keep the sign-in, so it lasts only until KastenFlow
  closes and you sign in again next time; or the keychain could not be
  read just now (the sign-in is not forgotten).
- **If your ChatGPT chats stop working.** A busy server, a dropped
  connection or a timeout never signs you out: KastenFlow tries again
  (see **Poor connections** below) and keeps the sign-in. Open Settings →
  AI providers and read the **Connection report** first: it shows how far
  each recent request got (signing in, renewing the sign-in, loading the
  model list, the request or the answer) and how it ended. Then press
  **Test** on the ChatGPT provider: it sends a small request the way a
  chat does and names the step that failed. If OpenAI refused the sign-in
  itself, the ChatGPT row offers **Sign in again**; use it. If the
  browser says the sign-in could not be verified, check the computer's
  date and time first. When you ask someone for help, **Copy report**
  and paste it into your message.
- **Pick a model, and what it can do.** The model picker lists the models
  your provider or ChatGPT plan offers (typing a name still works). The
  sliders button beside it shows only the settings that model takes:
  reasoning effort, a thinking budget, temperature, the longest answer.
  A ChatGPT plan offers reasoning effort alone, marked as tried the first
  time you use it: if OpenAI refuses it, the answer says so, is sent
  without it, and the control is left off for that model. The settings
  belong to the chat. When a request fails, the message says why
  (cancelled, no connection, model unavailable, no permission, rate
  limited, too long or refused) and offers **Retry**, **Choose model** or
  **Open Settings**.
- **Poor connections.** A request that meets a busy or rate-limited
  server, a connection that drops, or an answer that breaks off before
  the model has asked for anything is tried again, up to four times in
  all, with a longer pause each time (from half a second to eight). The
  chat says "Connection dropped, trying again (2 of 4)" while it waits,
  and the answer starts again from the top when the connection is back.
  **Stop** ends a wait at once. If a server asks you to wait longer than
  half a minute, the request ends with its message instead. Nothing is
  tried again that a second go cannot change: a refused key, a used-up
  plan or usage limit, a model that is not there, a chat that is too long
  or a certificate that is not trusted. When the last try fails, the
  message ends with "Tried 4 times."
- **Connection report.** Settings → AI providers → **Connection report**
  lists the last requests to your AI providers, newest first: the time,
  provider and model, how far the request got, how it ended (the status
  and a short reason, such as `closed` or `timeout`), how many tries it
  took, whether the sign-in was renewed or the connection made again, and
  how long it took. It holds no keys, tokens, email addresses, prompts or
  answers, so **Copy report** can go straight into a message. **Refresh**
  reads it again and **Clear** empties it. It is kept on this computer,
  not in your vault.
- **While you write.** Select text and choose **Ask AI** in the toolbar,
  or type `/` for **Ask AI…**, **Continue writing** or **Summarize page**;
  on an empty page, **Ask AI…** drafts it. The answer appears in a preview
  beside the text: **Replace selection**, **Insert below** (or **Insert**
  when nothing was selected), **Try again** or
  **Discard**. Nothing enters the page until you take it, and Ctrl+Z
  takes it back.
- **Explain.** Select words and choose **Explain** in the toolbar (or
  right-click the selection: it offers Explain, Ask AI, Copy and Cut). The
  answer appears in a read-only panel, for the text nearby or, with a
  switch, the whole page, with **Copy**, **Continue in chat** and
  **Discard**. It explains; it never writes into the page.
- **The chat** sits at the top right (Ctrl+Shift+A, which also puts the
  cursor in its box). Drag its left edge to make it wider or narrower, from
  320 to 720 pixels (the arrow keys work on the edge, and a double-click
  gives the usual width); in a narrow window it takes the whole area,
  the pages behind it step aside (a web page too), and **Show page**
  brings the page back for a moment. A new chat reads only the page you are
  on: its chip follows the page you are looking at while **Follow active
  page** is on, **Pin** keeps one, and **+ Context** (or typing `@` or
  `[[`) adds more, such as a board, a diagram, **Every open page**, or a
  PDF's pages or highlights. The chips show exactly what will be sent
  before you send it: they sit in one row above the text, scroll sideways
  when there are many, and **+ Context** stays beside them. The message
  box keeps one size: it does not grow as you type (long text scrolls
  inside it) and it does not change when you make the chat wider or
  narrower; the **Follow active page** switch sits in the bar under the
  text. You can **Regenerate** an answer, **Edit and
  resend** a question, rename a chat, and search the chats in the Chat
  view. It can create and design pages, add cards and fill whiteboards,
  rewrite a section and propose templates. **Ask AI about this page** in a
  page's ••• menu starts a chat about it. Brainstorm on a board, and every
  idea arrives as a card.
- **Attach text, pictures and files.** Paste into the message box, drop
  onto it, or choose **+ Context → Attach a file…**. A long paste (over
  about 2,000 characters or 40 lines) becomes a "Pasted text" chip
  instead of filling the box; open the chip to read it, and **Insert as
  text instead** puts it back. You can also attach a picture (PNG, JPEG,
  GIF or WebP), a text or code file (UTF-8, up to 1 MB: Markdown, plain
  text, CSV, JSON, source files and the like) or a PDF; a PDF dropped on
  the message box is attached, not imported into your vault. At most five
  go with one message. A picture is scaled down to at most 2048 pixels on
  its longest side and 5 MB before it is kept (a scaled GIF keeps only
  its first frame, and a picture saved again may change from PNG to
  JPEG; the chip says what was done). A PDF is read as text, its first
  10 pages and at most 30,000 characters; one with no text, such as a
  scan, is refused with advice to attach its pages as pictures. Text is
  cut at 200,000 characters, and the chip says so. Anything else is
  refused in a sentence that names the file. Each attachment is a chip
  you can open to look at, and one that could not be used stays as a chip
  that says why until you dismiss it. Text goes to the model fenced and
  marked as material to read, not as instructions to follow. A sent
  question shows its attachments, and the chat keeps them with it (on this
  computer, not in your vault) so it can look at them again.
- **Pictures and the model.** A model that cannot read pictures says so
  on the chip ("This model can't read pictures") and is never sent one,
  instead of ignoring the picture. When KastenFlow does not know, as with
  a model on a local server, the chip says the model "may not read
  pictures", and **Send pictures to this model anyway** tries it for that
  chat. On a ChatGPT plan KastenFlow cannot be sure either: a picture is
  tried the first time you send one, and if OpenAI refuses it the answer
  says so.
- **Long jobs, limits and Continue.** The chat no longer stops after a
  handful of tool calls. It works in steps (each one a trip to the model;
  "Step 7" is said quietly under the answer), reads several notes at once
  when it can, and in a job with many parts is asked to keep a short
  **plan** above the answer, a checklist that goes from to do to doing to
  done as it works. One answer may take up to 80 steps, 250 tool calls
  and 30 minutes; Settings → AI providers → **Agent limits** changes each
  (**Steps in one go**, **Tool calls in one go**, **Minutes in one go**)
  and puts the usual numbers back. When it reaches a limit it
  **pauses**: a calm line says why ("Paused after 80 steps — Continue to
  let it go on") with a **Continue** button, and pressing it carries on
  in the same answer with a fresh allowance. A pause is not an error and
  nothing is lost. The chat pauses in the same way if it notices it is
  going round in circles (the same call with the same result, again and
  again), if an answer or a tool call keeps being cut off by the model's
  length limit, or if KastenFlow was closed while it worked.
- **Talking to it while it works.** Send another message while the chat
  is working and it waits instead of being refused: it shows as waiting
  ("Will be sent at the next step"), and the chat takes it up at its next
  step, so a correction reaches it in the middle of the job. **Stop**
  stops the work and drops what was waiting; a message that was waiting
  when the chat paused is still waiting when you press **Continue**.
- **Long conversations.** The whole conversation goes back to the model
  with every request, so a chat that has done a lot can outgrow what the
  model can read. As it nears that, KastenFlow first leaves out the
  contents of old tool results and older pictures (the newest two stay),
  which the chat can ask for again, and, nearer still, replaces older
  steps with a short summary that keeps the plan and the list of changes
  waiting for your review. It tells you: "Earlier steps were summarised to
  make room." For a model on a local server KastenFlow assumes a window of
  100,000 tokens, so a chat with a smaller model may still say it is too
  long: start a new chat.
- **Chats keep working in the background.** A chat that is working goes
  on when you close the chat, switch to another view or to a deck in
  Slides, or close the window to the tray (the usual **Keep running when
  the window closes**, in Settings → Desktop). The chat button at the top
  right shows a pulsing dot while a chat works and, when you are not
  looking at them, a count of the chats that finished, paused or failed;
  opening a chat clears it. In the chat list each chat says Working,
  Paused, Interrupted or Failed (and Done while it is news). When
  KastenFlow is in the background and notifications are on, a system
  notice says that a chat has an answer, has paused or could not finish,
  in fixed words that never show what the chat said. In Slides, the
  assistant tab brings back its deck's conversation, plan and answer when
  you return to the deck, and its header says whether it is working.
  Quitting KastenFlow from the tray stops a working chat.
- **Chats are saved on this computer, not in your vault.** After every
  step KastenFlow saves the chat in its own data folder for this vault:
  what was said, the plan, the attachments and the changes waiting for
  your review. They come back after a restart and appear in the chat
  list. The folder also holds what the chat read from your notes to
  answer, so treat it like your other app data; no keys or tokens are
  saved in it. A chat that was working when KastenFlow closed or crashed
  is listed as **Interrupted**: open it and press **Continue**. It goes
  on from its last step and nothing that already ran runs again; what it
  did before is in History. KastenFlow never deletes a chat on its own,
  however old or many: you remove one with the ••• menu beside it,
  **Remove from the list**, which takes the saved copy off this computer
  and cannot be undone (a chat with changes waiting asks you to apply or
  discard them first). What a removed chat changed in your notes stays in
  History, and **Save chat** in the same menu first makes a note of the
  conversation in your vault if you want to keep its words there. The
  attachments of all the chats in a vault share 200 MB on this computer:
  when that is used up a new attachment is refused with a sentence, and
  removing old chats frees the attachments only they used.
- **Changes wait for your review.** When a chat changes your notes, the
  changes are not written yet. A bar above the message box says how many
  are waiting, with **Review**, **Apply** and **Discard**. **Review** shows
  each file's change: a note as a text diff, a deck slide by slide, a
  diagram as its picture before and after. **Apply** writes them all
  together as one change, which **Undo this chat's changes** takes back.
  **Discard** (it asks first) throws them away; only the chat's waiting
  copy is removed, never anything in your vault. If a file changed since the
  chat staged its changes, KastenFlow combines what it can: a note is
  merged with your edit, and a deck or diagram edit is repeated on the file
  as it is now. When something cannot be combined, such as a board that
  changed, nothing is written and the bar says so: **Recalculate** repeats
  the chat's steps on the files as they are now and lists any step it had
  to leave out. A rename, a move, the trash, a rewrite of a whole note, a
  tag schema or a template is never run in a preview: it goes to Review as
  a proposal for you to accept or reject. Tick **Apply directly** under a
  chat to have its changes saved as it makes them, as before. Changes you
  have not applied are kept with the chat, so they are still waiting
  after you close and open KastenFlow (they live in the vault's cache
  folder, never in your notes), and the search and the chips see your
  notes as they are, not the waiting changes. Agents connected over MCP
  are not affected.
- **AI actions.** Type `/` in the chat's box for a list of actions:
  **Explain**, **Compare sources**, **Outline**, **Extract action items**
  and **Draft project update**, and for diagrams **Draw a diagram**,
  **Explain this diagram**, **Tidy this diagram** and **Check this
  diagram**. An action is a short Markdown file: its header says what it
  needs (the selection, the page, sources, the project), whether its answer
  is only read, inserted or proposed for review, and where it is offered
  (the editor, the chat or the PDF reader); the rest is the instruction.
  They ship with KastenFlow. To change one, or add your own, put a file in
  the vault's `templates/ai/` folder; one named like a built-in, such as
  `Compare sources.md`, replaces it. They are not page templates: they stay
  out of the template gallery, search, backlinks and the graph, and agents
  can only propose changes to them.
- **PDF pages as context.** In the PDF reader, **Ask AI about these
  pages…** sends the pages you choose (up to 10 pages and 30,000
  characters) and **Explain** on a highlight explains it; a chip can also
  send a PDF's highlights (up to 50 and 20,000 characters). The text is
  fenced and marked as the PDF's own words, not as instructions to follow.
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
  a Mac), so capture, backups and any chat that is working carry on. The tray menu opens KastenFlow,
  starts a quick capture, backs up now, gets the latest or quits. Turn
  off **Keep running when the window closes** in Settings → Desktop to
  quit when the window closes.
- **Notifications** say when a backup keeps failing, an update is
  ready, or a chat has an answer, has paused or could not finish, only
  while KastenFlow is in the background, and never show what a note or a
  chat says. They can be turned off in Settings → Desktop.

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
  database with views by site and by day. A page you have already kept is
  said so ("Already saved on 2026-09-01 · Open · Save another snapshot"); a
  snapshot is a second card that points back at the first, which is not touched.
- **New tabs and keys.** The **+** beside the address box opens a new browser
  tab with the cursor in the address box. **Ctrl+T** does the same when a
  browser tab is the one in front (anywhere else it opens Home, as before).
  **Ctrl+T**, **Ctrl+W** (close the tab) and **Ctrl+L** (the address box) keep
  working while a web page has the keyboard, so you need not click out of the
  page first; they are taken only while KastenFlow's window is in front. A tab
  you have not looked at for ten minutes is closed to save memory and loads
  again, at the same address, when you come back to it.
- **For slides.** A web page in a slide, or a link followed in a presentation,
  is shown by this browser too (see [Slides](#slides)), so **Use the browser**
  must be on. The browser keeps up to four pages open at once; opening more
  closes the one you used least recently, never the page beside a slide.
- Some sites, Google among them, may refuse to sign you in inside an embedded
  browser. The arrow beside the address opens the page in your system browser.
- Menus and dialogs that open over a page hide it for a moment, as a web page
  is drawn above everything else in the window. **Clear browsing data** is in
  Settings → Browser.

## Captures and the browser extension

Everything kept from the web is a card tagged `capture`, and the **Captures** table
lists them: the address, the site, the day, a status (New, Read, Filed) and whether you
have read it (Unread, Reading, Finished). The same page written another way (`http` or
`https`, with or without `www.`, a `#fragment` or `utm_` tracking) is the same page. Open it
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
  with a link to its source; nothing in the page is changed. A page you already sent is
  not sent again by accident: the popup says it was saved and offers **Save another
  snapshot**, and a right-click send says so and sends nothing.
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

The command-line `kasten-mcp` prints these lines for itself, with its own path and your vault's full path, and checks itself (the installed app has no console on Windows, so Settings is where it shows the same lines):

```sh
kasten-mcp --vault ~/Notes --setup claude-code   # or claude-desktop, or http
kasten-mcp --vault ~/Notes --check               # says how it is doing; exits 1 when something is wrong
```

An agent can ask the same with the `server_status` tool. It says whether the vault keeps history and whether this program can draw slides for the agent (`render_slide`, `render_grid`, and the exact text sizes `lint_deck` uses). Drawing needs Chrome, Chromium or Edge on your computer: KastenFlow never installs one, and never runs it without its sandbox. The `kasten-mcp` program from the command-line download draws slides. The installed app does not carry the page it draws them with (it would add about 5 MiB to the installer), so it says so in one sentence and its agents use `lint_deck` to check slides instead.

[skills/kasten/SKILL.md](../skills/kasten/SKILL.md) teaches Claude Code the vault's conventions. Review and undo agent work from the app, or from the command line:

```sh
kastenflow proposals --diff    # changes waiting for review
kastenflow accept ID           # or: kastenflow reject ID
kastenflow undo-session ID     # revert a session as new commits
```

## Backup and restore

KastenFlow is desktop-first: backup keeps your notes safe and moves them to a
new computer. It isn't live sync. Everything below is in Settings →
History and backup, and the status bar says how the last backup went
("Saved · Backed up 2 hours ago").

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

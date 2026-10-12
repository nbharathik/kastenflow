---
id: 01K5Y2WE1C0MEPAGE000000001
title: Welcome to KastenFlow
type: page
created: 2026-09-24T08:00:00Z
updated: 2026-09-24T08:00:00Z
icon: 👋
cover: gradient-dawn
---
KastenFlow keeps pages, cards, a journal, whiteboards and PDFs as plain files in
your own folder: Markdown you can open anywhere, with every change kept in its
history. Type, and let the shortcuts do the formatting.

> [!tip]
> **Ctrl+K** finds any page, text or command. **Ctrl+N** catches a quick note,
> **Ctrl+Shift+N** starts a page and **Ctrl+J** opens today's journal.

## Try these

- [ ] Type `/` on an empty line and pick a block
- [ ] Type `[[` and pick a page to link it, or `@today` for today's journal
- [ ] Shift+click a page link to open it in the side stack, beside this page
- [ ] Press Ctrl+N, jot something down, and find it in the Inbox
- [ ] Open **Whiteboards**, make one, and drag this page onto it

## Dump now, organise later

- **Inbox** holds quick notes. Paste a web address into it to keep that
  page's article. **Triage** takes notes one at a time: T tag, B board,
  M move, P page, D done, and S sends a note where its similar notes are.
- **Projects** gather pages, cards and boards. Hover a page in the sidebar for
  **+** (sub-page) and **•••** (rename, move to a project, favourite, trash).
- The right panel (**Ctrl+.**) shows a page's properties, outline, links,
  similar notes and history.
- **Card Library** lists every note, with filters and bulk tag, move and
  board. **Tag Database** turns a tag into a table, kanban or calendar.
- On an empty page, type `/` and pick **Template…**: trips, meetings,
  papers, recipes, budgets and more. Your own go in `templates/`.

## Think on whiteboards

- Double-click to make a card, drag notes in from anywhere, and connect them
  from any side, with labels and arrowheads.
- Select a card or sticky and press **Tab** to grow a mind map, and
  **Shift+Enter** for a sibling. **Layout → Mind map** tidies it.
- **Calendar** shows every dated note and to-do; drag to change dates.

## Bring what you have

- **Import** (the sidebar's bottom bar) brings in an Obsidian vault, a Notion
  export or a Heptabase backup, as one step you can undo.
- **Ctrl+O** imports a PDF. Highlight it in five colours and make any
  highlight a card that links back to the spot.

## Work with AI

- **Chat** talks to Claude or any OpenAI-compatible server, with your notes as
  context. Keys stay in your system keychain, never in this folder.
- Agents such as Claude Code connect over MCP (Settings → AI agents). Every
  change they make is a commit you can review and undo.
- **Search by meaning** (Settings) finds notes about what you ask, not just
  the words you type.

## Safe by design

- Every change is saved in history: **History** undoes any of them, and a
  page's history slider shows every version.
- The trash gives notes back, and only you can empty it.

## Keyboard shortcuts

<details>
<summary>Writing</summary>

| Shortcut | Does |
|---|---|
| Ctrl+B / Ctrl+I / Ctrl+U | Bold, italic, underline |
| Ctrl+Shift+S | Strikethrough |
| Ctrl+E | Inline code |
| Ctrl+K (with text selected) | Link |
| Ctrl+Shift+H | Last used colour |
| Shift+Enter | Line break |

</details>

<details>
<summary>Blocks</summary>

| Shortcut | Does |
|---|---|
| Ctrl+Alt+0 | Text |
| Ctrl+Alt+1 / 2 / 3 | Heading 1, 2, 3 |
| Ctrl+Alt+4 | To-do |
| Ctrl+Alt+5 / 6 | Bulleted, numbered list |
| Ctrl+Alt+7 | Toggle |
| Ctrl+Alt+8 | Code |
| Ctrl+D | Duplicate block |
| Ctrl+Shift+↑ / ↓ | Move block |
| Ctrl+Enter | Tick a to-do, fold a toggle |
| Ctrl+/ | Block menu |
| Esc | Select the block |

</details>

<details>
<summary>Typing</summary>

| Type | Get |
|---|---|
| `#`, `##`, `###` and a space | Headings |
| `-` or `1.` and a space | Lists |
| `[]` and a space | To-do |
| `>` and a space | Toggle |
| `"` and a space | Quote |
| `---` | Divider |
| ` ``` ` | Code block |
| `$x^2$` | Inline equation |
| `$$` and a space | Block equation |
| `->` `<-` `=>` | → ← ⇒ |

</details>

<details>
<summary>Moving around</summary>

| Shortcut | Does |
|---|---|
| Ctrl+K or Ctrl+P | Search pages and commands |
| Ctrl+Shift+N | New page |
| Ctrl+N | Quick note to the inbox |
| Ctrl+J | Today's journal |
| Alt+← / Alt+→ | Back, forward |
| Ctrl+\ | Sidebar |
| Ctrl+. | Right panel |
| Ctrl+Shift+\ | Focus mode |
| Ctrl+Shift+L | Dark mode |
| Ctrl+S | Save now |
| Ctrl+Shift+/ | Every shortcut |

</details>

## Blocks you can use

> [!note] Callouts
> Click the icon to change the kind. A callout is a quote with `[!note]` on
> its first line, so other Markdown tools show it too.

Text can be <span style="color: red">red</span>,
<span style="background-color: yellow">highlighted</span> or <u>underlined</u>.
Select it and use the **A** button, or press Ctrl+Shift+H.

Equations are TeX between dollar signs, like $e^{i\pi} + 1 = 0$, or on lines
of their own. A price such as $5 stays text.

$$
\sum_{k=1}^{n} k = \frac{n(n+1)}{2}
$$

> Quotes stay quotes.

---

Your pages live as `.md` files. Open the **•••** menu and choose
**Show Markdown file** to see exactly what is written to disk.

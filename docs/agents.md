# Agent modes

An AI agent can read and change your notes: the chat in KastenFlow, Claude Code,
Codex or any other client you connect (see [Connect AI agents](guide.md#connect-ai-agents)).
You decide how much it may do without asking. There are three modes, and you can
give each project its own.

- [The three modes](#the-three-modes)
- [Choose a mode](#choose-a-mode)
- [Autonomous mode, its time box and its mark](#autonomous-mode-its-time-box-and-its-mark)
- [What no mode allows](#what-no-mode-allows)
- [Checkpoints and going back](#checkpoints-and-going-back)
- [Undo this chat's changes](#undo-this-chats-changes)
- [Many changes at once: the batch tool](#many-changes-at-once-the-batch-tool)
- [What agents can do](#what-agents-can-do)

## The three modes

| | Review everything | Balanced (the default) | Autonomous |
| --- | --- | --- | --- |
| A normal change from a connected agent | Waits for you | Done at once | Done at once |
| A change from the chat panel | Shown as a preview you apply | Shown as a preview you apply, unless that chat has **Apply directly** | Applied at once |
| A big change (more than 40 % of a note's text removed, many notes in ten minutes, many trashed, many slides or board nodes removed) | Waits for you | Waits for you (you can **trust** a session for an hour to lift this) | Done at once |
| Things that always wait (a rewrite sent for review, a tag's schema, templates, a deck, whiteboard or diagram sent to the trash, saving a project as a setup) | Wait | Wait | Done at once, marked as made in autonomous mode |
| Locked notes, `.git` and `.kasten`, writes over 200 KB, permanent delete, emptying the trash | Never | Never | Never |

Waiting means the change appears in **Review** with a before-and-after. Accept it
and it is made; reject it and nothing changes.

## Choose a mode

- **Settings → AI agents → How much agents may do.** Three cards, each with a
  plain sentence: **Review everything**, **Balanced**, **Autonomous**.
- **Per project:** below the cards, a list of your projects. Each is *Same as
  everything* or a mode of its own, so you can be strict with your thesis and
  relaxed with a scratch project. A change that touches two projects (a move) is
  held to the stricter one.
- **From the keyboard:** Ctrl+K, then *Agents: Review everything*, *Agents:
  Balanced* or *Agents: Autonomous*.

The mode is read each time an agent writes, so a change applies to its very next
change. Only you can change it: agents have no tool for it and cannot edit the
settings.

## Autonomous mode, its time box and its mark

Autonomous mode lets agents get on without stopping to ask. Because it is the
most trusting, it has a time limit and it is always visible.

- Choosing the **Autonomous** card starts it for **1 hour**. Under it, *For* lets
  you pick **1 hour**, **8 hours** or **Until I turn it off**.
- When the time is up, agents are on Balanced again, and a note says so. A project
  you set to Review stays on Review.
- While any part of your vault is autonomous, a small mark with a dot is in the top
  bar, named **Autonomous agents are on**. Point at it, tab to it or click it to
  see *Where* (all your notes, or which projects) and *For* (until when), and
  press **Turn off** (one click) or **Agent settings**.
- Autonomous mode needs history to be on, because everything it does must be
  undoable. Without history it behaves as Balanced.
- Changes made in autonomous mode show an **autonomous** tag in History.

## What no mode allows

These hold in all three modes, and no agent can switch them off:

- Locked pages (lock one from its menu with **Lock for agents**) are read-only.
- Nothing is ever permanently deleted: removal means the trash, which you can
  restore from. There is no tool to empty the trash.
- Nothing can rewrite the vault's history, change `.kasten`, or write more than
  200 KB in one go.
- A pasted picture or file is limited in size and number per session.

## Checkpoints and going back

Before an autonomous session's first change, and before any batch of more than 20
changes, KastenFlow notes a **restore point**.

- **History → Agent sessions →** open a session **→ Restore to before this
  session.** (A batch says "Restore to before a batch of 12 changes".) It asks
  first, because it also goes back past anything that happened later: notes made
  since go to the trash and nothing is rewritten.
- A restore leaves your current settings alone, so it never brings back an old
  agent mode.

## Undo this chat's changes

When the chat has made changes, its header offers **Undo this chat's changes**.

- Five changes or fewer are taken back at once, with **Undo the undo** in the
  notice.
- More than five asks first ("Undo 7 changes from this chat?").
- Edits you made yourself since are kept. If one of your edits touched the same
  lines, the undo stops there and tells you.

**Apply directly** (a switch on a chat) is greyed out, with a sentence that says
why, while the vault is on Review everything (the chat always previews) or
Autonomous (the chat always applies at once). It matters only in Balanced.

## Many changes at once: the batch tool

An agent can send up to 100 changes (1 MB) in one `batch` call, such as tagging 40
notes. A batch is **all or nothing**:

- If any change is refused, the whole batch is refused and the agent is told which
  one.
- If any change needs your review, the whole batch waits as one item in Review.
- Otherwise every change is made as one step, and **one undo** takes the whole
  batch back.
- If something goes wrong half way (the disk fills), every file is put back as it
  was and nothing is left in History.

In the chat panel, a batch is shown as one preview.

## What agents can do

Besides notes, boards and decks, agents can now arrange and look after more:

- **Structure:** put a page inside another or take it out, set the order of
  sub-pages, start a project (empty or from a setup), save a project as a setup,
  set a project's status and health, and set a tag database's views and row order.
- **Pages:** read a page as blocks and change it by block (insert, move, replace,
  put blocks in columns, tick a task, edit table cells) without touching the rest.
  Blocks you did not name keep every byte.
- **Housekeeping:** duplicate and restore notes, add and resolve comments, tick
  to-dos, list tasks, manage saved searches and references, set a page's icon,
  cover, font and width, fill a page from a template.
- **LaTeX:** write a whole paper: start a document, write and add to its files, add
  pictures and figures from diagrams, cite your References, send a page to it, ask the
  app to build it and keep the PDF ([LaTeX documents](latex.md#agents-and-latex)).
- **Smart pages**, once you have turned them on: make and fix
  [smart pages](smart-pages.md). Until then an agent can only ask you to turn them on,
  and the request waits for you in every mode. When you hold agents to Review everything,
  a smart page an agent made waits for your **Allow to run** before it runs.
- **What you have selected,** when it asks and the app is open
  ([MCP tools](mcp-tools.md#what-an-ai-can-read-of-your-selection)).
- **Whiteboards:** besides cards and arrows, reword stickies, add links, sections and
  shapes, take arrows off and fold sections. Taking many cards or arrows off at once
  waits for your review.
- **Routines:** see what agents did, session by session (Home → *Agents today* and
  History → *Today by agents*), and undo a whole session.

The complete list, with one line for each tool, is in [MCP tools](mcp-tools.md).

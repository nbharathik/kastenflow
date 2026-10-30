# The chat panel

The chat panel is where you talk to the AI model you connected (see [AI in
KastenFlow](guide.md#ai-in-kastenflow)). It knows the page, deck, whiteboard,
diagram or LaTeX document you have open. This page covers how it picks up your
selected text, how chats are kept, what happens when you switch pages, how many
can work at once, and where links in its answers open.

- [Ask about the text you selected](#ask-about-the-text-you-selected)
- [Your chats and the archive](#your-chats-and-the-archive)
- [When you switch pages](#when-you-switch-pages)
- [Several chats at once](#several-chats-at-once)
- [Links from the assistant](#links-from-the-assistant)
- [Settings → AI → Chat panel](#settings--ai--chat-panel)

## Ask about the text you selected

Select some words in a page, a PDF, a slide's text box or a LaTeX document. About
a quarter of a second later a chip appears above the message box: *Selection ·
“the first words…” · Page title*. Ask your question and it is sent with those
words, so "tighten this" means what you selected. Sending drops the chip.

- The chip stays after you click elsewhere, so you can ask more than one thing
  about the same words.
- A new selection replaces the automatic chip.
- To keep a selection while you select something else, choose **Add to chat**: it
  is on the selection toolbar, on the right-click menu of selected text, in the
  command palette and on **Ctrl+Alt+L** (Cmd+Alt+L on a Mac). A chat holds up to
  five kept snippets; it tells you when it is full.
- Each chip has a button to remove it.

If you would rather decide yourself, Settings → AI → Chat panel → *Selected text*
can be *Add automatically* (the default), *Only with “Add to chat”* or *Never*.

## Your chats and the archive

Chats are saved on your computer, one for each thing you worked on, and are not
part of your vault or its backup.

- **New chat** starts a fresh one and keeps the old one. In a deck's assistant tab
  too: the old chat is not lost.
- **Archive chat** (the list's menu, or the button in the chat header) takes a
  chat out of the main list without deleting it. Nothing is ever archived or
  deleted for you by a timer: when the list grows past its size (30 chats by
  default) the oldest ones are *marked archived*, which keeps them saved,
  searchable and reopenable.
- **Archived** is a fold at the end of the chat list. It shows how many there
  are, has its own search, and a click reopens a chat. **Move back to the list**
  returns one.
- **Delete archived chats…** is the only way a chat goes away. It names how many,
  asks once, and deletes only archived chats. A chat that is working, or that has
  changes waiting for you, is skipped and the notice says so.
- If a chat cannot be reopened you see "Couldn’t reopen this chat" with **Retry**
  and **Start a new one**. You never get an empty chat in its place.

## When you switch pages

Settings → AI → Chat panel → *When I switch pages* chooses what the panel does when
you go to another page, deck or board:

- **Keep this chat and follow the page** (the default): the same chat goes on, and
  its page chip changes to the page you are on.
- **Use that page’s chat:** each page keeps its own chat. Going to a page opens the
  chat tied to it; if it has none, the first message you send there ties a new one.
- **Start a new chat** every time you switch.

A chat can also be tied by hand. The chip under the chat's name says *Tied to
Plan*; its menu has **Bind to this page** and **Unbind**. A tie follows the page
when you rename or move it. Decks and their assistant tabs work the same way, and
a deck's chat is tied to the deck.

## Several chats at once

Chats keep working while you are somewhere else. Settings → AI → Chat panel →
*Agents working at once* (3 by default, from 1 to 8) says how many may run at the
same time. A chat that has to wait says "Waiting for another chat to finish", with
how many are in line, and the list marks it *Waiting*. **Stop** takes it out of the
line. A busy chat shows a dot where you can see it, and the **Running chats**
button lists them so you can jump to one.

## Links from the assistant

When the assistant in a deck's assistant tab gives you a link to a page, a slide
or a note, Settings → AI → Chat panel → *Links from the assistant open* chooses
where it opens: **Beside the deck** (the default, in the pane to its right), **In a
new tab**, or **In the deck’s tab**. Holding Ctrl, Shift or Alt on a link still
picks a tab, a stack or a split as everywhere else.

## Settings → AI → Chat panel

| Setting | Choices | Default |
| --- | --- | --- |
| Selected text | Add automatically, Only with “Add to chat”, Never | Add automatically |
| When I switch pages | Keep this chat and follow the page, Use that page’s chat, Start a new chat | Keep |
| Links from the assistant open | Beside the deck, In a new tab, In the deck’s tab | Beside the deck |
| Chats in the list | 10 to 200 | 30 |
| Agents working at once | 1 to 8 | 3 |

A number outside its range is refused with a sentence, and the old value stays.
The arrow beside a setting puts it back to its usual value.

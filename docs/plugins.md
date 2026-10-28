# Plugins

Plugins are extra tools you can switch on or off. KastenFlow ships four official
ones:

| Plugin | What it adds | Starts | Applies to |
| --- | --- | --- | --- |
| **draw.io** (Diagrams) | Flowcharts, architecture drawings and sketches in an editor of their own | On | This vault |
| **LaTeX** | LaTeX documents with a PDF preview that updates as you type | Off | This vault |
| **Smart pages** | Pages with a small app of their own, such as a tracker or a dashboard, that read your notes ([Smart pages](smart-pages.md)); a project can turn them on or off for its own pages | Off | This vault |
| **Browser** | A browser tab inside KastenFlow, web previews and saving pages | Off | This computer |

Open **Settings → Plugins** (or press Ctrl+K and type "Plugins"). Each plugin has
a card with a switch, a line about what it does and a status.

## Turn a plugin on or off

- Flip the switch on its card. That is one click.
- Or use the command palette: **Turn on LaTeX**, **Turn off LaTeX**, and the same
  for the others. **Plugins: open settings** goes to the page.

Some plugins need a program that is not part of KastenFlow (draw.io's editor, the
LaTeX program Tectonic). Turning one on downloads it from its official GitHub
release once, checks its size and checksum, and keeps it in KastenFlow's own data
folder, never in your vault. The card shows the progress ("Downloading 43 %", "21
MB of 48 MB") with **Cancel**. A download that fails says why and offers **Retry**.
**Remove download** deletes only KastenFlow's own copy of the program.

A card's status is one of: *Off*, *On*, *Downloading*, *Checking the download*,
*Installing*, *Needs download* (with a **Download** button) or *Failed*.

The card also says where the switch applies. A vault plugin is stored in the
vault's settings, so it is on or off for that vault only. The Browser plugin is a
setting of this computer.

## Turning a plugin off never hides your files

Your files are plain files in the vault. Switching a plugin off removes its
buttons, menu items and commands and nothing else:

- A `.drawio` file is still listed in the sidebar and still opens, to a short
  page that says "Turn on the draw.io plugin to open this" with a **Turn on
  draw.io** button. A diagram embedded in a page still shows its picture, without
  the Edit button.
- LaTeX documents are still ordinary files in their folder. Their text is not
  deleted or hidden.
- Agents (for example Claude Code over MCP) stop being offered the tools of a
  plugin that is off, and are offered them again when it is on. Agents never switch
  a plugin themselves. For smart pages they can ask you to, and the request waits in
  your list of changes to review, in every mode, until you accept it.
- A few tools need two plugins together: turning a diagram into a LaTeX figure needs
  both draw.io and LaTeX, and says which one to turn on if one is off.
- Smart pages can also be turned on or off for one project: in the project's ••• menu,
  **Smart pages** is *Use the vault's choice*, *On in this project* or *Off in this
  project*.

If you try something that needs a plugin that is off (say, editing a diagram), you
get one line, "Turn on the draw.io plugin to edit this diagram", with a **Turn on**
button.

## draw.io

See [Diagrams](guide.md#diagrams) in the user guide. The editor is draw.io
(diagrams.net) by JGraph Ltd; see [Third-party software](third-party.md).

## LaTeX

See [LaTeX documents](latex.md). Agents can write a whole paper with the LaTeX tools
([MCP tools](mcp-tools.md#latex)).

## Smart pages

See [Smart pages](smart-pages.md). They are off until you turn them on here, for the
vault or for one project.

## Browser

The Browser plugin turns on the browser tab, the web previews in pages and slides,
and saving a page as a paper or a capture. It belongs to this computer, so turning
it on does not change another computer's setting. The same switch is in Settings →
Browser. See [The browser tab](guide.md#the-browser-tab).

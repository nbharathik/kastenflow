# Send to KastenFlow: the browser extension

Sends the page you are on, a selection, a link or a picture from Chrome or Edge to
KastenFlow, the notes app on your computer. A capture becomes a card tagged `capture` (the
**Captures** table lists them), in your inbox or a project, or a quote added to a page.

It talks to KastenFlow and nothing else: every request goes to `http://127.0.0.1` (this
computer), on port 7434 unless you change it in KastenFlow's Settings. It can **add**
captures and list where they can go. It cannot read a note, change one or delete one.
KastenFlow has to be running, with **Settings → Browser extension** turned on.

## Put it in Chrome or Edge

The folder already holds the compiled code (`dist/`). To rebuild it after changing the
source, from the repository folder:

```sh
pnpm -C app exec tsc -p ../browser-extension/tsconfig.json
```

Then:

1. Open `chrome://extensions` (in Edge, `edge://extensions`).
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and pick this folder (the one with `manifest.json`).
4. Pin the extension from the puzzle-piece menu, so its button is always there.

There is no store listing yet, so a browser restart keeps the extension, and the
browser may ask now and then whether to keep an unpacked extension. After you rebuild,
press the extension's reload button on that page.

## Pair it with KastenFlow, once

1. In KastenFlow, open **Settings → Browser extension** and turn the extension on.
2. Press **Pair**: a code of eight letters and digits appears. It works once, for two
   minutes and five tries.
3. Click the extension's button, and type the code. (Under **Advanced** you can set a
   different port, if you changed it in KastenFlow.)

KastenFlow gives the extension a token, which the browser keeps for this extension only.
KastenFlow keeps only a hash of it. To cut the extension off, **Revoke** it in KastenFlow's
Settings; to forget it on this side, press **Unpair this browser** in the popup.

## Send things

- **The toolbar button** opens a popup. Pick what to send (the selection, the page, or
  only its link), where it goes (Captures, a project, or a quote in a page), add tags,
  and press **Send to KastenFlow**.
- **Right-click** a page, a selection, a link or a picture, and choose **Send ... to
  KastenFlow**. It goes to where the last send from the popup went, and the toolbar button
  shows a tick, or a mark when something went wrong (the popup then says what).

Each capture is one change in KastenFlow's history, and **Undo** takes it back.

## What it may do, and why

| Permission | Why |
| --- | --- |
| `activeTab` | Read the page you are on when you press the button or use the menu, and no other. |
| `scripting` | Run the small reader (`src/page.ts`) in that page: its selection, and the page without scripts and styles. |
| `contextMenus` | The right-click entries. |
| `storage` | Keep the token KastenFlow gave, the port and where the last capture went. |
| `http://127.0.0.1/*` | Reach KastenFlow on this computer. No other address is ever contacted. |

KastenFlow only answers a request that has the exact host `127.0.0.1:<port>`, an extension's
`Origin` and a token that was paired from that same extension. It sends no CORS headers
and refuses preflight requests, so no web page can talk to it.

## If it cannot reach KastenFlow

- **"KastenFlow did not answer"**: KastenFlow is closed, the switch in Settings → Browser
  extension is off, or the port there is not the one in the popup's Advanced field.
- **"not paired, or its pairing was revoked"**: pair again, as above.
- **The popup says "Failed to fetch" style trouble even with KastenFlow open**: check that
  the extension was loaded from this folder, and that its host permission shows
  `127.0.0.1` on its details page.
- Pages the browser keeps to itself (`chrome://`, `edge://`, the web store) cannot be
  read by any extension: only their link can be sent, and only if it is a web address.

## The code

Plain TypeScript, no packages, compiled by `tsc` into `dist/`. `src/client.ts` is the
three requests; `src/capture.ts` shapes a capture under KastenFlow's 2 MB limit;
`src/background.ts` and `src/popup*.ts` are the right-click menu and the popup. Only
`src/browser.ts` and the two `*-main.ts` entries touch the browser's own `chrome`
object, so the rest runs under test with a stand-in for it.

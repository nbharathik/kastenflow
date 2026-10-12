# slides-render

KastenFlow Slides drawn by a headless Chrome, Chromium or Edge: one slide or a grid
of slides as PNG, the deck as PDF or as the offline HTML export, and the size
the words of every element come out at, which lint needs to tell whether text
fits its box. It is what `slides render`, `slides export -o talk.pdf|.png|.html`,
`slides lint` and the agent tools `render_slide` / `render_grid` use.

```rust
use slides_render::{Options, Renderer};

let renderer = Renderer::launch()?;                       // finds Chrome, starts it, loads the page
let png = renderer.render_slide(&deck, 0, None, 2.0)?;    // slide 1, its last step, 2 pixels to the unit
let grid = renderer.render_grid(&deck, None)?;            // every slide, labelled
let measures = renderer.measure(&deck)?;                  // slides_core::lint::Measures
let pdf = renderer.pdf(&deck, &Default::default())?;
```

A program that draws now and then (an MCP server) uses `slides_render::draw(&deck,
assets_folder, Draw::Slide { .. })`, where the folder gives the deck's pictures and its
`.bib` files: one shared browser, started on first use, kept for the next call, let go
after five idle minutes, and `slides_render::shutdown()` before the program ends.

## How it works

* The browser is found as `$CHROMIUM_PATH`, `$CHROME`, then `chromium`,
  `chromium-browser`, `google-chrome`, `google-chrome-stable`, `microsoft-edge`
  on `PATH`, then Playwright's downloads, then each system's install folders.
  With none, every call says so (`Error::NoBrowser`) and nothing else in KastenFlow
  Slides is affected.
* It draws with **the render page** (`packages/slides-render-page`): the editor's
  own renderer, engine, fonts and print layout, as a static page. The page is
  built into the program (`build.rs` embeds `packages/slides-render-page/dist`).
* The browser is never on a network. The page lives at
  `http://slides-render.localhost/`, and every request it makes is caught by the
  DevTools protocol and answered from memory: the page's files, the deck's
  pictures (read from the folder given as `Media`), or a refusal. A deck that
  names a web address gets a warning and a hole.
* The browser's profile is one of sixteen folders kept and lent out (guarded by
  file locks); nothing is ever deleted, and two hosts at once use two folders.
  See [Folders it makes](#folders-it-makes) for where they are and how they are
  protected.
* A citation is written out from the deck's `.bib` files, not drawn as its key:
  see [Citations](#citations).

## Safety: what the browser can reach

A deck can come from an agent or from a file someone sent, and the browser decodes
the pictures it names. So its sandbox is on, and stays on unless you say otherwise.

* **`SLIDES_RENDER_NO_SANDBOX=1` runs the browser without its sandbox.** Only the
  exact value `1` does. A program that uses this crate can say the same with
  `Options { no_sandbox: Some(true) }`; that wins over the variable, and `Some(false)`
  keeps the sandbox on even where the variable is set. A program that runs a browser
  without its sandbox prints one line on stderr, once, whatever the number of browsers
  it starts: `warning: SLIDES_RENDER_NO_SANDBOX is set, so the browser that draws slides
  runs without its sandbox ...`. Use it where the container or the machine is itself
  the boundary you trust (a throw-away container, a CI job), not on a computer that
  holds things a hostile picture should not reach.
* **It is never switched off for you.** Chromium cannot run its sandbox as the
  administrator (root). Started as root without the variable, nothing is launched and
  the error says why and names the variable. If the sandbox cannot start for another
  reason (a container without user namespaces, a locked-down kernel), the browser's own
  complaint is passed on with the same advice. A browser that fails to start is not
  started again without its sandbox.
* **Tests that run as root** (a container is the usual case) set the variable, or
  `no_sandbox`, for the browsers they start. The tests of this crate and of
  `slides-cli` do, when they run as root and only then.

### Folders it makes

The browser's profile folders, and the work folders of `slides import --previews`, are
kept for this user alone:

* They are a pool of sixteen folders, each with a lock file, under the person's cache
  folder (`$XDG_CACHE_HOME` or `~/.cache`, `~/Library/Caches`, `%LOCALAPPDATA%`) in
  `kasten-slides/render` (`kasten-slides/previews` for the previews), or under
  `$SLIDES_RENDER_PROFILES` (`$SLIDES_WORKPLACES`) when that names another place.
  Only if none of those can be used is the system's temporary folder tried.
* Before a folder is used it must be a real folder (not a link), owned by the user the
  program runs as, and closed to everyone else (mode `0700`). A folder that is not is
  passed over and the next is tried; if none can be used the error names the first
  reason, for example `... can be entered by other users (mode 755); close it to them
  with chmod 700 ...`. A folder that is missing is made with mode `0700`. When a whole
  place is passed over and the run uses another (the temporary folder, say), one
  `note:` line on stderr says why and where the run went instead, because a folder that
  is refused is left as it is and each such run leaves a profile behind.
* In the temporary folder, which every user can write in, nothing has a name that can be
  guessed and planted at: the pool is `kasten-slides-render-<user>-<24 random hex
  digits>`, one per run, made with mode `0700` when it is not there and used only if it
  passes the checks above like any other. These folders stay behind in the temporary
  folder, which is where such things are cleared; nothing here deletes them.
* Files written there are made new (`O_EXCL`, mode `0600`), or overwritten only when
  they are a plain file of this user. Nothing is written through a link.
* The owner and mode checks are for Unix. Where there are no users and modes
  (Windows) the per-user cache folder is private already and those checks pass.

### The debugging port (a limit)

chromiumoxide starts the browser with `--remote-debugging-port=0` and drives it over a
WebSocket on `127.0.0.1`, on a port the system picks and the browser prints. That port
has no password. Anyone who can connect to the loopback interface of the machine while
a render runs can look the port up, ask `http://127.0.0.1:<port>/json/version` for the
address to attach to, and then drive the browser with the permissions of the user who
started it, reading the files that user can read, for example.

Chromium can be driven over a pipe instead (`--remote-debugging-pipe`), which no one
else can reach. chromiumoxide 0.9 has no such transport (it only speaks WebSocket and
adds the port flag itself), and a fork of it is not worth carrying. So:

* On a computer of your own, or in a container of your own, the port is reachable only
  by you and by programs that already run as you. Nothing more is needed.
* On a machine shared with people you do not trust (a multi-user server, a shared CI
  host), run the commands that draw (`slides render`, `slides export -o x.pdf|png|html`,
  `slides lint` when it measures, `slides mcp`) in your own container, virtual machine
  or user and network namespace, so that no one else shares the loopback interface with
  the browser.

The window is the life of the browser: a few seconds for a command; up to the idle
time (five minutes) after the last picture for the shared host of `slides mcp`.

## Citations

A citation names works in a bibliography (`.bib` files). The page writes them out
("Vaswani et al., 2017 (NeurIPS)") when it is given the BibTeX text, and draws the keys
when it is not.

* `Options { references: Some(text), .. }` at launch, or `renderer.set_references(Some(text))`
  later. `None` draws keys; an empty text is a bibliography with nothing in it, and every
  key is marked `?`.
* `slides_render::draw(&deck, folder, ..)` and `slides_render::measure(&deck, folder)`
  read the `.bib` files of the folder (`references::in_folder`) and give the shared host
  that text, or none when there are none, so one folder's bibliography never stays on for
  another folder's deck. It is the same rule as `slides lint`: up to eight files of 4 MB,
  in the order of their names.
* `slides render`, the drawn exports and the measuring that `slides lint` does pass the
  `.bib` files beside the deck.
* The words of a written citation are longer than a key, so `measure` is given the
  bibliography too: lint measures a citation as long as it will be drawn.

## Dependencies

`chromiumoxide` (no default features), `tokio` (one current-thread runtime, on the
thread that drives the browser) and `futures` with only its `std` feature, which is there
for `StreamExt` alone: chromiumoxide's browser handler and event streams are `Stream`s and
it does not re-export the trait. It is a deliberate, approved direct dependency; it was
already in the lock through chromiumoxide, so it adds no package. Eleven packages come
with chromiumoxide, all MIT or Apache-2.0.

## Settings

| Setting | What it does |
| --- | --- |
| `CHROMIUM_PATH`, `CHROME` | the browser's program |
| `SLIDES_RENDER_NO_SANDBOX=1` | run the browser without its sandbox (see above) |
| `SLIDES_RENDER_PROFILES` | where to keep the browser's profile folders |
| `SLIDES_WORKPLACES` | where to keep the work folders of `slides import --previews` |
| `SLIDES_RENDER_PAGE` | a folder to take the render page from, not the embedded one |

## Building, and CI

The page has to be built before the program that embeds it:

    node scripts/build-render-page.mjs     # or: just render-page
    cargo build -p slides-cli

Without a built page everything still compiles (with a warning), `Renderer::launch`
fails with `Error::NoPage` saying how to build it, and the tests that need a browser
print `SKIPPED: <reason>` and pass. The same happens on a machine with no Chrome
or Chromium. So a fresh checkout is green with `cargo test -p slides-render`; CI that
should also draw builds the page first (`just check` does). A job that runs the browser
tests as root, or on a kernel that cannot start the browser's sandbox, sets
`SLIDES_RENDER_NO_SANDBOX=1` for that job on purpose; the tests of this crate do it
themselves only when they run as root.

`SLIDES_RENDER_PAGE=<folder>` makes a program use a page from a folder instead of
the embedded one (a page under development); a `render-page` folder beside the program
is used when nothing is embedded.

The page is about 9 MB (the engine's WebAssembly 5 MB, fonts 2.6 MB, scripts 1 MB), and
that is what it adds to the program.

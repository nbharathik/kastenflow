# Contributing to KastenFlow

Thank you for helping. KastenFlow keeps people's notes, so changes are held to
one rule above the others: preserve what a person wrote and make recovery possible.

## Set up

You need:

- Rust, at the version in `rust-toolchain.toml`; rustup installs it for you.
- Node matching the root `package.json` engines (for example Node 24),
  and the exact pnpm version in its `packageManager` field.
- On Windows, Microsoft C++ Build Tools with the desktop C++ workload and
  the WebView2 runtime.
- On macOS, Xcode or the Xcode Command Line Tools for desktop builds.
- On Linux, the libraries Tauri builds against:

  ```sh
  sudo apt-get install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
    librsvg2-dev libxdo-dev libssl-dev patchelf build-essential pkg-config
  ```

See [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for
platform setup details.

Then (a POSIX shell):

```sh
pnpm install --frozen-lockfile
KASTEN_VAULT=./fixtures/dev-vault pnpm -C app tauri dev
```

In PowerShell, set the variable separately:

```powershell
$env:KASTEN_VAULT = (Resolve-Path ./fixtures/dev-vault).Path
pnpm -C app tauri dev
```

The app opens the sample vault in `fixtures/dev-vault`. Whatever you change
there changes the fixture, so look at `git status` before you commit, and
never point a development build at a vault you care about. `pnpm -C app dev`
runs the browser preview instead, which keeps its notes in the browser.

## Checks

Run these before opening a pull request:

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
pnpm lint
pnpm typecheck
pnpm test
node scripts/check-boundaries.mjs
node scripts/gen-slides.mjs --check
node scripts/build-render-page.mjs
node --test "scripts/*.test.mjs"
```

If you use [just](https://github.com/casey/just), `just check` runs all of
that. `pnpm test` covers the app and the Slides packages together; the
Slides packages run slides-core as WebAssembly, and their scripts build it
on demand, which needs the `wasm32-unknown-unknown` Rust target (rustup adds
it from `rust-toolchain.toml`) and the `wasm-bindgen` command. `just wasm`
installs the command at the version `Cargo.lock` pins.

For changes to kasten-core's speed, also run `cargo bench -p kasten-core`.
To check that the fixture vault still reads cleanly after a change to the
format or to an op:

```sh
cargo run -p kasten-cli -- verify --vault fixtures/dev-vault
```

Scripts in `scripts/` carry their own tests; run them with
`node --test "scripts/*.test.mjs"`.

## The website

`site/` holds the website: `index.html` built from `partials/`, with its
styles, scripts and pictures. Build it into `_site/`, then open it with any
static file server:

```sh
node scripts/build-site.mjs <owner>/<repository> --no-demo
```

Leave out `--no-demo` to build the browser demo into `_site/demo/` too.

The product pictures on the website and in this README come from the
browser preview. `scripts/product-shots.mjs` takes them in light and dark
and says at its top how to build the preview and turn them into WebP;
`scripts/screenshots.mjs` takes a before and after of every view when you
change how something looks.

## How the code is laid out

| Folder | What it holds |
| --- | --- |
| `crates/kasten-core` | The engine: the vault, its index, git history, and every op that changes a note |
| `crates/kasten-cli` | The `kastenflow` command; `kasten` still works as an alias |
| `crates/kasten-mcp` | The MCP server that lets AI agents work in a vault, within guardrails |
| `crates/slides-core`, `crates/slides-cli` | KastenFlow Slides' engine and its `slides` command; Apache-2.0 |
| `crates/slides-pptx`, `crates/slides-render`, `crates/slides-assets` | PowerPoint files in and out; slides drawn by a headless Chrome or Chromium; picture sidecars, sizes and thumbnails shared with KastenFlow; Apache-2.0 |
| `packages` | KastenFlow Slides in TypeScript and WebAssembly: the canvas, the editor and the WebAssembly build; Apache-2.0, and they never import KastenFlow |
| `app/src-tauri` | The desktop app's Rust side: Tauri commands over kasten-core |
| `app/src` | The window: React, by feature folder |
| `site` | The website, built with the demo by `scripts/build-site.mjs` |
| `fixtures` | Sample vaults and import folders; tests use nothing else |

[`docs/vault-format.md`](docs/vault-format.md) describes the files KastenFlow
writes.

## Rules

- Every change to vault files goes through a kasten-core op. The window,
  the CLI and the MCP server never write vault files themselves.
- Nothing permanently deletes what a person wrote, and history is only
  added to: no amend, rebase, reset or force push, in the code or in a
  vault.
- Write the test first for anything in kasten-core, and show it fails
  without the change.
- Keep unknown frontmatter and Markdown byte for byte.
- Keep each source file under about 400 lines, split by feature.
- Test only against `fixtures/`.
- Explain a choice someone would otherwise have to rediscover in a comment
  where it applies.
- Open an issue before adding a dependency, and say why the ones already
  in the tree will not do.
- Write commit messages in the conventional style, such as
  `fix(core): keep the trash when a restore fails`, and keep commits small.

## Pull requests

Say what changed and why, and how you tested it. Pushes to `main` and pull
requests run one Linux job: Rust formatting, package boundaries, ESLint and
script tests. The CI workflow can also run these checks by hand.

Pushing a `v*` release tag runs the full Rust and frontend checks on Linux,
macOS and Windows before building installers. Signing and draft release
creation follow the successful builds. The same tag deploys the website and
browser demo independently of the installer release. A `site-v*` tag (for
example `site-v1.0.0-1`) deploys only the website and demo. The Website workflow
can also be started manually; ordinary branch pushes do not deploy it.

Source builds have no release repository configured. Before distributing
installers, set `package.repository` in `app/src-tauri/Cargo.toml` to the public
GitHub repository and `bundle.homepage` in `app/src-tauri/tauri.conf.json` to its
homepage. Configure the updater signing key and publish signed update manifests
separately. Without a release repository, update checks stop locally with an
explanation instead of contacting a default repository.

## Security

Please report security problems privately, through the repository's
**Security** tab ("Report a vulnerability"), not in an issue.

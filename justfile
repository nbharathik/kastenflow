# Kasten's everyday tasks. `just` lists them; `just check` is what to run
# before a commit. Anything CI runs is a script or a package script, so CI
# does not need just.

set shell := ["bash", "-euo", "pipefail", "-c"]
# On Windows, plain `bash` can be the WSL one, which has no cargo or node: use Git Bash.
set windows-shell := ["C:/Program Files/Git/bin/bash.exe", "-euo", "pipefail", "-c"]

default:
    @just --list

# Everything to run before a commit
check: fmt clippy boundaries gen-check lint typecheck render-page test scripts

# Rust formatting, as CI checks it
fmt:
    cargo fmt --all -- --check

# Rust lints, as CI runs them
clippy:
    cargo clippy --workspace --all-targets --locked -- -D warnings

# The Slides packages import nothing from Kasten
boundaries:
    node scripts/check-boundaries.mjs

# ESLint over the application and Slides packages
lint:
    pnpm lint

# Type-check the app and the Slides packages
typecheck:
    pnpm typecheck

# All Rust and TypeScript tests
test:
    cargo test --workspace --locked
    pnpm test

# The tests of the scripts folder
scripts:
    node --test "scripts/*.test.mjs"

# Regenerate the Slides TypeScript types and schemas from the Rust model
gen:
    node scripts/gen-slides.mjs

# Fail when the generated Slides types are stale
gen-check:
    node scripts/gen-slides.mjs --check

# Build the WebAssembly package (installs wasm-bindgen if it is missing)
wasm:
    node scripts/build-wasm.mjs --install

# The page `slides render` draws decks with; the program embeds it, so build it before the program
render-page:
    node scripts/build-render-page.mjs

# Release, in three steps (dev/releasing.md): `just release-ci`, wait for green, `just release-check`, `just release-tag`
release-ci:
    node scripts/release.mjs ci

# What is ready and what is not for tagging this commit
release-check:
    node scripts/release.mjs check

# Tag this commit and push the tag, which starts the Release workflow
release-tag:
    node scripts/release.mjs tag --yes

# Performance budgets
bench:
    cargo bench -p kasten-core

# The first-page size budget; build first: pnpm -C app exec vite build
bundle:
    node scripts/check-bundle.mjs app/dist

# The desktop app on the dev vault
dev:
    pnpm -C app tauri dev

# The Slides editor on a folder of decks (default: the sample decks), in the browser
slides folder="fixtures/decks":
    #!/usr/bin/env bash
    set -euo pipefail
    cargo build -p slides-cli
    ./target/debug/slides dev "{{folder}}" --port 5175 &
    server=$!
    trap 'kill $server' EXIT
    SLIDES_API=http://127.0.0.1:5175 pnpm --filter @kasten-slides/dev dev

# The Slides acceptance run: the editor, its speed and the Slides view of the app preview, in a real browser
e2e *args:
    node scripts/slides-e2e.mjs {{args}}

# @kasten-slides/wasm

slides-core compiled to WebAssembly with wasm-bindgen. The KastenFlow Slides
editor applies every operation through it, so an edit shows at once and the
same code checks it on the command line and for agents.

```sh
node scripts/build-wasm.mjs        # from the repository root; writes pkg/
```

Building needs the `wasm32-unknown-unknown` Rust target and the
`wasm-bindgen` command at the version `Cargo.lock` pins; the script says how
to install it when it is missing (`--install` does it).

`pkg/` is not in git, so it goes out of date whenever the Rust behind it
changes, for example after a pull. Starting the dev server of the app or of
`slides-dev`, `pnpm build` and `pnpm typecheck` in the app check it first and
rebuild it if it is out of date: a build records a fingerprint of the Rust it
was made from, and it is also out of date when the editor's code imports a
name it does not export. `node scripts/build-wasm.mjs --if-stale` is that check
by hand. Set `KASTEN_SKIP_WASM_CHECK=1` to start a dev server without it.

Licensed under the Apache License, Version 2.0.

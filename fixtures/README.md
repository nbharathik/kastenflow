# Fixtures

Everything tests read lives here. Tests never touch a real vault.

- `dev-vault/`: the test vault, a small vault in KastenFlow's format with sample
  pages, boards and PDFs (`scripts/sample-pdf.mjs` writes a text primer with
  highlights, `scripts/figures-pdf.mjs` a two-page paper with three figures to
  clip, its bibliography entry included: run one again and it writes the same
  bytes). `pnpm -C app tauri:test` opens a fresh copy of it
  (scripts/test-launch.mjs), so test launches never edit it, and the browser
  preview loads it with `?samples=dev`. A new real vault starts blank.
- `preview-vault/`: what the browser preview adds to a new vault's templates,
  tags and Welcome page: one example project.
- `roundtrip/`: tricky Markdown that must survive open-and-save byte for byte,
  both in the Rust core and through the page editor. Each file targets
  one kind of trouble: alternative list markers and emphasis styles, setext
  headings, CRLF and mixed line endings, a byte order mark, trailing whitespace,
  a missing final newline, HTML comments, footnotes, reference links and
  KastenFlow's own syntax (wiki-links, embeds, callouts, toggles, math).
- `decks/`: small KastenFlow Slides decks, one for each kind of trouble: a
  minimal deck, shapes and connectors, a text-heavy deck, four slides of
  three elements, and a deck with unknown fields that must survive a read
  and write. The tests of the Slides packages open them and re-save them
  unchanged; `cargo test -p slides-core write_fixtures -- --ignored` writes
  them again when the format changes on purpose.

Git never converts line endings under this folder (`.gitattributes`:
`fixtures/** -text`), so the bytes on disk are the bytes under test. Add a new
file whenever a real note fails to round-trip; never edit an existing fixture to
make a test pass.

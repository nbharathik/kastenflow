// The round-trip test's sample (editor/roundtrip.test.ts): a whole note file,
// frontmatter included, showing the editor's blocks stored as Markdown. It uses a
// few spellings the editor would normalise (a setext heading, `*` bullets,
// `__strong__`) to show that untouched blocks are saved byte for byte.

export const SAMPLE_PAGE = `---
id: 01J8Z3K6Q2M4X7V9B1C5D8E0F2
title: Welcome to Kasten
type: page
icon: 👋
cover: gradient-dawn
tags: [kasten, getting-started]
---
Every Kasten page is a plain Markdown file you own. Type \`/\` for blocks, drag the ⋮⋮ handle to move them, and select text to
colour it.

> [!tip]
> Open the **Markdown** panel to see exactly what Kasten writes to disk.

Getting around
==============

* Links to notes: [[Photo organiser roadmap]] and [[Duplicate score for photos|an alias]]
* An embed: ![[Duplicate score sketch]]
* Inline math $E = mc^2$ and a __strong__ word

## To-dos

- [ ] Edit this task and watch only its block change in the Markdown panel
- [x] Opening and saving changes nothing

## Rich blocks, kept as Markdown

<details>
<summary>Toggles fold content away</summary>

They are HTML \`details\` blocks, so GitHub and Obsidian show them too.

</details>

> [!warning] Callouts have kinds
> Click the icon to switch between note, tip, warning and more.

Text can be <span style="color: red">red</span>, <span style="background-color: yellow">highlighted</span> or <span style="color: blue">**blue and bold**</span>.

> Quotes stay quotes.

---

| Module | Status |
|--------|:------:|
| Pages  | Ready |
| Boards | Ready |

\`\`\`rust
fn main() {
    println!("hello, Kasten");
}
\`\`\`
`;

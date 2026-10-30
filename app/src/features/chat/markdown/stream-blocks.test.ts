// Reading an answer in pieces as it streams gives what reading it whole gives,
// whichever letter a frame ends on.

import { describe, expect, it } from "vitest";

import { parseBlocks, parseWork } from "./blocks";
import { blocksOfParsed, parseMore, type Parsed } from "./stream-blocks";

const SAMPLES: Record<string, string> = {
  paragraphs: "First paragraph\nstill the first.\n\nSecond one.\n\n\nThird.",
  heading: "Intro line\n# Title\nafter the title\n## Smaller ##\n\ntext",
  fenced: "Before\n\n```ts\nconst a = 1;\n\n\nconst b = 2;\n```\n\nAfter the code\n\n~~~\nraw\n~~~~\n",
  unclosedFence: "```js\nlet x = 1;\n\n- not a list\n# not a heading",
  list: "- one\n- two\n\n- three after a gap\n  continued\n\n  second paragraph of three\n- four\n\nDone.",
  ordered: "1. first\n2. second\n   - nested a\n   - nested b\n3. third\n\n1984. Orwell\nin\n1984. Orwell",
  tasks: "- [ ] open\n- [x] done\n- [X] done too\n\ntext after",
  nestedFence: "- item\n\n  ```sh\n  ls\n\n  pwd\n  ```\n\n- next",
  quote: "> a quote\n> continues\nlazy line\n\n> second\n>\n> after blank\n# heading ends it",
  table: "Name | Age\n--- | ---\nAnn | 3\nBo | 4\n\nafter",
  tableLate: "Some words\nA | B\n---|---\n1 | 2\n3 | 4",
  tableAligned: "| L | C | R |\n|:--|:-:|--:|\n| a | b | c |\n| d \\| e | f | g |",
  rules: "text\n---\nmore\n***\n\n- - -\n\nend",
  mixed: "# Heading\n\nA **bold** [[Page]] and `code`.\n\n- a\n- b\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n> quote\n\n```\ncode\n```\n\nlast line",
  crlf: "one\r\ntwo\r\n\r\n- a\r\n- b\r\n\r\n```\r\ncode\r\n```\r\n",
  tabs: "\t- tabbed item\n\t\tdeeper\n\nplain",
  blanks: "\n\n\nstart\n\n\n\nmiddle\n\n\n",
};

/** The blocks the way a streaming view gets them: the text grows by `chunk` letters per frame. */
function streamed(text: string, chunk: number): Parsed {
  let state: Parsed | null = null;
  for (let end = chunk; end < text.length + chunk; end += chunk) {
    state = parseMore(state, text.slice(0, Math.min(end, text.length)));
    expect(blocksOfParsed(state)).toEqual(parseBlocks(text.slice(0, Math.min(end, text.length))));
  }
  return state ?? parseMore(null, text);
}

describe("incremental block reading", () => {
  for (const [name, text] of Object.entries(SAMPLES)) {
    it(`gives the whole read at every letter of ${name}`, () => {
      streamed(text, 1);
    });
    it(`gives the whole read when a frame brings several letters of ${name}`, () => {
      for (const chunk of [2, 3, 7, 13]) streamed(text, chunk);
    });
    it(`gives the whole read when one frame brings the rest of ${name} after any start`, () => {
      for (let split = 0; split <= text.length; split++) {
        const first = parseMore(null, text.slice(0, split));
        expect(blocksOfParsed(parseMore(first, text))).toEqual(parseBlocks(text));
      }
    });
  }

  it("reads a text that does not continue the one before afresh", () => {
    const first = parseMore(null, "# One\n\ntext");
    expect(blocksOfParsed(parseMore(first, "Different\n\nwords"))).toEqual(parseBlocks("Different\n\nwords"));
  });

  it("reads only the end of a long answer", () => {
    const paragraph = "A paragraph of the answer\nin two lines.\n\n";
    let state: Parsed | null = null;
    let text = "";
    for (let i = 0; i < 100; i++) {
      text += paragraph;
      state = parseMore(state, text);
    }
    parseWork.lines = 0;
    text += "One more";
    state = parseMore(state, text);
    expect(parseWork.lines).toBeLessThan(12);
    expect(blocksOfParsed(state)).toEqual(parseBlocks(text));
  });

  it("keeps the blocks it reused, so a view can tell they did not change", () => {
    const first = parseMore(null, "one\n\ntwo\n\nthree\n\nfour\n\nfi");
    const next = parseMore(first, "one\n\ntwo\n\nthree\n\nfour\n\nfive");
    expect(next.spans[0]!.block).toBe(first.spans[0]!.block);
    expect(next.spans[1]!.block).toBe(first.spans[1]!.block);
  });
});

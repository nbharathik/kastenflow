// What a copy writes and a paste reads: the JSON in its three carriers, the words, and what comes from other programs.

import { describe, expect, it } from "vitest";

import { type ElementsClip, KASTEN_TYPE, contentsOf, decode, encode, fromHtml, htmlOf, legacy, picturesOfHtml, wordsOfHtml, writeTo } from "./format.ts";
import { wordsOf } from "./words.ts";

const clip: ElementsClip = {
  v: 2,
  kind: "elements",
  stamp: "c-1",
  from: "s-aaaaaaaa",
  cut: false,
  elements: [
    { type: "text", id: "e-1", x: 1, y: 2, w: 300, h: 40, text: { paragraphs: [{ runs: [{ t: "Quarter " }, { t: "results", b: true }] }, { runs: [{ t: "Up 12 % ✓ « – »" }] }] } } as never,
    { type: "image", id: "e-2", x: 5, y: 6, w: 100, h: 80, src: "assets/chart.png", alt: "The chart" } as never,
    { type: "shape", id: "e-3", x: 5, y: 6, w: 100, h: 80, shape: "rect" } as never,
  ],
};

describe("what a copy carries", () => {
  it("is the same JSON in the Kasten type, in an attribute of the HTML, and nowhere else", () => {
    const written = new Map<string, string>();
    writeTo({ setData: (type, value) => void written.set(type, value) }, clip, wordsOf(clip));
    expect(decode(written.get(KASTEN_TYPE))).toEqual(clip);
    expect(fromHtml(written.get("text/html"))).toEqual(clip);
    expect(written.get("text/plain")).toBe("Quarter results\nUp 12 % ✓ « – »\nThe chart\nShape");
    expect(written.get("text/plain")).not.toContain("kasten");
  });

  it("keeps characters beyond Latin-1 whole through the HTML", () => {
    const html = htmlOf(clip, wordsOf(clip));
    expect(fromHtml(html)).toEqual(clip);
    // The visible part of the HTML is the words, as paragraphs.
    expect(html).toContain("<p>Quarter results</p>");
  });

  it("is read back by a paste from whichever of them survived", () => {
    const html = htmlOf(clip, wordsOf(clip));
    const data = (kinds: Record<string, string>) => ({ getData: (type: string) => kinds[type] ?? "", files: [] });
    expect(contentsOf(data({ [KASTEN_TYPE]: encode(clip) })).clip).toEqual(clip);
    expect(contentsOf(data({ "text/html": html, "text/plain": "words" })).clip).toEqual(clip);
    expect(contentsOf(data({ "text/plain": "words only" })).clip).toBeNull();
    expect(contentsOf(null).clip).toBeNull();
  });
});

describe("what is not ours", () => {
  it("is not taken for a copy: other versions, other kinds, empty copies, and broken JSON", () => {
    expect(decode(JSON.stringify({ v: 1, kind: "elements", stamp: "x", elements: [{}] }))).toBeNull();
    expect(decode(JSON.stringify({ v: 2, kind: "elements", stamp: "x", elements: [] }))).toBeNull();
    expect(decode(JSON.stringify({ v: 2, kind: "mystery", stamp: "x" }))).toBeNull();
    expect(decode("{not json")).toBeNull();
    expect(decode("")).toBeNull();
    expect(fromHtml('<div data-kasten-slides="@@@">x</div>')).toBeNull();
    expect(fromHtml("<p>plain</p>")).toBeNull();
  });

  it("reads the plain text a copy of the first versions made", () => {
    const old = "kasten-slides:" + JSON.stringify({ v: 1, elements: clip.elements });
    expect(legacy(old)?.elements).toEqual(clip.elements);
    expect(legacy("kasten-slides:{broken")).toBeNull();
    expect(legacy("hello")).toBeNull();
  });
});

describe("the words of a copy", () => {
  it("are the paragraphs of the blocks, a word for a block with none, and the lines of code", () => {
    expect(wordsOf({ ...clip, elements: [{ type: "code", id: "e-9", language: "ts", code: "let a = 1;\nlet b = 2;" } as never] })).toBe("let a = 1;\nlet b = 2;");
    expect(wordsOf({ ...clip, elements: [{ type: "table", id: "e-8", columns: [10], rows: [{ cells: [{ text: { paragraphs: [{ runs: [{ t: "Cell" }] }] } }] }] } as never] })).toBe("Cell");
    expect(wordsOf({ ...clip, elements: [{ type: "line", id: "e-7" } as never] })).toBe("Line");
  });

  it("of a copy of slides are their titles, or their place in the copy", () => {
    const slides = [
      { id: "s-1", layout: "title", elements: [{ type: "text", id: "e-1", placeholder: "title", text: { paragraphs: [{ runs: [{ t: "Opening" }] }] } }] },
      { id: "s-2", layout: "blank", elements: [] },
    ] as never;
    expect(wordsOf({ v: 2, kind: "slides", stamp: "c-2", slides, sections: [], pins: {}, cut: false })).toBe("Opening\nSlide 2");
  });
});

describe("what comes from other programs", () => {
  it("is the text of the HTML, a paragraph to a block, with scripts and styles left out", () => {
    expect(wordsOfHtml("<h1>Title</h1><p>One <b>two</b></p><ul><li>a</li><li>b</li></ul><style>p{}</style><script>alert(1)</script>")).toBe("Title\nOne two\na\nb");
    expect(wordsOfHtml("line<br>break")).toBe("line\nbreak");
    expect(wordsOfHtml("   ")).toBe("");
  });

  it("finds pictures held in the HTML as data, and leaves the ones it only links to", () => {
    const png = "iVBORw0KGgo=";
    const files = picturesOfHtml(`<p><img src="data:image/png;base64,${png}"><img src="https://example.com/a.png"><img src='data:image/jpeg;base64,${png}'></p>`);
    expect(files.map((file) => [file.name, file.type])).toEqual([
      ["image-1.png", "image/png"],
      ["image-2.jpg", "image/jpeg"],
    ]);
    expect(picturesOfHtml("<p>none</p>")).toEqual([]);
  });

  it("takes the pictures among the files of a paste, and no other file", () => {
    const files = [new File(["x"], "a.png", { type: "image/png" }), new File(["y"], "notes.txt", { type: "text/plain" })];
    const found = contentsOf({ getData: () => "", files }).files;
    expect(found.map((file) => file.name)).toEqual(["a.png"]);
  });
});

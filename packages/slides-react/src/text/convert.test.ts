// @vitest-environment node

import type { Paragraph, Run, Text, Theme } from "@kasten-slides/wasm";
import { beforeAll, describe, expect, it } from "vitest";

import { docToText, marksOfLook, nodeToParagraph, paragraphToNode, textToDoc } from "./convert.ts";
import { lookOfMark } from "./paragraph-attrs.ts";
import { type TextSchema, attrsOf, createTextSchema } from "./schema.ts";
import { themeNamed } from "./test-support.ts";

let schema: TextSchema;
let theme: Theme;

beforeAll(async () => {
  theme = await themeNamed("Light");
  schema = createTextSchema(theme, "body");
});

const roundTrip = (text: Text): Text => docToText(textToDoc(text, schema), text);

// A text no paragraph of a document can be the same as, so that everything is written afresh.
const NOTHING: Text = { paragraphs: [{ runs: [{ t: "\u0000" }] }] };
const fresh = (text: Text): Text => docToText(textToDoc(text, schema), NOTHING);
const plain = (...lines: string[]): Text => ({ paragraphs: lines.map((t) => ({ runs: [{ t }] })) });

// A small, seeded generator so failures can be reproduced.
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ["", "a", "Hello", " ", "  two  spaces  ", "héllo wörld", "日本語のテキスト", "😀🎉 emoji", "line\nbreak", "\n", "\n\n", "ends\n", "\nstarts", "tab\there", "é", "Ω≈ç√∫", "<b>&amp;</b>", '"quoted"', "a;b}c{d", "🏳️‍🌈"];
const COLORS = ["text1", "text2", "accent1", "accent6", "bg1", "#ff0000", "#1A73E8", "#abc"];
const FONTS = ["heading", "body", "code", "Georgia", "Comic Sans MS", 'Odd "Name"'];
const LINKS = ["https://example.com", "slide:s-1234abcd", "mailto:a@b.c", "https://x.y/?q=1&r=2#frag"];
const FIELDS = ["slideNumber", "slideCount", "stepLabel"];
const EXTRAS: Record<string, unknown>[] = [{ lang: "en" }, { baseline: 30000 }, { note: { nested: [1, 2, { a: null }] } }, { lang: "de", spell: false }];

function pick<T>(r: () => number, items: readonly T[]): T {
  return items[Math.floor(r() * items.length)] as T;
}

function genRun(r: () => number): Run {
  const run: Run = { t: pick(r, WORDS) };
  if (r() < 0.25) run.b = true;
  if (r() < 0.25) run.i = true;
  if (r() < 0.15) run.u = true;
  if (r() < 0.15) run.s = true;
  if (r() < 0.25) run.color = pick(r, COLORS);
  if (r() < 0.25) run.size = pick(r, [8, 10.5, 12, 22, 40, 96]);
  if (r() < 0.2) run.font = pick(r, FONTS);
  if (r() < 0.15) run.link = pick(r, LINKS);
  if (r() < 0.1) run.code = true;
  if (r() < 0.08) run.math = true;
  if (r() < 0.08) run.field = pick(r, FIELDS);
  if (r() < 0.1) Object.assign(run, pick(r, EXTRAS));
  return run;
}

function genParagraph(r: () => number): Paragraph {
  const runs = Array.from({ length: Math.floor(r() * 5) }, () => genRun(r));
  const paragraph: Paragraph = { runs };
  if (r() < 0.3) paragraph.align = pick(r, ["left", "center", "right", "justify"] as const);
  if (r() < 0.3) paragraph.list = pick(r, ["bullet", "number"] as const);
  if (r() < 0.2) paragraph.level = Math.floor(r() * 4);
  if (r() < 0.1) paragraph.style = pick(r, ["title", "caption", "code", "no-such-style"]);
  if (r() < 0.1) paragraph.spaceBefore = pick(r, [0, 6, 12.5]);
  if (r() < 0.1) paragraph.spaceAfter = pick(r, [0, 6, 12.5]);
  if (r() < 0.1) paragraph.lineSpacing = pick(r, [1, 1.15, 1.5]);
  if (r() < 0.1) paragraph.step = Math.floor(r() * 5);
  if (r() < 0.1) Object.assign(paragraph, pick(r, [{ bulletColor: "accent2" }, { indentEmu: 12345, tabs: [1, 2] }]));
  return paragraph;
}

function genText(r: () => number): Text {
  const text: Text = { paragraphs: Array.from({ length: Math.floor(r() * 6) }, () => genParagraph(r)) };
  if (r() < 0.4) text.valign = pick(r, ["top", "middle", "bottom"] as const);
  if (r() < 0.3) text.insets = { left: 1, top: 2, right: 3.5, bottom: 4 };
  if (r() < 0.2) Object.assign(text, { autofit: "shrink", cols: 2 });
  return text;
}

describe("textToDoc and docToText", () => {
  it("gives a text back as the same text", () => {
    const text: Text = {
      paragraphs: [
        { runs: [{ t: "Plain " }, { t: "bold", b: true }, { t: " and a " }, { t: "link", link: "https://example.com" }], list: "bullet" },
        { runs: [{ t: "x", color: "accent2", size: 30, font: "Georgia", i: true, u: true, s: true, code: true, math: true, field: "slideNumber" }], align: "center", level: 2, style: "caption", spaceBefore: 3, spaceAfter: 4, lineSpacing: 1.5, step: 2 },
      ],
      valign: "middle",
      insets: { left: 1, top: 2, right: 3, bottom: 4 },
    };
    const back = roundTrip(text);
    expect(back).toEqual(text);
    expect(back).toBe(text);
  });

  it("keeps the words of a run exactly, whatever they are", () => {
    for (const t of WORDS.filter((w) => w !== "")) {
      const doc = textToDoc(plain(t), schema);
      expect(nodeToParagraph(doc.child(0)).runs.map((run) => run.t).join("")).toBe(t);
    }
  });

  it("keeps the box's valign, insets and unknown fields", () => {
    const text = { paragraphs: [{ runs: [{ t: "a" }] }], valign: "bottom", insets: { left: 1, top: 2, right: 3, bottom: 4 }, autofit: "shrink", cols: 2 } as Text;
    const edited = docToText(textToDoc(plain("b"), schema), text);
    expect(edited).toEqual({ ...text, paragraphs: [{ runs: [{ t: "b" }] }] });
  });

  it("keeps a run's and a paragraph's unknown fields", () => {
    const text = { paragraphs: [{ runs: [{ t: "a", lang: "en", note: { n: [1, null, { z: true }] } }], bulletColor: "accent2", tabs: [1, 2] }] } as unknown as Text;
    const doc = textToDoc(text, schema);
    // Even when written afresh, without the text it came from.
    const written = docToText(doc, NOTHING);
    expect(written).toEqual(text);
    expect(written.paragraphs[0]).not.toBe(text.paragraphs[0]);
  });

  it("keeps an empty paragraph, in both of the ways one is written", () => {
    const text: Text = { paragraphs: [{ runs: [{ t: "a" }] }, { runs: [] }, { runs: [{ t: "" }], list: "bullet" }, { runs: [{ t: "", b: true, size: 30 }] }, { runs: [{ t: "b" }] }] };
    expect(roundTrip(text)).toBe(text);
    // An empty paragraph keeps the look of its one empty run, its mark; the other empty runs have nothing to say.
    expect(fresh(text).paragraphs).toEqual([{ runs: [{ t: "a" }] }, { runs: [{ t: "" }] }, { runs: [{ t: "" }], list: "bullet" }, { runs: [{ t: "", b: true, size: 30 }] }, { runs: [{ t: "b" }] }]);
  });

  it("keeps the look of an empty paragraph, written in any order, and takes a link or a field off it", () => {
    const text: Text = { paragraphs: [{ runs: [{ t: "", size: 12, color: "accent2", b: true, lang: "en" } as Run], list: "bullet" }, { runs: [{ t: "", link: "https://example.com", size: 9 }] }] };
    expect(roundTrip(text)).toBe(text);
    expect(fresh(text).paragraphs[0]).toEqual(text.paragraphs[0]);
    expect(attrsOf(textToDoc(text, schema).child(0)).mark).toBe('{"b":true,"color":"accent2","lang":"en","size":12}');
    const typed = textToDoc({ paragraphs: [{ runs: [{ t: "", link: "https://example.com", size: 9 }] }] }, schema).child(0);
    expect(marksOfLook(schema, lookOfMark(attrsOf(typed).mark)).map((mark) => mark.type.name)).toEqual(["size"]);
  });

  it("has no mark for a paragraph with words, whatever its other runs hold", () => {
    const doc = textToDoc({ paragraphs: [{ runs: [{ t: "a" }, { t: "", size: 40 }] }] }, schema);
    expect(attrsOf(doc.child(0)).mark).toBeNull();
  });

  it("keeps a text with no paragraphs, and a document made from nothing has one empty paragraph", () => {
    const empty: Text = { paragraphs: [], valign: "middle" };
    expect(roundTrip(empty)).toBe(empty);
    const doc = textToDoc(empty, schema);
    expect(doc.childCount).toBe(1);
    expect(doc.child(0).content.size).toBe(0);
    expect(docToText(doc, NOTHING).paragraphs).toEqual([{ runs: [{ t: "" }] }]);
  });

  it("keeps runs that were written as several with the same look, and empty runs, until the paragraph is edited", () => {
    const text: Text = { paragraphs: [{ runs: [{ t: "ab", b: true }, { t: "", i: true }, { t: "cd", b: true }, { t: "ef" }, { t: "gh" }] }, { runs: [{ t: "second" }] }] };
    const doc = textToDoc(text, schema);
    expect(docToText(doc, text)).toBe(text);
    // Edit the second paragraph only: the first is the very same object.
    const edited = schema.node("doc", null, [doc.child(0), paragraphToNode({ runs: [{ t: "changed" }] }, schema)]);
    const back = docToText(edited, text);
    expect(back.paragraphs[0]).toBe(text.paragraphs[0]);
    expect(back.paragraphs[1]).toEqual({ runs: [{ t: "changed" }] });
  });

  it("merges neighbouring runs with the same look once the paragraph is written afresh, and keeps different ones apart", () => {
    const text: Text = { paragraphs: [{ runs: [{ t: "ab", b: true }, { t: "cd", b: true }, { t: "ef" }, { t: "gh", b: true }, { t: "ij", b: true, color: "accent1" }] }] };
    expect(fresh(text).paragraphs[0]?.runs).toEqual([{ t: "abcd", b: true }, { t: "ef" }, { t: "gh", b: true }, { t: "ij", b: true, color: "accent1" }]);
  });

  it("finds an unchanged paragraph again after paragraphs were added above it and removed below", () => {
    const text: Text = { paragraphs: [{ runs: [{ t: "keep", b: true }, { t: "", i: true }] }, { runs: [{ t: "gone" }] }] };
    const doc = schema.node("doc", null, [paragraphToNode({ runs: [{ t: "new" }] }, schema), paragraphToNode(text.paragraphs[0] as Paragraph, schema)]);
    const back = docToText(doc, text);
    expect(back.paragraphs[0]).toEqual({ runs: [{ t: "new" }] });
    expect(back.paragraphs[1]).toBe(text.paragraphs[0]);
    expect(back.paragraphs).toHaveLength(2);
  });

  it("gives duplicates of a paragraph their own originals in turn", () => {
    const a: Paragraph = { runs: [{ t: "same" }, { t: "" }] };
    const b: Paragraph = { runs: [{ t: "same" }, { t: "" }] };
    const text: Text = { paragraphs: [a, b] };
    const back = roundTrip(text);
    expect(back.paragraphs[0]).toBe(a);
    expect(back.paragraphs[1]).toBe(b);
  });

  it("writes a paragraph that was changed with the settings it has now", () => {
    const text: Text = { paragraphs: [{ runs: [{ t: "a" }], list: "bullet", level: 1 }] };
    const doc = textToDoc(text, schema);
    const changed = doc.type.create(null, doc.child(0).type.create({ ...doc.child(0).attrs, list: null, level: null, align: "center" }, doc.child(0).content));
    expect(docToText(changed, text).paragraphs).toEqual([{ runs: [{ t: "a" }], align: "center" }]);
  });

  it("draws the marks of a run in the order the schema lists them", () => {
    const doc = textToDoc({ paragraphs: [{ runs: [{ t: "x", u: true, color: "accent1", b: true, size: 20 }] }] }, schema);
    expect(doc.child(0).child(0).marks.map((mark) => mark.type.name)).toEqual(["size", "bold", "color", "underline"]);
  });
});

describe("every mark", () => {
  const FLAGS = ["b", "i", "u", "s", "code", "math"] as const;

  it("comes back for all 4096 combinations of marks", () => {
    for (let n = 0; n < 4096; n++) {
      const run: Run = { t: `run ${n}` };
      FLAGS.forEach((flag, bit) => {
        if (n & (1 << bit)) run[flag] = true;
      });
      if (n & 64) run.color = "accent3";
      if (n & 128) run.size = 14;
      if (n & 256) run.font = "Georgia";
      if (n & 512) run.link = "https://example.com";
      if (n & 1024) run.field = "slideNumber";
      if (n & 2048) Object.assign(run, { lang: "en" });
      const text: Text = { paragraphs: [{ runs: [run] }] };
      expect(roundTrip(text)).toBe(text);
      expect(fresh(text)).toEqual(text);
    }
  });
});

describe("any text", () => {
  it("comes back as the same text, 500 shapes of it", () => {
    for (let seed = 1; seed <= 500; seed++) {
      const text = genText(random(seed));
      const back = roundTrip(text);
      expect(back, `seed ${seed}`).toBe(text);
    }
  });

  it("makes the same document again from what it writes without the text it came from", () => {
    for (let seed = 1; seed <= 500; seed++) {
      const text = genText(random(seed * 7919));
      const doc = textToDoc(text, schema);
      expect(textToDoc(docToText(doc, NOTHING), schema).eq(doc), `seed ${seed}`).toBe(true);
    }
  });

  it("writes only the words and looks it was given when it writes afresh", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const text = genText(random(seed * 104729));
      const written = fresh(text);
      const words = (t: Text): string[] => t.paragraphs.map((p) => p.runs.map((run) => run.t).join(""));
      const expected = words(text);
      expect(words(written), `seed ${seed}`).toEqual(expected.length > 0 ? expected : [""]);
    }
  });
});

// Anchors find their place again by exact words and nothing else: one match
// places them, several are told apart by what stands around them, and anything
// else is detached.

import { describe, expect, it } from "vitest";

import { anchorFor, CONTEXT, locate, pageTextOf, placeComment, placeHighlight, sectionAtOffset, sectionNames, wordsOf, type PageSection } from "./anchor";

const sections = (...parts: [string, string][]): PageSection[] => parts.map(([title, text]) => ({ title, text }));
const PAGE = pageTextOf(sections(["Method", "Use a perceptual hash to score photos. Then compare."], ["Results", "The hash is enough for crops. Compare twice."], ["Method", "Second pass: use a perceptual hash again."]));

const at = (text: string, quote: string, nth = 1) => {
  let from = -1;
  for (let i = 0; i < nth; i++) from = text.indexOf(quote, from + 1);
  return { from, to: from + quote.length };
};

describe("locate", () => {
  it("places a quote that occurs once", () => {
    const text = "one two three";
    expect(locate(text, "two")).toEqual({ from: 4, to: 7 });
    expect(locate(text, "four")).toBeNull();
    expect(locate(text, "")).toBeNull();
  });

  it("tells several apart by the 32 characters before and after, both matching exactly", () => {
    const text = "red apple pie. green apple tart. blue apple jam.";
    expect(locate(text, "apple", "pie. green ", " tart. blue ")).toEqual(at(text, "apple", 2));
    expect(locate(text, "apple", "red ", " pie. green ")).toEqual(at(text, "apple", 1));
    expect(locate(text, "apple", "tart. blue ", " jam.")).toEqual(at(text, "apple", 3));
    // Both sides must match, and of the same place.
    expect(locate(text, "apple", "pie. green ", " pie.")).toBeNull();
    expect(locate(text, "apple", "wrong ", " tart. blue ")).toBeNull();
    expect(locate(text, "apple", "red ", " tart.")).toBeNull();
  });

  it("looks at 32 characters of context and no more", () => {
    const text = `${"a".repeat(100)} word ${"b".repeat(100)} word ${"c".repeat(100)}`;
    const second = at(text, "word", 2);
    const before = text.slice(second.from - 80, second.from);
    const after = text.slice(second.to, second.to + 80);
    // Only the last 32 of the prefix and the first 32 of the suffix count.
    expect(locate(text, "word", before, after)).toEqual(second);
    expect(locate(text, "word", `changed ${before.slice(-CONTEXT)}`, after)).toEqual(second);
    expect(locate(text, "word", `${before.slice(0, -CONTEXT)}X${before.slice(-CONTEXT + 1)}`, after)).toBeNull();
  });

  it("several with no context to go by are ambiguous", () => {
    const text = "alpha beta alpha";
    expect(locate(text, "alpha")).toBeNull();
    expect(locate(text, "alpha", undefined, " beta")).toBeNull();
    expect(locate(text, "alpha", "", " beta alpha")).toEqual({ from: 0, to: 5 });
    // An empty prefix means the very start; an empty suffix the very end.
    expect(locate(text, "alpha", "beta ", "")).toEqual({ from: 11, to: 16 });
    expect(locate(text, "alpha", "", "")).toBeNull();
  });

  it("counts overlapping places as several", () => {
    expect(locate("aaa", "aa")).toBeNull();
    expect(locate("aaa", "aa", "", "a")).toEqual({ from: 0, to: 2 });
  });

  it("does not match loosely: case, spacing and punctuation must be the same", () => {
    expect(locate("The Hash is here", "the hash")).toBeNull();
    expect(locate("The  hash", "The hash")).toBeNull();
    expect(locate("a hash.", "a hash,")).toBeNull();
  });
});

describe("sections and offsets", () => {
  it("names a section by its title and which of that title it is", () => {
    expect(sectionNames(PAGE.sections)).toEqual([
      { title: "Method", nth: 1 },
      { title: "Results", nth: 1 },
      { title: "Method", nth: 2 },
    ]);
  });

  it("knows the section an offset is in", () => {
    expect(sectionAtOffset(PAGE, 0)).toBe(0);
    expect(sectionAtOffset(PAGE, PAGE.starts[1]!)).toBe(1);
    expect(sectionAtOffset(PAGE, PAGE.full.length)).toBe(2);
    expect(PAGE.full.slice(PAGE.starts[2]!)).toBe("Second pass: use a perceptual hash again.");
  });
});

describe("placing a comment", () => {
  it("goes to its section by title and number, and to the words in it", () => {
    const first = placeComment({ section: "Method", nth: 1, quote: "perceptual hash", prefix: "Use a ", suffix: " to score photos." }, PAGE);
    expect(first).toEqual({ kind: "section", section: 0, range: at(PAGE.full, "perceptual hash") });
    const second = placeComment({ section: "Method", nth: 2, quote: "perceptual hash", prefix: "use a ", suffix: " again." }, PAGE);
    expect(second.kind === "section" && second.section).toBe(2);
    expect(second.kind === "section" && second.range).toEqual(at(PAGE.full, "perceptual hash", 2));
  });

  it("stays in its section when the words in it have changed", () => {
    expect(placeComment({ section: "Results", nth: 1, quote: "no longer here" }, PAGE)).toEqual({ kind: "section", section: 1, range: null });
    expect(placeComment({ section: "Results", nth: 1 }, PAGE)).toEqual({ kind: "section", section: 1, range: null });
  });

  it("falls back to a quote that occurs once when its section is gone", () => {
    const placed = placeComment({ section: "Findings", nth: 1, quote: "enough for crops" }, PAGE);
    expect(placed).toEqual({ kind: "quote", section: 1, range: at(PAGE.full, "enough for crops") });
    // The second Method is gone: the first is not taken for it.
    const fewer = pageTextOf(PAGE.sections.slice(0, 2));
    expect(placeComment({ section: "Method", nth: 2, quote: "score photos" }, fewer)).toMatchObject({ kind: "quote", section: 0 });
    expect(placeComment({ section: "Method", nth: 2 }, fewer)).toEqual({ kind: "detached" });
  });

  it("is detached when the section is gone and the quote is not there, or is there twice", () => {
    expect(placeComment({ section: "Findings", nth: 1, quote: "words that were edited" }, PAGE)).toEqual({ kind: "detached" });
    expect(placeComment({ section: "Findings", nth: 1 }, PAGE)).toEqual({ kind: "detached" });
    // "perceptual hash" is in two sections: told apart only by exact context.
    expect(placeComment({ section: "Findings", nth: 1, quote: "perceptual hash" }, PAGE)).toEqual({ kind: "detached" });
    expect(placeComment({ section: "Findings", nth: 1, quote: "perceptual hash", prefix: "x", suffix: "y" }, PAGE)).toEqual({ kind: "detached" });
  });

  it("is told apart by context when the section is gone", () => {
    const placed = placeComment({ section: "Findings", nth: 1, quote: "perceptual hash", prefix: "use a ", suffix: " again." }, PAGE);
    expect(placed).toEqual({ kind: "quote", section: 2, range: at(PAGE.full, "perceptual hash", 2) });
  });

  it("a comment on the whole page needs no place, unless it quotes words that are gone", () => {
    expect(placeComment({ section: "", nth: 1 }, PAGE)).toEqual({ kind: "page", range: null });
    expect(placeComment({ section: "", nth: 1, quote: "score photos" }, PAGE)).toEqual({ kind: "page", range: at(PAGE.full, "score photos") });
    expect(placeComment({ section: "", nth: 1, quote: "words that were edited" }, PAGE)).toEqual({ kind: "detached" });
  });

  it("is detached after the page's words were edited, never matched loosely", () => {
    const edited = pageTextOf(sections(["Intro", "Use a perceptual-hash to score photos."]));
    expect(placeComment({ section: "Method", nth: 1, quote: "perceptual hash" }, edited)).toEqual({ kind: "detached" });
  });
});

describe("placing a highlight", () => {
  it("finds its quote once, or by its context, and is otherwise detached", () => {
    expect(placeHighlight({ quote: "enough for crops" }, PAGE)).toEqual(at(PAGE.full, "enough for crops"));
    expect(placeHighlight({ quote: "perceptual hash" }, PAGE)).toBeNull();
    expect(placeHighlight({ quote: "perceptual hash", prefix: "use a ", suffix: " again." }, PAGE)).toEqual(at(PAGE.full, "perceptual hash", 2));
    expect(placeHighlight({ quote: "perceptual hash", prefix: "use a ", suffix: " nope" }, PAGE)).toBeNull();
    expect(placeHighlight({ quote: "edited away" }, PAGE)).toBeNull();
  });
});

describe("words picked out", () => {
  it("are trimmed of white space and keep what stands around them", () => {
    const text = "Press Ctrl+N anywhere to jot something down. It lands in the inbox.";
    const from = text.indexOf(" jot");
    const to = text.indexOf(".", from) + 1;
    const words = wordsOf(text, from, to, 500)!;
    expect(words.quote).toBe("jot something down.");
    expect(words.prefix).toBe(text.slice(Math.max(0, words.from - CONTEXT), words.from));
    expect(words.suffix).toBe(" It lands in the inbox.");
    expect(text.slice(words.from, words.to)).toBe(words.quote);
    expect(wordsOf(text, 0, 5, 500)!.prefix).toBe("");
  });

  it("are null when only white space is picked, and cut when too long", () => {
    expect(wordsOf("a   b", 1, 4, 500)).toBeNull();
    expect(wordsOf("abcdefghij", 8, 3, 4)).toMatchObject({ quote: "defg", from: 3, to: 7 });
  });
});

describe("the anchor for a new comment", () => {
  it("names the section of the words on a page with sections", () => {
    const words = wordsOf(PAGE.full, PAGE.full.indexOf("enough"), PAGE.full.indexOf("enough") + 6, 500)!;
    expect(anchorFor(PAGE, { words })).toMatchObject({ section: "Results", nth: 1, quote: "enough" });
    const second = wordsOf(PAGE.full, PAGE.starts[2]! + 13, PAGE.starts[2]! + 23, 500)!;
    expect(anchorFor(PAGE, { words: second })).toMatchObject({ section: "Method", nth: 2 });
  });

  it("is on the page as a whole when it has one section, or none is meant", () => {
    const one = pageTextOf(sections(["Untitled section", "Just some words here."]));
    const words = wordsOf(one.full, 5, 9, 500)!;
    expect(anchorFor(one, { words })).toEqual({ section: "", nth: 1, quote: "some", prefix: "Just ", suffix: " words here." });
    expect(anchorFor(PAGE, {})).toEqual({ section: "", nth: 1 });
    expect(anchorFor(PAGE, { section: 1 })).toEqual({ section: "Results", nth: 1 });
    expect(anchorFor(one, { section: 0 })).toEqual({ section: "", nth: 1 });
  });

  it("round trips: a comment made on words is placed at the same words", () => {
    const from = PAGE.full.indexOf("Compare twice");
    const words = wordsOf(PAGE.full, from, from + "Compare twice".length, 500)!;
    const anchor = anchorFor(PAGE, { words });
    expect(placeComment(anchor, PAGE)).toEqual({ kind: "section", section: 1, range: { from, to: from + "Compare twice".length } });
  });
});

import { describe, expect, it } from "vitest";

import { parsePasted } from "./paste-parse";

describe("a block copied from a spreadsheet (tabs)", () => {
  it.each([
    ["one cell", "hello", [["hello"]]],
    ["a row", "a\tb\tc", [["a", "b", "c"]]],
    ["rows", "a\tb\nc\td", [["a", "b"], ["c", "d"]]],
    ["Windows line ends", "a\tb\r\nc\td\r\n", [["a", "b"], ["c", "d"]]],
    ["old Mac line ends", "a\tb\rc\td", [["a", "b"], ["c", "d"]]],
    ["a trailing empty line", "a\tb\nc\td\n", [["a", "b"], ["c", "d"]]],
    ["only the last empty line goes", "a\n\n", [["a"], [""]]],
    ["empty cells in the middle and at the ends", "\tb\t\n\t\t", [["", "b", ""], ["", "", ""]]],
    ["ragged rows are kept as they are", "a\tb\tc\nd\ne\tf", [["a", "b", "c"], ["d"], ["e", "f"]]],
    ["a byte-order mark", "﻿a\tb", [["a", "b"]]],
    ["spaces stay inside cells", " a b \tc", [[" a b ", "c"]]],
  ])("%s", (_name, text, expected) => {
    expect(parsePasted(text)).toEqual(expected);
  });

  it("gives nothing for nothing", () => {
    expect(parsePasted("")).toEqual([]);
    expect(parsePasted("\n")).toEqual([]);
    expect(parsePasted("\r\n")).toEqual([]);
  });
});

describe("quoted cells", () => {
  it.each([
    ["a quoted cell", '"hello"\tb', [["hello", "b"]]],
    ["a tab inside quotes", '"a\tb"\tc', [["a\tb", "c"]]],
    ["a new line inside quotes", '"line one\nline two"\tx\ny\tz', [["line one\nline two", "x"], ["y", "z"]]],
    ["CRLF inside quotes", '"a\r\nb"\tx', [["a\r\nb", "x"]]],
    ["a doubled quote is one quote", '"say ""hi"""\tb', [['say "hi"', "b"]]],
    ["an empty quoted cell", '""\tb', [["", "b"]]],
    ["a quote in the middle of a cell is just a quote", 'it"s\tb', [['it"s', "b"]]],
    ["a quote closed and followed by text", '"ab"cd\tx', [["abcd", "x"]]],
    ["a quote never closed takes the rest", '"open\tstill', [["open\tstill"]]],
  ])("%s", (_name, text, expected) => {
    expect(parsePasted(text)).toEqual(expected);
  });
});

describe("comma separated text", () => {
  it("is read as CSV when every line has the same commas", () => {
    expect(parsePasted("a,b,c\n1,2,3\n")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });

  it("handles quotes with commas and new lines in them", () => {
    expect(parsePasted('name,note\n"Smith, Jo","two\nlines"\r\nPat,"say ""hi"""')).toEqual([
      ["name", "note"],
      ["Smith, Jo", "two\nlines"],
      ["Pat", 'say "hi"'],
    ]);
  });

  it("is not split when it is one line, so a sentence pastes whole", () => {
    expect(parsePasted("Hello, world and all")).toEqual([["Hello, world and all"]]);
  });

  it("is not split when the lines disagree about their commas", () => {
    expect(parsePasted("Hello, world\nplain line")).toEqual([["Hello, world"], ["plain line"]]);
  });

  it("is split when the lines agree, even with empty cells", () => {
    expect(parsePasted("a,,c\n,,\n")).toEqual([["a", "", "c"], ["", "", ""]]);
  });

  it("prefers tabs when there are any", () => {
    expect(parsePasted("a, b\tc\nd\te")).toEqual([["a, b", "c"], ["d", "e"]]);
  });
});

describe("plain lines", () => {
  it("makes one cell per line", () => {
    expect(parsePasted("one\ntwo\nthree")).toEqual([["one"], ["two"], ["three"]]);
  });
});

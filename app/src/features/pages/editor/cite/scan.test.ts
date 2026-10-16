import { describe, expect, it } from "vitest";

import { citationGroups, citationRawRanges } from "./scan";

const keys = (text: string) => citationGroups(text).flatMap((g) => g.items.map((i) => i.key));

describe("finding citations in a line of text", () => {
  it("reads [@key], with a locator, with a lead-in and with several works", () => {
    expect(keys("As shown [@vaswani2017attention].")).toEqual(["vaswani2017attention"]);
    expect(keys("[@a, p. 4]")).toEqual(["a"]);
    expect(keys("[see @a; @b, ch. 2]")).toEqual(["a", "b"]);
    expect(keys("one [@a] and two [@b]")).toEqual(["a", "b"]);
  });

  it("says where each group and key are, and marks a suppressed author", () => {
    const text = "ab [see -@c1; @c2] cd";
    const [group] = citationGroups(text);
    expect(text.slice(group!.from, group!.to)).toBe("[see -@c1; @c2]");
    const [first, second] = group!.items;
    expect(text.slice(first!.keyFrom, first!.keyTo)).toBe("c1");
    expect(text.slice(first!.at, first!.keyTo)).toBe("-@c1");
    expect(first!.suppress).toBe(true);
    expect(text.slice(second!.at, second!.keyTo)).toBe("@c2");
    expect(second!.suppress).toBe(false);
  });

  it("takes punctuation inside a key and leaves it off the end", () => {
    expect(keys("[@doe:2020-x.y]")).toEqual(["doe:2020-x.y"]);
    expect(keys("[@a.]")).toEqual(["a"]);
    expect(keys("[@müller2020, p. 3]")).toEqual(["müller2020"]);
  });

  it("is not fooled by addresses, links, wiki links, references, escaped brackets or a bare @", () => {
    expect(keys("write to me@example.com [x]")).toEqual([]);
    expect(keys("[a@b.com]")).toEqual([]);
    expect(keys("[@a](https://example.org)")).toEqual([]);
    expect(keys("[@a][ref]")).toEqual([]);
    expect(keys("[@a]: the definition")).toEqual([]);
    expect(keys("[[page @a]]")).toEqual([]);
    expect(keys("\\[@a]")).toEqual([]);
    expect(keys("@a without brackets")).toEqual([]);
    expect(keys("[ @ ]")).toEqual([]);
    expect(keys("[@a")).toEqual([]);
  });

  it("is not looking inside the masked characters a code span or a link leaves", () => {
    expect(keys("￼￼￼￼￼￼")).toEqual([]);
    expect(keys("see ￼ then [@b]")).toEqual(["b"]);
  });

  it("gives the parts to write as they are, so nothing in them is escaped", () => {
    const text = "A [see -@a_b; @c, p. 4] z";
    expect(citationRawRanges(text).map(([a, b]) => text.slice(a, b))).toEqual(["[", "-@a_b", "@c", "]"]);
    expect(citationRawRanges("plain text")).toEqual([]);
  });
});

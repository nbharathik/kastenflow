import { describe, expect, it } from "vitest";

import { entryTexts, parseBibtex, renderEntry } from "./bibtex";

const VASWANI = `@inproceedings{vaswani2017attention,
  author    = {Vaswani, Ashish and Shazeer, Noam},
  title     = {Attention is all you need},
  booktitle = {Advances in Neural Information Processing Systems},
  year      = {2017},
  pages     = {5998--6008}
}
`;

describe("reading pasted BibTeX", () => {
  it("reads the type, key and fields of an entry, with the span it was written in", () => {
    const { entries, problems } = parseBibtex(`% a note\n${VASWANI}`);
    expect(problems).toEqual([]);
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry).toMatchObject({ type: "inproceedings", key: "vaswani2017attention" });
    expect(entry!.fields).toEqual({
      author: "Vaswani, Ashish and Shazeer, Noam",
      title: "Attention is all you need",
      booktitle: "Advances in Neural Information Processing Systems",
      year: "2017",
      pages: "5998--6008",
    });
    const text = `% a note\n${VASWANI}`;
    expect(text.slice(entry!.start, entry!.end)).toBe(VASWANI.trimEnd());
  });

  it("reads quoted values, bare numbers, parentheses and nested braces, leaving LaTeX as written", () => {
    const { entries } = parseBibtex(`@Article(Doe2020,\n title = "A {B}ig \\"Idea\\"",\n year = 2020,\n journal = {Journal of {NLP} \\& more},\n)`);
    expect(entries[0]!.type).toBe("article");
    expect(entries[0]!.fields).toEqual({ title: 'A {B}ig \\"Idea\\"', year: "2020", journal: "Journal of {NLP} \\& more" });
  });

  it("puts @string macros in, joins pieces with #, and turns a month abbreviation into its name", () => {
    const { entries } = parseBibtex('@string{nips = "Advances in NIPS"}\n@inproceedings{a, booktitle = nips # " 2017", month = jun, year = 2017}');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.fields).toEqual({ booktitle: "Advances in NIPS 2017", month: "June", year: "2017" });
  });

  it("skips comments, preambles and the @ of an address, and reads every entry in order", () => {
    const text = `@comment{@misc{inside, title={no}}}\n@preamble{"\\newcommand"}\nWrite to me@example.com.\n@book{one, title={One}}\n@misc{two, title={Two}}`;
    const { entries } = parseBibtex(text);
    expect(entries.map((e) => e.key)).toEqual(["one", "two"]);
  });

  it("keeps the first of a field named twice, and lower-cases names", () => {
    const { entries } = parseBibtex("@misc{k, Title={First}, TITLE={Second}}");
    expect(entries[0]!.fields).toEqual({ title: "First" });
  });

  it("reads what it can of an entry that is not closed and says so", () => {
    const { entries, problems } = parseBibtex("@article{cut, title = {Half written");
    expect(entries[0]).toMatchObject({ key: "cut", fields: { title: "Half written" } });
    expect(problems.join(" ")).toMatch(/not closed/);
  });

  it("finds nothing in text that is not BibTeX", () => {
    expect(parseBibtex("").entries).toEqual([]);
    expect(parseBibtex("just some words, no entry").entries).toEqual([]);
    expect(parseBibtex("@misc{,\n title = {x}}").problems.join(" ")).toMatch(/key/);
  });

  it("gives each entry's own text by key, for a raw edit", () => {
    const text = `% head\n${VASWANI}\n@misc{two, title={Two}}\n`;
    const texts = entryTexts(text);
    expect(texts.get("vaswani2017attention")).toBe(VASWANI.trimEnd());
    expect(texts.get("two")).toBe("@misc{two, title={Two}}");
  });
});

describe("writing an entry in house style", () => {
  it("orders the fields and ends each with a comma", () => {
    expect(renderEntry("article", "doe2020", { year: "2020", title: "A thing", author: "Doe, Jane", custom: "x" })).toBe("@article{doe2020,\n  author = {Doe, Jane},\n  title = {A thing},\n  year = {2020},\n  custom = {x},\n}");
  });
});

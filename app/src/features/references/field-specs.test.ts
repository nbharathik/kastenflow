import { describe, expect, it } from "vitest";

import { ENTRY_TYPES } from "../../lib/vault/reference-types";
import { extraFields, fieldsFor, typeLabel } from "./field-specs";

describe("the fields the form offers", () => {
  it("always offers the people, the title and the year first, then where it appeared, then the identifiers", () => {
    const names = (type: string) => fieldsFor(type).map((f) => f.name);
    expect(names("article")).toEqual(["author", "title", "year", "journal", "volume", "number", "pages", "doi", "eprint", "url", "abstract", "note"]);
    expect(names("inproceedings")).toEqual(["author", "title", "year", "booktitle", "pages", "doi", "eprint", "url", "abstract", "note"]);
    expect(names("book")).toEqual(["author", "title", "year", "publisher", "doi", "eprint", "url", "abstract", "note"]);
    expect(names("phdthesis")).toContain("school");
    expect(names("techreport")).toContain("institution");
    expect(names("whatever")).toEqual(["author", "title", "year", "howpublished", "doi", "eprint", "url", "abstract", "note"]);
  });

  it("offers every type the vault names, with a plain name for each", () => {
    for (const type of ENTRY_TYPES) expect(fieldsFor(type).length).toBeGreaterThan(5);
    expect(typeLabel("inproceedings")).toBe("Conference paper");
    expect(typeLabel("phdthesis")).toBe("PhD thesis");
    expect(typeLabel("odd")).toBe("odd");
  });

  it("keeps the fields it has no row for as extras to show read only", () => {
    expect(extraFields("article", { title: "T", journal: "J", booktitle: "B", mynote: "x", empty: " " })).toEqual([
      ["booktitle", "B"],
      ["mynote", "x"],
    ]);
  });
});

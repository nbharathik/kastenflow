import { describe, expect, it } from "vitest";

import { blankDraft, fillBlanks, keyHintsOf, missingOf, newReferenceOf, trimmedFields } from "./draft";

describe("what a reference lacks", () => {
  it("names the fields every kind of entry should have, never inventing them", () => {
    expect(missingOf("article", { title: "T" })).toEqual(["author", "year", "journal"]);
    expect(missingOf("article", { title: "T", author: "Doe, J.", year: "2020", journal: "J" })).toEqual([]);
    expect(missingOf("inproceedings", { author: "A", title: "T", year: "2020" })).toEqual(["booktitle"]);
    expect(missingOf("book", { editor: "E", title: "T", year: "2001" })).toEqual([]);
    expect(missingOf("misc", {})).toEqual(["title", "author", "year"]);
  });

  it("accepts a date or a journal title for a year or a journal, and ignores blank values", () => {
    expect(missingOf("article", { author: "A", title: "T", date: "2020-05-01", journaltitle: "J" })).toEqual([]);
    expect(missingOf("misc", { title: "  ", author: "A", year: "2020" })).toEqual(["title"]);
  });
});

describe("a draft", () => {
  it("fills only the blanks of one draft from another, and keeps what the person wrote", () => {
    const base = { ...blankDraft(), type: "article", fields: { title: "Mine", year: "" } };
    const extra = { ...blankDraft(), fields: { title: "Theirs", year: "2020", doi: "10.1000/x" }, guessed: ["year"] };
    const merged = fillBlanks(base, extra);
    expect(merged.fields).toEqual({ title: "Mine", year: "2020", doi: "10.1000/x" });
    expect(merged.guessed).toEqual(["year"]);
  });

  it("becomes a new reference with only the fields that have a value", () => {
    const draft = { ...blankDraft(), type: "Article", key: " doe2020 ", fields: { title: " A thing ", year: "", author: "Doe, J." } };
    expect(newReferenceOf(draft)).toEqual({ type: "article", key: "doe2020", fields: { title: "A thing", author: "Doe, J." } });
    expect(newReferenceOf(draft, true).allowDuplicate).toBe(true);
    expect(trimmedFields({ a: " x ", b: "   " })).toEqual({ a: "x" });
  });

  it("gives the hints a key is made from", () => {
    expect(keyHintsOf({ author: "Vaswani, Ashish and Shazeer, Noam", year: "2017", title: "Attention is all you need" })).toEqual({ author: "Vaswani, Ashish and Shazeer, Noam", year: "2017", title: "Attention is all you need" });
    expect(keyHintsOf({ editor: "Ed, Itor", date: "2019-03-01" })).toEqual({ author: "Ed, Itor", year: "2019" });
    expect(keyHintsOf({})).toEqual({});
  });
});

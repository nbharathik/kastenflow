import { describe, expect, it } from "vitest";

import { MANAGED_BIB, type BibFile, type Bibliography } from "../../lib/vault/reference-types";
import { checkRaw, fileTexts, rawEntry } from "./raw";

const bytesOf = (text: string) => new TextEncoder().encode(text).length;
const file = (path: string, text: string | null, managed = false, problem: string | null = null): BibFile => ({ path, managed, exists: text !== null, hash: "h", bytes: text === null ? 0 : bytesOf(text), problem, entries: [] });

const MANAGED = "% mine\n@article{müller2020, title = {Über Dinge}, year = 2020}\n";
const OTHER = "@book{zotero1, title={Z}}";

/** What the client's `references()` gives: each file's text and a newline. */
const joined = (...texts: string[]) => texts.map((t) => `${t}\n`).join("");

describe("each file's own text out of the one the client gives", () => {
  it("cuts it at the byte counts, so text with accents lines up", () => {
    const bib: Bibliography = { managed: file(MANAGED_BIB, MANAGED, true), external: [file("zotero/lib.bib", OTHER)], duplicates: [] };
    const texts = fileTexts(bib, joined(MANAGED, OTHER));
    expect(texts.get(MANAGED_BIB)).toBe(MANAGED);
    expect(texts.get("zotero/lib.bib")).toBe(OTHER);
  });

  it("starts at the first external file when the managed one is not there yet", () => {
    const bib: Bibliography = { managed: file(MANAGED_BIB, null, true), external: [file("a.bib", OTHER)], duplicates: [] };
    const texts = fileTexts(bib, joined(OTHER));
    expect(texts.has(MANAGED_BIB)).toBe(false);
    expect(texts.get("a.bib")).toBe(OTHER);
  });

  it("gives up where the text no longer lines up, and for a file that was not read", () => {
    const bib: Bibliography = { managed: file(MANAGED_BIB, MANAGED, true), external: [file("big.bib", null, false, "It is over 4 MB"), file("c.bib", OTHER)], duplicates: [] };
    const texts = fileTexts(bib, joined(MANAGED, OTHER));
    expect(texts.get(MANAGED_BIB)).toBe(MANAGED);
    expect(texts.has("big.bib")).toBe(false);
    expect(texts.has("c.bib")).toBe(false);
    expect(fileTexts({ ...bib, external: [] }, "not what was expected").size).toBe(0);
  });
});

describe("an entry's own text", () => {
  it("is the stretch from @ to the closing brace", () => {
    expect(rawEntry(MANAGED, "müller2020")).toBe("@article{müller2020, title = {Über Dinge}, year = 2020}");
    expect(rawEntry(MANAGED, "gone")).toBeNull();
  });
});

describe("checking an entry that was edited by hand", () => {
  const key = "müller2020";
  it("accepts one whole entry with the same key, however it is written", () => {
    expect(checkRaw(key, "@article{müller2020,\n  title = {Changed}\n}")).toBeNull();
    expect(checkRaw(key, "  @Article( müller2020 , year = 1999 )  \n")).toBeNull();
  });

  it("says in words what is wrong", () => {
    expect(checkRaw(key, "   ")).toMatch(/Write the entry/);
    expect(checkRaw(key, "title = {x}")).toMatch(/not a BibTeX entry/);
    expect(checkRaw(key, "@article{müller2020, title = {Half")).toMatch(/not closed/);
    expect(checkRaw(key, "@article{other, title={x}}")).toMatch(/key must stay “müller2020”.*Rename key/);
    expect(checkRaw(key, "@article{müller2020, a={1}} @article{two, a={2}}")).toMatch(/only one entry/i);
    expect(checkRaw(key, "a note\n@article{müller2020, a={1}}")).toMatch(/outside the entry/);
    expect(checkRaw(key, "@article{müller2020, a={1}}\nmore words")).toMatch(/outside the entry/);
  });
});

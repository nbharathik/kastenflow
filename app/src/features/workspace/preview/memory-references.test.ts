import { describe, expect, it } from "vitest";

import { MANAGED_BIB } from "../../../lib/vault/reference-types";
import { citations, countOf, renameIn } from "./cite-text";
import { MemoryVault } from "./memory-vault";

const PROJECT = "projects/trip/_project.md";
const SEED = '% Papers I read\n@string{nips = "Advances in NIPS"}\n\n@inproceedings{vaswani2017attention,\n  title     = {Attention is all you need},\n  booktitle = nips,\n  year      = 2017,\n  mynote    = {keep me},\n  pages     = "1--9"\n}\n\n@comment{keep this too}\n';

describe("the bibliography in the preview", () => {
  it("is the text of the .bib files the vault started with, one after another in the order of their paths", async () => {
    const vault = new MemoryVault({
      [PROJECT]: "---\ntitle: Trip\n---\n",
      "papers/b.bib": "@article{second, title={B}}",
      "a.bib": "@article{first, title={A}}",
      "papers/deep/c.bib": "@article{third, title={C}}",
    });
    const text = await vault.references();
    expect(text.indexOf("@article{first")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("@article{first")).toBeLessThan(text.indexOf("@article{second"));
    expect(text.indexOf("@article{second")).toBeLessThan(text.indexOf("@article{third"));
  });

  it("leaves out hidden folders and anything that is not a .bib file, and is empty when there is none", async () => {
    const vault = new MemoryVault({
      [PROJECT]: "---\ntitle: Trip\n---\n",
      ".kasten/x.bib": "@article{hidden, title={No}}",
      "notes.bib.txt": "@article{text, title={No}}",
    });
    expect(await vault.references()).toBe("");
  });

  it("lists the managed file first, so its keys win", async () => {
    const vault = new MemoryVault({ [PROJECT]: "---\ntitle: Trip\n---\n", "a-first.bib": "@article{shared, title={External}}", [MANAGED_BIB]: "@article{shared, title={Managed}}" });
    const text = await vault.references();
    expect(text.indexOf("Managed")).toBeLessThan(text.indexOf("External"));
  });
});

describe("editing the bibliography in the preview", () => {
  const empty = () => new MemoryVault({ [PROJECT]: "---\ntitle: Trip\n---\n" });

  it("makes the managed file in house style with the first reference", async () => {
    const vault = empty();
    const before = await vault.bibliography();
    expect(before.managed.exists).toBe(false);
    const saved = await vault.addReference({ type: "Article", key: "doe2020thing", fields: { year: "2020", title: "A thing", author: "Doe, Jane", doi: "10.1000/xyz", empty: "  " } }, before.managed.hash);
    expect(saved.key).toBe("doe2020thing");
    const after = await vault.bibliography();
    expect(after.managed.hash).toBe(saved.hash);
    expect(await vault.references()).toBe("@article{doe2020thing,\n  author = {Doe, Jane},\n  title = {A thing},\n  year = {2020},\n  doi = {10.1000/xyz},\n}\n\n");
    expect(after.managed.entries[0]!.fields.title).toBe("A thing");
  });

  it("changes only the bytes of the values it sets", async () => {
    const vault = new MemoryVault({ [PROJECT]: "---\ntitle: Trip\n---\n", [MANAGED_BIB]: SEED });
    const base = (await vault.bibliography()).managed.hash;
    await vault.updateReference("vaswani2017attention", { title: "Attention Is All You Need", year: "2018", pages: "5--9", volume: "30", mynote: null }, base);
    expect((await vault.references()).trimEnd()).toBe(
      '% Papers I read\n@string{nips = "Advances in NIPS"}\n\n@inproceedings{vaswani2017attention,\n  title     = {Attention Is All You Need},\n  booktitle = nips,\n  year      = 2018,\n  pages     = "5--9",\n  volume    = {30}\n}\n\n@comment{keep this too}',
    );
  });

  it("adds a field inline to a one-line entry and after a trailing comma, and takes one out", async () => {
    const vault = new MemoryVault({ [PROJECT]: "---\ntitle: Trip\n---\n", [MANAGED_BIB]: "@misc{multi,\n  title = {T},\n}\n@misc{inline, title = {T}, year = {2020}}\n" });
    let hash = (await vault.bibliography()).managed.hash;
    hash = (await vault.updateReference("multi", { year: "2020" }, hash)).hash;
    await vault.updateReference("inline", { year: null }, hash);
    expect((await vault.references()).trimEnd()).toBe("@misc{multi,\n  title = {T},\n  year = {2020},\n}\n@misc{inline, title = {T}}");
  });

  it("refuses an edit that started from an older file", async () => {
    const vault = new MemoryVault({ [PROJECT]: "---\ntitle: Trip\n---\n", [MANAGED_BIB]: SEED });
    await expect(vault.addReference({ type: "misc", key: "k", fields: {} }, "0000")).rejects.toThrow(/changed since/);
  });

  it("refuses a duplicate key, DOI or arXiv number unless it is allowed, and says what it would repeat", async () => {
    const vault = new MemoryVault({
      [PROJECT]: "---\ntitle: Trip\n---\n",
      [MANAGED_BIB]: "@article{one, title = {One}, doi = {10.1000/ABC}}\n@article{two, title = {Two}, eprint = {2005.14165}, archiveprefix = {arXiv}}\n",
      "other.bib": "@article{three, doi = {10.5555/zzz}}\n",
    });
    const hash = () => vault.bibliography().then((b) => b.managed.hash);
    await expect(vault.addReference({ type: "misc", key: "ONE", fields: {} }, await hash())).rejects.toThrow(/key “one”/);
    await expect(vault.addReference({ type: "misc", key: "f1", fields: { doi: "https://doi.org/10.1000/abc" } }, await hash())).rejects.toThrow(/same DOI/);
    await expect(vault.addReference({ type: "misc", key: "f2", fields: { eprint: "arXiv:2005.14165v3" } }, await hash())).rejects.toThrow(/arXiv identifier/);
    await expect(vault.addReference({ type: "misc", key: "f3", fields: { doi: "10.5555/ZZZ" } }, await hash())).rejects.toThrow(/other\.bib/);
    const found = await vault.checkReference({ type: "misc", key: "one", fields: { doi: "doi:10.1000/ABC" } });
    expect(found.map((m) => [m.by, m.file, m.key])).toEqual([
      ["key", MANAGED_BIB, "one"],
      ["doi", MANAGED_BIB, "one"],
    ]);
    await vault.addReference({ type: "misc", key: "f1", fields: { doi: "10.1000/abc" }, allowDuplicate: true }, await hash());
    expect((await vault.bibliography()).duplicates.map((d) => d.by)).toEqual(["doi"]);
  });

  it("makes a managed copy of an external file with the macros its entries use", async () => {
    const vault = new MemoryVault({
      [PROJECT]: "---\ntitle: Trip\n---\n",
      "papers/colleague.bib": '@string{ieee = "IEEE"}\n@string{tpami = ieee # " TPAMI"}\n@article{alpha2020, journal = tpami, title = {Alpha}}\n@book{beta2019, title = {Beta}}\n@article{gamma2018, title = {Gamma}\n',
    });
    const done = await vault.adoptBib("papers/colleague.bib", null, (await vault.bibliography()).managed.hash);
    expect(done.added).toEqual(["alpha2020", "beta2019"]);
    expect(done.skipped.map((s) => s.key)).toEqual(["gamma2018"]);
    expect((await vault.references()).startsWith('@string{ieee = "IEEE"}\n@string{tpami = ieee # " TPAMI"}\n@article{alpha2020, journal = tpami, title = {Alpha}}\n\n@book{beta2019, title = {Beta}}\n')).toBe(true);
    expect((await vault.bibliography()).managed.entries[0]!.fields.journal).toBe("IEEE TPAMI");
  });

  it("replaces an entry with one whole entry of the same key and nothing else", async () => {
    const vault = new MemoryVault({ [PROJECT]: "---\ntitle: Trip\n---\n", [MANAGED_BIB]: SEED });
    const key = "vaswani2017attention";
    const hash = () => vault.bibliography().then((b) => b.managed.hash);
    await vault.replaceReference(key, `\n@inproceedings{${key},\n  title = {Attention}\n}\n`, await hash());
    expect(await vault.references()).toContain(`@inproceedings{${key},\n  title = {Attention}\n}\n\n@comment{keep this too}`);
    for (const bad of ["@article{other, title = {x}}", `@article{${key}, title = {x}`, `@article{${key}, title = {x}} stray`, "just words"]) {
      await expect(vault.replaceReference(key, bad, await hash())).rejects.toThrow();
    }
  });

  it("suggests a key from who, when and what, numbered when taken", async () => {
    const vault = new MemoryVault({ [PROJECT]: "---\ntitle: Trip\n---\n", "extra.bib": "@article{Doe2020Deep, title = {x}}\n" });
    expect(await vault.suggestKey({ author: "Vaswani, Ashish and Shazeer, Noam", year: "2017", title: "Attention is all you need" })).toBe("vaswani2017attention");
    expect(await vault.suggestKey({ author: "Ashish Vaswani and Noam Shazeer", year: "2017", title: "The Attention" })).toBe("vaswani2017attention");
    expect(await vault.suggestKey({ author: "Müller, Jörg", year: "in 2019 (preprint)", title: "Über {BERT}" })).toBe("muller2019uber");
    expect(await vault.suggestKey({})).toBe("ref");
    expect(await vault.suggestKey({ author: "Doe, Jane", year: "2020", title: "Deep learning" })).toBe("doe2020deep-2");
  });
});

describe("citations and key renames in the preview", () => {
  const DECK = '{"format":"kasten-deck","formatVersion":1,"slides":[{"id":"s1","elements":[{"id":"c1","type":"citation","keys":["old2020thing","other2019"]}]}],"theme":{"layouts":[{"name":"t","elements":[{"id":"l","type":"citation","keys":["old2020thing"]}]}]},"title":"Talk"}';

  it("reads the forms Pandoc writes and not addresses, links or code", () => {
    const keys = (text: string) => citations(text).map((c) => text.slice(c.start, c.end));
    expect(keys("[@a] and [see @b; @c, p. 4] and [-@d]")).toEqual(["a", "b", "c", "d"]);
    expect(keys("a@b.com [a@b.com] [[@a]] [@a](http://x) `[@a]` \\[@a]")).toEqual([]);
    expect(keys("```\n[@a]\n```\n[@z]")).toEqual(["z"]);
    expect(keys("---\ntags: [@a]\n---\n[@y]")).toEqual(["y"]);
    expect(countOf("[@a] [@ab] [@a]", "a")).toBe(2);
    expect(renameIn("[@a, p. 4] [@ab] `[@a]`", "a", "longer")).toBe("[@longer, p. 4] [@ab] `[@a]`");
  });

  it("renames a key in the bibliography, the pages that cite it and the decks' slides, and says what stays", async () => {
    const vault = new MemoryVault({
      [PROJECT]: "---\ntitle: Trip\n---\n",
      "library/a.md": "---\ntitle: A\n---\nSee [@old2020thing, p. 4] and [see @other2019; @old2020thing].\n",
      "library/talk.deck": DECK,
      [MANAGED_BIB]: "@article{old2020thing, title = {A thing}}\n@article{other2019, title = {Another}}\n",
    });
    const hash = (await vault.bibliography()).managed.hash;
    const plan = await vault.planKeyRename("old2020thing", "new2020thing");
    expect(plan.bibHash).toBe(hash);
    expect(plan.pages.map((p) => [p.path, p.count])).toEqual([["library/a.md", 2]]);
    expect(plan.decks.map((d) => [d.path, d.count, d.inLayouts])).toEqual([["library/talk.deck", 1, 1]]);
    const done = await vault.renameCitationKey("old2020thing", "new2020thing", plan.bibHash);
    expect([done.pages, done.decks, done.layouts]).toEqual([1, 1, 1]);
    expect(await vault.references()).toContain("@article{new2020thing, title = {A thing}}");
    expect((await vault.read("library/a.md")).text).toContain("[@new2020thing, p. 4] and [see @other2019; @new2020thing]");
    const deck = JSON.parse((await vault.deck("library/talk.deck")).text);
    expect(deck.slides[0].elements[0].keys).toEqual(["new2020thing", "other2019"]);
    expect(deck.theme.layouts[0].elements[0].keys).toEqual(["old2020thing"]);
  });

  it("refuses a rename to a key that is there, from a key in an external file, or from a stale file", async () => {
    const vault = new MemoryVault({ [PROJECT]: "---\ntitle: Trip\n---\n", [MANAGED_BIB]: "@article{one, title = {x}}\n@article{two, title = {y}}\n", "ext.bib": "@book{outer, title = {z}}\n" });
    await expect(vault.planKeyRename("one", "TWO")).rejects.toThrow(/already a key/);
    await expect(vault.planKeyRename("outer", "fresh")).rejects.toThrow(/read only/);
    await expect(vault.planKeyRename("one", "has space")).rejects.toThrow(/cannot be a key/);
    await expect(vault.planKeyRename("nobody", "fresh")).rejects.toThrow(/no reference with the key/);
    await expect(vault.renameCitationKey("one", "fresh", "stale")).rejects.toThrow(/changed since/);
  });

  it("says exporting needs the desktop app", async () => {
    await expect(empty().planExport("trip")).rejects.toThrow(/desktop app/);
  });

  function empty() {
    return new MemoryVault({ [PROJECT]: "---\ntitle: Trip\n---\n" });
  }
});

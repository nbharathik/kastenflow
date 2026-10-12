// The preview's find and replace behaves as the core's (crates/kasten-core/
// src/replace/tests.rs and tests/core/replace.rs), case for case.

import { describe, expect, it } from "vitest";

import type { FindSpec, NoteMatches, ReplaceRequest } from "../../../lib/vault/types";
import { MemoryVault } from "./memory-vault";
import { checkSpec, checkWith, findInBody, replaceInBody, samplesOf, titleMatches } from "./replace-text";

const spec = (query: string, more: Partial<FindSpec> = {}): FindSpec => ({ query, matchCase: false, wholeWord: false, ...more });
const count = (body: string, s: FindSpec) => findInBody(body, s).length;
const replaced = (body: string, s: FindSpec, withText: string) => replaceInBody(body, s, withText).text;

describe("matching", () => {
  it("matches with or without case in any script", () => {
    const body = "Straße straße STRASSE\nÄrger ärger ÄRGER\n";
    expect(count(body, spec("straße"))).toBe(2);
    expect(count(body, spec("straße", { matchCase: true }))).toBe(1);
    expect(count(body, spec("ärger"))).toBe(3);
    expect(findInBody(body, spec("ärger")).map((f) => body.slice(f.start, f.end))).toEqual(["Ärger", "ärger", "ÄRGER"]);
  });

  it("whole word means no letter, digit or underscore beside the match", () => {
    const body = "cat cat_1 cat2 concat cats (cat) cat. Cat-like\n";
    expect(count(body, spec("cat"))).toBe(8);
    expect(count(body, spec("cat", { wholeWord: true }))).toBe(4);
    expect(count(body, spec("cat", { wholeWord: true, matchCase: true }))).toBe(3);
    expect(count("Ärger Ärgerlich ärger_ ÄÄrger über überall\n", spec("ärger", { wholeWord: true }))).toBe(1);
    expect(count("café cafe", spec("cafe", { wholeWord: true }))).toBe(1);
  });

  it("does not overlap or cross lines", () => {
    expect(count("aaaa", spec("aa"))).toBe(2);
    expect(replaced("aaaaa", spec("aa"), "b")).toBe("bba");
    expect(count("foo\nbar", spec("foo bar"))).toBe(0);
  });

  it("skips what is not prose but matches text between tags", () => {
    const body = [
      "plain foo here",
      "see [[foo]] and [[foo|foo alias]] and ![[foo]]",
      'a [foo](https://foo.example/foo "foo title") link',
      "an ![foo](foo.png) picture",
      "auto <https://foo.example> and <me@foo.example> done",
      '<a href="foo">foo</a> html',
      "<details>",
      "<summary>foo title</summary>",
      "",
      "visit https://foo.example/foo now, foo",
      "[foo]: https://foo.example/foo",
      "[^1]: foo note",
      "> [!tip] foo callout",
      "- [ ] foo task",
      "",
    ].join("\n");
    expect(findInBody(body, spec("foo")).map((f) => f.line)).toEqual([0, 2, 3, 5, 7, 9, 11, 12, 13]);
    const out = replaced(body, spec("foo"), "BAR");
    expect(out).toContain("see [[foo]] and [[foo|foo alias]] and ![[foo]]\n");
    expect(out).toContain('a [BAR](https://foo.example/foo "foo title") link\n');
    expect(out).toContain('<a href="foo">BAR</a> html\n');
    expect(out).toContain("<summary>BAR title</summary>\n");
    expect(out).toContain("visit https://foo.example/foo now, BAR\n");
    expect(out).toContain("[foo]: https://foo.example/foo\n");
    expect(out).toContain("> [!tip] BAR callout\n");
  });

  it("a match that reaches into a protected span is not one", () => {
    expect(count("see [[foo bar]] now", spec("see [[foo"))).toBe(0);
    expect(count("a [x](url) b", spec("x](url)"))).toBe(0);
    expect(count("foo [[foo]] foo", spec("foo"))).toBe(2);
    expect(count("[a][foo] and foo", spec("foo"))).toBe(1);
    expect(count('<a title="x > foo">foo</a>', spec("foo"))).toBe(1);
    expect(count("a \\[[foo]] b", spec("foo"))).toBe(1);
    expect(count("a [[foo and foo", spec("foo"))).toBe(2);
    expect(count("<!-- foo\nstill foo\n--> foo", spec("foo"))).toBe(1);
  });
});

describe("writing the replacement", () => {
  it("escapes prose and writes code raw", () => {
    const body = "prose foo and `foo` and ``a ` foo``\n\n```rust\nlet foo = 1;\n```\n\nafter foo\n";
    expect(count(body, spec("foo"))).toBe(5);
    const raw = "a*b_c [x] <y> | ~ $ \\";
    const escaped = "a\\*b_c \\[x\\] \\<y\\> \\| \\~ \\$ \\\\";
    const out = replaced(body, spec("foo"), raw);
    expect(out.startsWith(`prose ${escaped} and \`${raw}\` and \`\`a \` ${raw}\`\`\n`)).toBe(true);
    expect(out).toContain(`\`\`\`rust\nlet ${raw} = 1;\n\`\`\`\n`);
    expect(out.endsWith(`after ${escaped}\n`)).toBe(true);
    expect(count("```foo\nx\n```\n", spec("foo"))).toBe(0);
  });

  it("leaves an underscore inside a word and an ampersand that is no entity", () => {
    expect(replaced("x", spec("x"), "snake_case_name")).toBe("snake_case_name");
    expect(replaced("x", spec("x"), "_lead")).toBe("\\_lead");
    expect(replaced("x", spec("x"), "a _b_ c")).toBe("a \\_b\\_ c");
    expect(replaced("x", spec("x"), "AT&T")).toBe("AT&T");
    expect(replaced("x", spec("x"), "a &amp; b")).toBe("a \\&amp; b");
  });

  it("escapes what would start a block at the start of a line", () => {
    expect(replaced("old rest\n", spec("old"), "# New")).toBe("\\# New rest\n");
    expect(replaced("old rest\n", spec("old"), "- New")).toBe("\\- New rest\n");
    expect(replaced("old rest\n", spec("old"), "1. New")).toBe("1\\. New rest\n");
    expect(replaced("old rest\n", spec("old"), "12) New")).toBe("12\\) New rest\n");
    expect(replaced("> old rest\n", spec("old"), "# New")).toBe("> \\# New rest\n");
    expect(replaced("- old rest\n", spec("old"), "# New")).toBe("- \\# New rest\n");
    expect(replaced("a old\n", spec("old"), "# New")).toBe("a # New\n");
    expect(replaced("old\n", spec("old"), "2026 New")).toBe("2026 New\n");
  });

  it("escapes text between tags as HTML", () => {
    const out = replaced("<details>\n<summary>Old title</summary>\n\nOld body\n", spec("old"), "a < b & c &amp; *d*");
    expect(out).toBe("<details>\n<summary>a &lt; b & c &amp;amp; *d* title</summary>\n\na \\< b & c \\&amp; \\*d\\* body\n");
  });

  it("refuses a replacement that would break code", () => {
    expect(() => replaceInBody("a `foo` b", spec("foo"), "x`y")).toThrow(/backtick/);
    expect(replaced("a foo b", spec("foo"), "x`y")).toBe("a x\\`y b");
    expect(() => replaceInBody("```\nfoo\n```\n", spec("foo"), "```")).toThrow(/fence/);
  });

  it("keeps line endings and everything else", () => {
    const body = "Old one\r\nkeep  \r\n\r\nOld two  \r\n\tOld three\r\nlast Old";
    expect(replaced(body, spec("old"), "New")).toBe("New one\r\nkeep  \r\n\r\nNew two  \r\n\tNew three\r\nlast New");
    expect(replaced(body, spec("absent"), "New")).toBe(body);
    expect(replaced("a foo b\n", spec(" foo"), "")).toBe("a b\n");
  });

  it("shows the line around a match, and matches titles with the same options", () => {
    const body = "first line\nthe quick brown fox jumps over the lazy dog and more words after it\nfox\n";
    const found = findInBody(body, spec("fox"));
    const samples = samplesOf(body, found, 5);
    expect(samples[0]).toMatchObject({ line: 1, text: "fox", before: "the quick brown " });
    expect(samples[0]!.after.startsWith(" jumps over the lazy dog")).toBe(true);
    expect(samples[0]!.after.length).toBeLessThanOrEqual(40);
    expect(samples[1]).toEqual({ line: 2, before: "", text: "fox", after: "" });
    expect(titleMatches("Photo organiser", spec("ORGANISER"))).toBe(true);
    expect(titleMatches("Photo organiser", spec("ORGANISER", { matchCase: true }))).toBe(false);
    expect(titleMatches("Photo organisers", spec("organiser", { wholeWord: true }))).toBe(false);
  });

  it("limits the search and replacement text", () => {
    expect(() => checkSpec(spec("a"))).not.toThrow();
    expect(() => checkSpec(spec("x".repeat(200)))).not.toThrow();
    for (const bad of ["", "x".repeat(201), "a\nb", "a\tb", "a\u0000b", "a\u007fb"]) expect(() => checkSpec(spec(bad)), JSON.stringify(bad)).toThrow();
    expect(() => checkWith("")).not.toThrow();
    expect(() => checkWith("y".repeat(1000))).not.toThrow();
    for (const bad of ["y".repeat(1001), "a\nb", "a\r\nb", "a\tb"]) expect(() => checkWith(bad)).toThrow();
  });
});

const TOP = "---\nid: TOP\ntitle: Trip plan\ntags: [paris]\n---\nWe fly to Paris on Monday.\nSee [[Paris]] and [paris](https://paris.example/paris) and `paris` here.\n<summary>Paris summary</summary>\n> [!tip] Paris tip\n";
const MID = "---\r\nid: MID\r\ntitle: Paris notes\r\nparent: TOP\r\n---\r\nparis cafes  \r\n\tParis museums\r\nlast paris";
const LOW = "---\nid: LOW\ntitle: Low\nparent: MID\n---\nParis again, paris!\n";
const OTHER = "---\nid: OTHER\ntitle: Other\n---\nparis elsewhere\n";
const FILES = { "library/top.md": TOP, "library/mid.md": MID, "library/low.md": LOW, "library/other.md": OTHER };

const request = (root: string, s: FindSpec, withText: string, preview: NoteMatches[]): ReplaceRequest => ({
  root,
  spec: s,
  with: withText,
  expect: preview.map((n) => ({ path: n.path, hash: n.hash, count: n.count })),
});

describe("the preview vault's find and replace", () => {
  it("previews each page with its hash, count and samples, and writes nothing", async () => {
    const v = new MemoryVault({ ...FILES });
    const found = await v.findUnder("TOP", spec("paris"));
    expect(found.map((n) => [n.path, n.count])).toEqual([
      ["library/top.md", 5],
      ["library/low.md", 2],
      ["library/mid.md", 3],
    ]);
    expect(found[2]!.titleHit).toBe(true);
    expect(found[0]!.samples[0]).toMatchObject({ line: 0, before: "We fly to ", text: "Paris", after: " on Monday." });
    expect((await v.read("library/top.md")).text).toBe(TOP);
    // An id or a path; a cap; an unknown root.
    expect(await v.findUnder("library/mid.md", spec("paris"))).toEqual(await v.findUnder("MID", spec("paris")));
    expect(await v.findUnder("TOP", spec("paris"), 2)).toHaveLength(2);
    await expect(v.findUnder("NOPE", spec("paris"))).rejects.toThrow();
  });

  it("replaces in every page under the root and nowhere else", async () => {
    const v = new MemoryVault({ ...FILES });
    const found = await v.findUnder("TOP", spec("paris"));
    const done = await v.replaceUnder(request("TOP", spec("paris"), "Rome", found));
    expect(done.total).toBe(10);
    expect([...done.notes].sort()).toEqual([
      ["library/low.md", 2],
      ["library/mid.md", 3],
      ["library/top.md", 5],
    ]);
    expect((await v.read("library/top.md")).text).toBe(
      "---\nid: TOP\ntitle: Trip plan\ntags: [paris]\n---\nWe fly to Rome on Monday.\nSee [[Paris]] and [Rome](https://paris.example/paris) and `Rome` here.\n<summary>Rome summary</summary>\n> [!tip] Rome tip\n",
    );
    expect((await v.read("library/mid.md")).text).toBe("---\r\nid: MID\r\ntitle: Paris notes\r\nparent: TOP\r\n---\r\nRome cafes  \r\n\tRome museums\r\nlast Rome");
    expect((await v.read("library/other.md")).text).toBe(OTHER);
  });

  it("refuses, writing nothing, when a page changed, is locked, or is not under the root", async () => {
    const v = new MemoryVault({ ...FILES });
    const found = await v.findUnder("TOP", spec("paris"));
    const beside = await v.findUnder("OTHER", spec("paris"));
    const outside = request("TOP", spec("paris"), "Rome", found);
    outside.expect.push(...request("OTHER", spec("paris"), "Rome", beside).expect);
    await expect(v.replaceUnder(outside)).rejects.toThrow(/library\/other\.md/);
    for (const bad of [".trash/x.md", ".kasten/config.yaml", "library/top.txt", "../x.md", "/etc/x.md"]) {
      const req = request("TOP", spec("paris"), "Rome", found);
      req.expect.push({ path: bad, hash: "0", count: 1 });
      await expect(v.replaceUnder(req), bad).rejects.toThrow();
    }
    const stale = request("TOP", spec("paris"), "Rome", found);
    stale.expect[0]!.count += 1;
    await expect(v.replaceUnder(stale)).rejects.toThrow(/changed since the preview/);
    const many = request("TOP", spec("paris"), "Rome", found);
    many.expect = Array.from({ length: 201 }, (_, i) => ({ path: `library/n${i}.md`, hash: "0", count: 1 }));
    await expect(v.replaceUnder(many)).rejects.toThrow(/200/);
    const big = request("TOP", spec("paris"), "Rome", found);
    big.expect[0]!.count = 5001;
    await expect(v.replaceUnder(big)).rejects.toThrow(/5,000/);
    await expect(v.replaceUnder({ ...request("TOP", spec("paris"), "Rome", found), expect: [] })).rejects.toThrow();
    expect((await v.read("library/top.md")).text).toBe(TOP);

    const locked = new MemoryVault({ ...FILES, "library/low.md": LOW.replace("title: Low\n", "title: Low\nlocked: true\n") });
    const listed = await locked.findUnder("TOP", spec("paris"));
    expect(listed.find((n) => n.path === "library/low.md")!.locked).toBe(true);
    await expect(locked.replaceUnder(request("TOP", spec("paris"), "Rome", listed))).rejects.toThrow(/locked/);
    expect((await locked.read("library/top.md")).text).toBe(TOP);
  });

  it("notices a page that changed since the preview", async () => {
    const v = new MemoryVault({ ...FILES });
    const found = await v.findUnder("TOP", spec("paris"));
    const low = await v.read("library/low.md");
    await v.saveBody("library/low.md", "Paris once more.\n", low.hash);
    await expect(v.replaceUnder(request("TOP", spec("paris"), "Rome", found))).rejects.toThrow(/changed since the preview/);
    expect((await v.read("library/top.md")).text).toBe(TOP);
  });
});

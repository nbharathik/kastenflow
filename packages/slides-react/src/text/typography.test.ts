// @vitest-environment node

import type { Text, Theme } from "@kasten-slides/wasm";
import { beforeAll, describe, expect, it } from "vitest";

import { addressIn } from "./autolink.ts";
import { ALL_ON } from "./prefs.ts";
import { type Rig, rig, textOf } from "./test-state.ts";
import { themeNamed } from "./test-support.ts";
import { substitution, typed } from "./typography.ts";

let light: Rig;

beforeAll(async () => {
  const theme: Theme = await themeNamed("Light");
  light = rig(theme, "body");
});

const text = (words: string, extra: Partial<Text["paragraphs"][number]> = {}): Text => ({ paragraphs: [{ runs: [{ t: words }], ...extra }] });
const both = { autocorrect: true, smartQuotes: true };

describe("what a typed character turns into", () => {
  it("makes dashes of hyphens: two are an en dash, a third an em dash", () => {
    expect(substitution("a-", "-", both)).toEqual({ take: 1, put: "–" });
    expect(substitution("a–", "-", both)).toEqual({ take: 1, put: "—" });
    expect(substitution("a", "-", both)).toBeNull();
    // Three hyphens typed in a row are not read as two again.
    expect(substitution("a--", "-", both)).toBeNull();
  });

  it("makes an ellipsis of three dots and leaves two", () => {
    expect(substitution("wait..", ".", both)).toEqual({ take: 2, put: "…" });
    expect(substitution("wait.", ".", both)).toBeNull();
    expect(substitution("wait...", ".", both)).toBeNull();
  });

  it("makes signs of (c), (r) and (tm), in either case", () => {
    expect(substitution("a (c", ")", both)).toEqual({ take: 2, put: "©" });
    expect(substitution("a (R", ")", both)).toEqual({ take: 2, put: "®" });
    expect(substitution("a (TM", ")", both)).toEqual({ take: 3, put: "™" });
    expect(substitution("a (x", ")", both)).toBeNull();
  });

  it("makes arrows of -> and =>", () => {
    expect(substitution("a -", ">", both)).toEqual({ take: 1, put: "→" });
    expect(substitution("a =", ">", both)).toEqual({ take: 1, put: "⇒" });
    expect(substitution("a ==", ">", both)).toBeNull();
  });

  it("makes curly quotes: opening after a space or bracket, closing after a word", () => {
    expect(substitution("", '"', both)?.put).toBe("“");
    expect(substitution("say ", '"', both)?.put).toBe("“");
    expect(substitution("(", '"', both)?.put).toBe("“");
    expect(substitution("said", '"', both)?.put).toBe("”");
    expect(substitution("it", "'", both)?.put).toBe("’");
    expect(substitution("say ", "'", both)?.put).toBe("‘");
    expect(substitution("“quoted", '"', both)?.put).toBe("”");
  });

  it("makes an emoji of :name: and leaves what is not one", () => {
    expect(substitution("good :smile", ":", both)).toEqual({ take: 6, put: "😄" });
    expect(substitution(":+1", ":", both)?.put).toBe("👍");
    expect(substitution("at 12:30", ":", both)).toBeNull();
    expect(substitution("a :nosuchthing", ":", both)).toBeNull();
    expect(substitution("http", ":", both)).toBeNull();
  });

  it("does nothing when the choices are off", () => {
    expect(substitution("a-", "-", { autocorrect: false, smartQuotes: true })).toBeNull();
    expect(substitution("say ", '"', { autocorrect: true, smartQuotes: false })).toBeNull();
    expect(substitution("say ", '"', { autocorrect: false, smartQuotes: true })?.put).toBe("“");
  });
});

describe("typing in the editor", () => {
  const caretAt = (base: Text, at: [number, number]) => light.state(base, at);
  const type = (base: Text, at: [number, number], char: string) => {
    let state = caretAt(base, at);
    const handled = typed(state, state.selection.from, state.selection.to, char, ALL_ON, (tr) => {
      state = state.apply(tr);
    });
    return { state, handled };
  };

  it("replaces what was typed, as its own step of undo", () => {
    const base = text("a-");
    const { state, handled } = type(base, [0, 2], "-");
    expect(handled).toBe(true);
    expect(textOf(state, base).paragraphs[0]?.runs[0]?.t).toBe("a–");
  });

  it("types an ordinary character as it is", () => {
    const base = text("a-");
    expect(type(base, [0, 2], "b").handled).toBe(false);
  });

  it("leaves inline code as it is typed", () => {
    const base: Text = { paragraphs: [{ runs: [{ t: "x-", code: true }] }] };
    expect(type(base, [0, 2], "-").handled).toBe(false);
  });

  it("keeps the formatting of the words it replaces", () => {
    const base: Text = { paragraphs: [{ runs: [{ t: "bold...", b: true }] }] };
    // Two dots are typed; the third makes the ellipsis, in bold.
    const short: Text = { paragraphs: [{ runs: [{ t: "bold..", b: true }] }] };
    const { state } = type(short, [0, 6], ".");
    expect(textOf(state, base).paragraphs[0]?.runs).toEqual([{ t: "bold…", b: true }]);
  });

  it("makes a link of an address when the space after it is typed", () => {
    const base = text("see https://example.com/page.");
    const { state, handled } = type(base, [0, 29], " ");
    // The address is marked and the space is typed as usual afterwards, by the editor.
    expect(handled).toBe(false);
    expect(textOf(state, base).paragraphs[0]?.runs).toEqual([{ t: "see " }, { t: "https://example.com/page", link: "https://example.com/page" }, { t: "." }]);
  });

  it("makes a list of a marker typed at the start of a paragraph", () => {
    const base = text("1.");
    const { state, handled } = type(base, [0, 2], " ");
    expect(handled).toBe(true);
    expect(textOf(state, base).paragraphs).toEqual([{ runs: [{ t: "" }], list: "number" }]);
  });
});

describe("the address in a word", () => {
  it("is a web address, a www address or a mail address, without the punctuation after it", () => {
    expect(addressIn("https://example.com/a?b=1")).toEqual({ href: "https://example.com/a?b=1", length: 25 });
    expect(addressIn("https://example.com.")).toEqual({ href: "https://example.com", length: 19 });
    expect(addressIn("www.example.com,")).toEqual({ href: "https://www.example.com", length: 15 });
    expect(addressIn("me@example.com")).toEqual({ href: "mailto:me@example.com", length: 14 });
    expect(addressIn("(https://example.com/a_(b))")?.length).toBeUndefined();
    expect(addressIn("https://en.wikipedia.org/wiki/Foo_(bar)")).toEqual({ href: "https://en.wikipedia.org/wiki/Foo_(bar)", length: 39 });
  });

  it("is not an address in an ordinary word, a bare domain or a scheme that must not be followed", () => {
    expect(addressIn("hello")).toBeNull();
    expect(addressIn("example.com")).toBeNull();
    expect(addressIn("javascript:alert(1)")).toBeNull();
    expect(addressIn("http://")).toBeNull();
    expect(addressIn("1.5")).toBeNull();
  });
});

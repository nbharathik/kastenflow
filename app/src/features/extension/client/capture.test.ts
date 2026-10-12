// What is read from a page becomes a capture Kasten takes: under its size, with
// tags that are tags, and the four right-click choices.

import { describe, expect, it } from "vitest";

import { MAX_BYTES, MENU_ITEMS, build, fit, parseTags, requestFromMenu } from "../../../../../browser-extension/src/capture";
import type { PageRead } from "../../../../../browser-extension/src/env";
import { isWebPage } from "../../../../../browser-extension/src/page";
import { READ, TAB } from "./kit";

const inbox = { kind: "inbox" } as const;
const size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const base = { url: "https://example.com/a", title: "A page", target: inbox, tags: [] };

describe("tags", () => {
  it("are words, with or without #, in any list, each once", () => {
    expect(parseTags("reading, #rust async;Rust  later/now x_y-z")).toEqual({ tags: ["reading", "rust", "async", "later/now", "x_y-z"], bad: [] });
    expect(parseTags("")).toEqual({ tags: [], bad: [] });
    expect(parseTags("  ,, ")).toEqual({ tags: [], bad: [] });
  });

  it("that cannot be tags are said, and the rest are kept", () => {
    expect(parseTags("ok a:b <x> é " + "z".repeat(41))).toEqual({ tags: ["ok", "é"], bad: ["a:b", "<x>", "z".repeat(41)] });
  });

  it("are at most eight", () => {
    const parsed = parseTags("a b c d e f g h i j");
    expect(parsed.tags).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
    expect(parsed.bad).toEqual(["i", "j"]);
  });
});

describe("web pages", () => {
  it("are http and https addresses of a site, with no name and password", () => {
    for (const ok of ["https://example.com", "http://example.com/a?b#c", "HTTPS://Example.com:8080/x", "http://localhost:3000"]) expect(isWebPage(ok), ok).toBe(true);
    for (const bad of ["chrome://extensions", "file:///C:/x.html", "javascript:alert(1)", "https://u:p@example.com/", "https:///x", "about:blank", "", undefined]) expect(isWebPage(bad), String(bad)).toBe(false);
  });
});

describe("fitting text", () => {
  it("leaves what fits, and cuts the rest at a line or a space", () => {
    expect(fit("short", 100)).toEqual({ text: "short", cut: false });
    const long = `${"word ".repeat(50)}\n${"more ".repeat(50)}`;
    const cut = fit(long, 120);
    expect(cut.cut).toBe(true);
    expect(new TextEncoder().encode(cut.text).length).toBeLessThanOrEqual(120);
    expect(cut.text.endsWith("word")).toBe(true);
  });

  it("counts bytes, not letters", () => {
    const cut = fit("é".repeat(100), 50);
    expect(cut.cut).toBe(true);
    expect(new TextEncoder().encode(cut.text).length).toBeLessThanOrEqual(50);
  });
});

describe("a capture", () => {
  it("of the selection sends it as markup, with the title, the place and the tags", () => {
    const built = build({ ...base, read: READ, what: "selection", tags: ["reading"] });
    expect(built).toEqual({ kept: "selection", cut: false, request: { url: "https://example.com/a", title: "A page", target: inbox, tags: ["reading"], html: "<p>One idea per note.</p>" } });
  });

  it("of the page sends its markup, and no tags when there are none", () => {
    const built = build({ ...base, read: READ, what: "page" });
    expect(built.kept).toBe("page");
    expect(built.request.html).toBe(READ.html);
    expect("tags" in built.request).toBe(false);
  });

  it("of a page too big for its markup sends its text, and of text too big the start of it", () => {
    const heavy: PageRead = { ...READ, html: `<p>${"x".repeat(MAX_BYTES)}</p>`, text: "Plain words." };
    const second = build({ ...base, read: heavy, what: "page" });
    expect([second.kept, second.cut, second.request.text, second.request.html]).toEqual(["text", false, "Plain words.", undefined]);

    const huge: PageRead = { ...READ, html: `<p>${"x ".repeat(MAX_BYTES)}</p>`, text: "line of words\n".repeat(MAX_BYTES / 10) };
    const third = build({ ...base, read: huge, what: "page" });
    expect(third.kept).toBe("text");
    expect(third.cut).toBe(true);
    expect(size(third.request)).toBeLessThanOrEqual(MAX_BYTES);
    expect(third.request.html).toBeUndefined();
    expect(third.request.text!.length).toBeGreaterThan(1_000_000);
  });

  it("with nothing to take, or a page that cannot be read, is the link alone", () => {
    expect(build({ ...base, read: READ, what: "link" })).toEqual({ kept: "link", cut: false, request: { url: "https://example.com/a", title: "A page", target: inbox } });
    expect(build({ ...base, read: null, what: "page" }).kept).toBe("link");
    expect(build({ ...base, read: { ...READ, selectionHtml: " ", selectionText: "" }, what: "selection" }).kept).toBe("link");
  });

  it("keeps only the text of a selection that has no markup, and cuts a long title", () => {
    const plain = build({ ...base, read: { ...READ, selectionHtml: "" }, what: "selection", title: "T".repeat(500) });
    expect([plain.kept, plain.request.text, plain.request.html]).toEqual(["selection", "One idea per note.", undefined]);
    expect(plain.request.title).toHaveLength(300);
  });
});

describe("the right-click menu", () => {
  const read = (page: PageRead | null) => () => Promise.resolve(page);
  const click = (menuItemId: string, more: object = {}) => ({ menuItemId, pageUrl: TAB.url, ...more });

  it("has an entry for the page, the selection, a link and a picture", () => {
    expect(MENU_ITEMS.map((i) => [i.id, i.contexts[0]])).toEqual([
      ["kasten-selection", "selection"],
      ["kasten-link", "link"],
      ["kasten-image", "image"],
      ["kasten-page", "page"],
    ]);
  });

  it("sends the page as read from the tab, at the tab's own address", async () => {
    const built = await requestFromMenu(click("kasten-page", { pageUrl: "https://evil.example/" }), TAB, read(READ), inbox);
    expect(built.request).toMatchObject({ url: TAB.url, title: "Slip-box basics", html: READ.html, target: inbox });
    // A page that cannot be read is its link.
    expect((await requestFromMenu(click("kasten-page"), TAB, read(null), inbox)).kept).toBe("link");
  });

  it("sends the selection as read, or the text the browser gave when the tab cannot be read", async () => {
    const read1 = await requestFromMenu(click("kasten-selection", { selectionText: "From the menu" }), TAB, read(READ), inbox);
    expect(read1.request.html).toBe("<p>One idea per note.</p>");
    const read2 = await requestFromMenu(click("kasten-selection", { selectionText: "From the menu" }), TAB, read(null), inbox);
    expect([read2.kept, read2.request.text]).toEqual(["selection", "From the menu"]);
  });

  it("sends a link as its address, titled by the words selected on it", async () => {
    const built = await requestFromMenu(click("kasten-link", { linkUrl: "https://example.org/next", selectionText: "Next page" }), TAB, read(READ), { kind: "project", project: "trip" });
    expect(built.request).toEqual({ url: "https://example.org/next", title: "Next page", target: { kind: "project", project: "trip" } });
    await expect(requestFromMenu(click("kasten-link", { linkUrl: "javascript:alert(1)" }), TAB, read(READ), inbox)).rejects.toThrow("Only web addresses");
    await expect(requestFromMenu(click("kasten-link", { linkUrl: "mailto:a@b.c" }), TAB, read(READ), inbox)).rejects.toThrow("Only web addresses");
  });

  it("sends a picture as a picture in the page it is on, and refuses one that is not a web address", async () => {
    const built = await requestFromMenu(click("kasten-image", { srcUrl: 'https://cdn.example.com/p.png?a=1&b="2"' }), TAB, read(null), inbox);
    expect(built.request.url).toBe(TAB.url);
    expect(built.request.html).toBe('<p><img src="https://cdn.example.com/p.png?a=1&amp;b=&quot;2&quot;" alt=""></p>');
    await expect(requestFromMenu(click("kasten-image", { srcUrl: "data:image/png;base64,AAAA" }), TAB, read(null), inbox)).rejects.toThrow("not a web address");
    await expect(requestFromMenu(click("kasten-image", { srcUrl: "blob:https://example.com/1" }), TAB, read(null), inbox)).rejects.toThrow("not a web address");
  });

  it("sends nothing from a page that is not a web page, or for an entry it does not know", async () => {
    const own = { id: 1, url: "chrome://extensions", title: "Extensions" };
    await expect(requestFromMenu(click("kasten-page", { pageUrl: own.url }), own, read(READ), inbox)).rejects.toThrow("Only web pages");
    await expect(requestFromMenu(click("kasten-selection", { pageUrl: own.url }), own, read(READ), inbox)).rejects.toThrow("Only web pages");
    await expect(requestFromMenu(click("kasten-image", { pageUrl: own.url, srcUrl: "https://x.example/p.png" }), own, read(READ), inbox)).rejects.toThrow("Only pictures");
    await expect(requestFromMenu(click("kasten-other"), TAB, read(READ), inbox)).rejects.toThrow("does not know");
  });
});

// "Export as HTML file": one file with the kit, the page and the data of the
// moment inside; it opens on its own, reads from its saved answers, refuses
// every write, and has no way to send a message or reach the network.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildExportHtml, withoutPosting, type ExportInput } from "./export-html";
import { keyOf, type SnapshotEntry } from "./snapshot";

const KIT_RAW = import.meta.glob<string>(["../../../smart-kit/*.js", "../../../smart-kit/*.css", "../../../smart-kit/lib/*.js", "../../../smart-kit/components/*.js", "../../../smart-kit/data/world-110m.js"], { query: "?raw", import: "default", eager: true });
const STARTER_RAW = import.meta.glob<string>("../../../smart-kit/starters/*/*", { query: "?raw", import: "default", eager: true });

const KIT: Record<string, string> = Object.fromEntries(Object.entries(KIT_RAW).filter(([k]) => !k.endsWith(".test.ts")).map(([k, v]) => [k.replace("../../../smart-kit/", ""), v]));
const starter = (slug: string): Record<string, string> =>
  Object.fromEntries(
    Object.entries(STARTER_RAW)
      .filter(([k]) => k.includes(`/starters/${slug}/`) && !k.endsWith("page.md"))
      .map(([k, v]) => [k.split("/").pop()!, v]),
  );

const NOTES = [
  { id: "a", title: "Write intro", props: { status: "done" } },
  { id: "b", title: "Run study", props: { status: "doing" } },
  { id: "c", title: "Submit", props: { status: "todo" } },
];
const SNAPSHOT: SnapshotEntry[] = [{ key: keyOf("query", { tag: "tracked" }), kind: "query", args: { tag: "tracked" }, value: NOTES }];

function input(extra: Partial<ExportInput> = {}): ExportInput {
  return { title: "My dashboard", files: starter("dashboard"), kit: KIT, snapshot: SNAPSHOT, day: "2026-10-23", ...extra };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

/** "Opens" an exported file in this window: its markup, then its scripts in order. */
async function open(html: string) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const scripts = Array.from(parsed.querySelectorAll("script")).map((s) => s.textContent ?? "");
  document.documentElement.innerHTML = parsed.documentElement.innerHTML.replace(/<script[\s\S]*?<\/script>/g, "");
  for (const code of scripts) (0, eval)(code);
  await settle();
  return parsed;
}

describe("the saved copy", () => {
  it("is one file: the kit, the page's script and style inline, nothing to load", () => {
    const { html, left } = buildExportHtml(input());
    expect(left).toEqual([]);
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelectorAll("link").length).toBe(0);
    expect(doc.querySelectorAll("script[src]").length).toBe(0);
    expect(html).not.toContain("smart://");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("A saved copy of “My dashboard” from KastenFlow, 2026-10-23");
    expect(doc.querySelectorAll("style").length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("kasten.watch");
  });

  it("allows nothing from the network", () => {
    const { html } = buildExportHtml(input());
    const doc = new DOMParser().parseFromString(html, "text/html");
    const policy = doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content") ?? "";
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("connect-src 'none'");
    expect(policy).not.toMatch(/https?:|\*/);
    // The policy comes before any script or style, right after the character set.
    const first = Array.from(doc.head.children).slice(0, 2).map((e) => e.getAttribute("http-equiv") ?? e.getAttribute("charset"));
    expect(first).toEqual(["utf-8", "Content-Security-Policy"]);
  });

  it("has no way to post a message: not in the kit, not in the stand-in", () => {
    const { html } = buildExportHtml(input());
    expect(html).not.toMatch(/postMessage/);
    expect(html).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts/);
  });

  it("refuses a kit that can still post", () => {
    expect(() => withoutPosting("x.parent.postMessage(1)", "kit.js")).toThrow(/cannot be made safely/);
    expect(withoutPosting("var a = 1;", "lib.js")).toBe("var a = 1;");
  });

  it("makes safe inline text out of a script or style that holds a closing tag", () => {
    const files = { "index.html": '<html><head><script src="app.js"></script></head><body></body></html>', "app.js": 'var s = "</script><b>";' };
    const { html } = buildExportHtml(input({ files }));
    expect(new DOMParser().parseFromString(html, "text/html").querySelectorAll("script").length).toBeGreaterThanOrEqual(1);
    expect(html).not.toContain('"</script><b>"');
  });

  it("names what it could not put inside and takes it out", () => {
    const files = { "index.html": '<html><head><script src="https://cdn.example/x.js"></script><link rel="stylesheet" href="missing.css"><script src="../up.js"></script></head><body><img src="nope.png"></body></html>' };
    const { html, left } = buildExportHtml(input({ files }));
    expect([...left].sort()).toEqual(["../up.js", "https://cdn.example/x.js", "missing.css", "nope.png"]);
    expect(html).not.toContain("cdn.example");
    expect(html).not.toContain("up.js");
  });

  it("puts pictures of the page's folder inside as data addresses", () => {
    const files = { "index.html": '<html><body><img id="a" src="assets/pin.svg"><img id="b" src="assets/p.png"></body></html>', "assets/pin.svg": "<svg/>", "assets/p.png": new Uint8Array([137, 80, 78, 71]) };
    const { html } = buildExportHtml(input({ files }));
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.getElementById("a")?.getAttribute("src")).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(doc.getElementById("b")?.getAttribute("src")).toBe(`data:image/png;base64,${btoa(String.fromCharCode(137, 80, 78, 71))}`);
  });

  it("refuses a page with no index.html", () => {
    expect(() => buildExportHtml(input({ files: { "app.js": "" } }))).toThrow(/no index\.html/);
  });
});

describe("hostile text in the page or the data", () => {
  const BREAK = "</script><script>window.__pwned = 1; alert(1)</script><!--";
  const scriptsOf = (html: string) => Array.from(new DOMParser().parseFromString(html, "text/html").querySelectorAll("script"));

  it("a note whose title closes the script and starts another cannot run anything", async () => {
    const plain = buildExportHtml(input()).html;
    const hostile = buildExportHtml(input({ snapshot: [{ ...SNAPSHOT[0]!, value: [{ id: "x", title: BREAK, props: { status: "todo" } }] }] })).html;
    expect(scriptsOf(hostile).length).toBe(scriptsOf(plain).length);
    // Opened and run: nothing executes, and the title comes through as text.
    const alert = vi.fn();
    (window as unknown as { alert: unknown }).alert = alert;
    delete (window as unknown as { __pwned?: unknown }).__pwned;
    delete (window as unknown as { kasten?: unknown }).kasten;
    delete (window as unknown as { kit?: unknown }).kit;
    await open(hostile);
    const kasten = (window as unknown as { kasten: { query(tag: string): Promise<{ title: string }[]> } }).kasten;
    expect((await kasten.query("tracked"))[0]?.title).toBe(BREAK);
    expect(alert).not.toHaveBeenCalled();
    expect((window as unknown as { __pwned?: unknown }).__pwned).toBeUndefined();
    document.documentElement.innerHTML = "<head></head><body></body>";
  });

  it("a page title and a note title cannot close the title, the comment or the file's first lines", () => {
    const title = `--></title></head><script>window.__pwned = 2</script><!-- ${BREAK}`;
    const { html } = buildExportHtml(input({ title, files: { "index.html": "<html><head></head><body><p>x</p></body></html>" } }));
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.title).toBe(title);
    for (const script of Array.from(doc.querySelectorAll("script"))) expect(script.textContent).not.toMatch(/__pwned\s*=\s*2/);
    expect(html.split("\n")[1]).toMatch(/^<!-- A saved copy of .* -->$/);
    expect(html.slice(0, html.indexOf("<html")).match(/-->/g)?.length).toBe(1);
  });

  it("a page's own script that holds a closing tag, a comment opener or the end of a style stays inside its element", () => {
    const files = {
      "index.html": '<html><head><link rel="stylesheet" href="s.css"><script src="a.js"></script></head><body></body></html>',
      "a.js": 'var a = "</script><script>window.__pwned = 3</script>", b = "<!--<script>", c = "</SCRIPT >";',
      "s.css": 'body::after { content: "</style><script>window.__pwned = 4</script>"; }',
    };
    const { html } = buildExportHtml(input({ files }));
    const scripts = scriptsOf(html);
    const benign = buildExportHtml(input({ files: { ...files, "a.js": "var a = 1;", "s.css": "body{}" } })).html;
    expect(scripts.length).toBe(scriptsOf(benign).length);
    const own = scripts.find((s) => s.textContent?.includes("var a = "));
    expect(own?.textContent).toContain('"<\\/script><script>window.__pwned = 3<\\/script>"');
    const style = new DOMParser().parseFromString(html, "text/html").querySelector("style");
    expect(style?.textContent).toContain('content: "<\\/style><script>');
  });

  it("takes out frames, programs, base addresses, redirects, prefetching and pings, and the addresses they held", () => {
    const files = {
      "index.html": [
        "<html><head>",
        '<base href="https://evil.example/">',
        '<meta http-equiv="refresh" content="0;url=https://evil.example/">',
        '<link rel="preload" href="https://evil.example/a" as="script"><link rel="dns-prefetch" href="//evil.example">',
        "</head><body>",
        '<iframe src="https://evil.example/"></iframe><object data="https://evil.example/x"></object><embed src="https://evil.example/y">',
        '<a href="https://example.org/" ping="https://evil.example/ping">link</a>',
        '<img src="data:image/png;base64,AAAA" srcset="https://evil.example/1x.png 1x">',
        '<form action="https://evil.example/post"><button formaction="https://evil.example/f">go</button></form>',
        "</body></html>",
      ].join(""),
    };
    const { html } = buildExportHtml(input({ files }));
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const selector of ["iframe", "object", "embed", "base", "link", "[ping]", "[srcset]", "[formaction]"]) expect(doc.querySelector(selector), selector).toBeNull();
    expect(doc.querySelector('meta[http-equiv="refresh"]')).toBeNull();
    expect(doc.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').length).toBe(1);
    // The form is left, the policy refuses it (form-action 'none'); a plain link to a web page is the reader's to follow.
    expect(html).not.toMatch(/evil\.example\/(a|x|y|ping|f|1x)/);
  });

  it("carries no frame secret or app address: an address of the app in the page's files is taken out, not copied", () => {
    const files = {
      "index.html": [
        '<html><head><link rel="stylesheet" href="smart://localhost/SECRETFRAME0123/s.css">',
        '<script src="http://smart.localhost/SECRETFRAME0123/a.js"></script></head>',
        '<body><img src="smart://localhost/SECRETFRAME0123/assets/p.png"></body></html>',
      ].join(""),
    };
    const { html, left } = buildExportHtml(input({ files }));
    expect(html).not.toContain("SECRETFRAME0123");
    expect(html).not.toContain("smart://localhost");
    expect(html).not.toContain("smart.localhost");
    expect(left).toHaveLength(3);
  });
});

describe("opened on its own", () => {
  let posted: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;
  beforeEach(() => {
    posted = vi.fn<(...args: unknown[]) => void>();
    vi.spyOn(window, "postMessage").mockImplementation((...args: unknown[]) => void posted(...args));
    delete (window as unknown as { kasten?: unknown }).kasten;
    delete (window as unknown as { kit?: unknown }).kit;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.innerHTML = "<head></head><body></body>";
  });

  it("shows the data it was saved with", async () => {
    await open(buildExportHtml(input()).html);
    expect(document.getElementById("content")?.hasAttribute("hidden")).toBe(false);
    expect(document.body.textContent).toContain("Write intro");
    expect(document.body.textContent).toContain("Submit");
    expect(posted).not.toHaveBeenCalled();
  });

  it("answers reads from its saved answers and says plainly when it has none", async () => {
    await open(buildExportHtml(input()).html);
    const kasten = (window as unknown as { kasten: { query(tag: string): Promise<unknown>; watch: unknown } }).kasten;
    expect(await kasten.query("tracked")).toEqual(NOTES);
    await expect(kasten.query("other")).rejects.toMatchObject({ code: "not_found" });
  });

  it("refuses every write, in words, and keeps the data as it was", async () => {
    await open(buildExportHtml(input()).html);
    const kasten = (window as unknown as { kasten: Record<string, (...args: unknown[]) => Promise<unknown>> }).kasten;
    const attempts: [string, unknown[]][] = [
      ["update", [{ id: "a", props: { status: "done" } }]],
      ["addTags", [{ id: "a", tags: ["x"] }]],
      ["createNote", [{ title: "New" }]],
      ["append", [{ id: "a", md: "x" }]],
      ["toggleTodo", [{ id: "a", index: 0 }]],
    ];
    for (const [kind, args] of attempts) {
      await expect(kasten[kind]!(...args), kind).rejects.toMatchObject({ code: "refused", message: expect.stringContaining("saved copy") });
    }
    expect(await kasten.query!("tracked")).toEqual(NOTES);
    expect(posted).not.toHaveBeenCalled();
  });
});

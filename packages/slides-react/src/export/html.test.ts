import type { Deck, Element, Slide } from "@kasten-slides/wasm";
import { describe, expect, it } from "vitest";

import { plainDeck } from "../render/testing/decks.ts";
import { EMBEDS_LIVE, YOUTUBE_FROM_DISK, exportHtml } from "./html.ts";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const image = (id: string, src: string): Element => ({ type: "image", id, x: 0, y: 0, w: 100, h: 100, src }) as unknown as Element;
const words = (id: string, t: string): Element => ({ type: "text", id, x: 10, y: 10, w: 400, h: 60, text: { paragraphs: [{ runs: [{ t }] }] } }) as unknown as Element;
const slide = (id: string, elements: Element[], extra: Partial<Slide> = {}): Slide => ({ id, layout: "blank", elements, ...extra });

function deckOf(...slides: Slide[]): Deck {
  return { ...plainDeck([]).deck, title: "A talk: <part> 1", slides };
}

const host = { imageUrl: () => undefined, readImage: async () => PNG };

async function made(deck: Deck, options = {}) {
  const { file, warnings } = await exportHtml(deck, host, options);
  const html = new TextDecoder().decode(file.bytes);
  const dom = new DOMParser().parseFromString(html, "text/html");
  return { file, warnings, html, dom };
}

const deck = deckOf(
  slide("s1", [words("t1", "Hello"), image("i1", "assets/a.png")], { notes: "Say **hi**" }),
  slide("s2", [words("t2", "Steps"), { ...words("t3", "Later"), stepStates: { 0: "hidden", 2: "normal" } } as Element], { steps: 2 }),
  slide("s2b", [words("t4", "Backup")], { backup: true }),
  slide("s3", [image("i2", "assets/a.png")], { hidden: true }),
  slide("s4", [words("t5", "End")], { transition: { kind: "morph", duration: 0.5 } }),
);

describe("the deck as a web page", () => {
  it("is one html file named after the deck", async () => {
    const { file } = await made(deck);
    expect(file.name).toBe("A talk <part> 1.html".replace("<part>", "<part>").replaceAll(/[<>]/g, " ").replaceAll(/\s+/g, " ").replace(" .html", ".html"));
    expect(file.type).toBe("text/html");
  });

  it("takes the name it is given", async () => {
    expect((await made(deck, { name: "mine.html" })).file.name).toBe("mine.html");
  });

  it("has a section for each slide that is shown, a stack for backups, and none for a hidden slide", async () => {
    const { dom } = await made(deck);
    const sections = [...dom.querySelectorAll(".slides section[data-slide]")].map((s) => s.getAttribute("data-slide"));
    expect(sections).toEqual(["s1", "s2", "s2b", "s4"]);
    expect(dom.querySelectorAll(".slides > section")).toHaveLength(3);
    expect(dom.querySelector(".slides > section:not([data-slide])")?.querySelectorAll(":scope > section")).toHaveLength(2);
    expect(dom.querySelector('[data-slide="s3"]')).toBeNull();
  });

  it("has a layer for each step of a slide with steps, the first showing, and a marker reveal.js can step through for each", async () => {
    const { dom } = await made(deck);
    const section = dom.querySelector('[data-slide="s2"]');
    const layers = [...(section?.querySelectorAll(":scope > .ks-show-layer") ?? [])];
    expect(layers.map((l) => [l.getAttribute("data-step"), l.hasAttribute("hidden")])).toEqual([["0", false], ["1", true], ["2", true]]);
    expect(section?.querySelectorAll(":scope > .fragment")).toHaveLength(2);
    // The last step has what the first has not.
    const draws = (layer: ParentNode | undefined) => [...(layer?.querySelectorAll("[data-el]") ?? [])].map((e) => e.getAttribute("data-el"));
    expect(draws(layers[0])).toEqual(["t2"]);
    expect(draws(layers[2])).toEqual(["t2", "t3"]);
    expect(dom.querySelector('[data-slide="s1"]')?.querySelectorAll(":scope > .ks-show-layer")).toHaveLength(1);
  });

  it("names how each slide arrives, and pairs a morph with the slide before it", async () => {
    const { dom } = await made(deck);
    const s4 = dom.querySelector('[data-slide="s4"]');
    expect(s4?.getAttribute("data-auto-animate-id")).toBe("morph-s2");
    expect(dom.querySelector('[data-slide="s2"]')?.getAttribute("data-auto-animate-id")).toBe("morph-s2");
    expect(s4?.getAttribute("data-auto-animate-duration")).toBe("0.5");
    expect(s4?.hasAttribute("data-auto-animate")).toBe(true);
  });

  it("puts each picture in once, however many slides show it, and no address that a browser would fetch", async () => {
    const twice = deckOf(slide("a", [image("i1", "assets/a.png")]), slide("b", [image("i2", "assets/a.png")]), slide("c", [image("i3", "assets/a.png")]));
    const { dom, html } = await made(twice);
    expect([...dom.querySelectorAll("img")].map((i) => i.getAttribute("data-ks-img"))).toEqual(["0", "0", "0"]);
    expect([...dom.querySelectorAll("img")].every((i) => !i.hasAttribute("src"))).toBe(true);
    const data = JSON.parse(dom.getElementById("ks-data")?.textContent ?? "{}");
    expect(data.images).toHaveLength(1);
    expect(data.images[0]).toMatch(/^data:image\/png;base64,/);
    expect(html).not.toContain("ks-img:");
    expect(html).not.toMatch(/<link\b/);
    expect(html).not.toMatch(/(?:src|href)="https?:/);
  });

  it("keeps the speaker notes beside their slide, as markup, for the page that scrolls", async () => {
    const { dom } = await made(deck);
    const notes = dom.querySelector('[data-slide="s1"] > .ks-show-notes-store');
    expect(notes?.hasAttribute("hidden")).toBe(true);
    expect(notes?.querySelector("strong")?.textContent).toBe("hi");
    expect(dom.querySelector('[data-slide="s2"] > .ks-show-notes-store')).toBeNull();
  });

  it("tells the script what it needs: the size, the effect, the slides in order with their place, and how many there are", async () => {
    const { dom } = await made(deck);
    const data = JSON.parse(dom.getElementById("ks-data")?.textContent ?? "{}");
    expect(data).toMatchObject({ title: "A talk: <part> 1", size: { w: 960, h: 540 }, effect: "fade", count: 4 });
    expect(data.slides).toEqual([
      { id: "s1", number: 1, backup: false, h: 0, v: 0 },
      { id: "s2", number: 2, backup: false, h: 1, v: 0 },
      { id: "s2b", number: 3, backup: true, h: 1, v: 1 },
      { id: "s4", number: 4, backup: false, h: 2, v: 0 },
    ]);
  });

  it("passes on a deck's loop and its seconds per slide, and says none of them for a deck without", async () => {
    const plain = await made(deck);
    const none = JSON.parse(plain.dom.getElementById("ks-data")?.textContent ?? "{}");
    expect(none).toMatchObject({ loop: false, autoAdvance: 0 });
    const kiosk = await made({ ...deck, present: { ...deck.present, loop: true, autoAdvance: 8 } });
    expect(JSON.parse(kiosk.dom.getElementById("ks-data")?.textContent ?? "{}")).toMatchObject({ loop: true, autoAdvance: 8 });
  });

  it("has reveal.js's rules without its print rules, and the rules of the stage and the scrolling page", async () => {
    const { dom } = await made(deck);
    const css = dom.querySelector("style")?.textContent ?? "";
    expect(css).toContain(".reveal .slides");
    expect(css).not.toContain("@media print");
    expect(css).toContain(".ks-show-laser");
    expect(css).toContain(".ks-show-scroll-item");
  });

  it("has one script that reads, with reveal.js and the runtime in it", async () => {
    const { dom } = await made(deck);
    const scripts = [...dom.querySelectorAll("script:not([type])")];
    expect(scripts).toHaveLength(1);
    const code = scripts[0]?.textContent ?? "";
    expect(() => new Function(code)).not.toThrow();
    expect(code).toContain("animateMorph");
    expect(code).toContain("VERSION");
  });

  it("says what it could not carry: pictures it could not read, videos and embedded pages left as their stills", async () => {
    const odd = deckOf(slide("a", [image("i", "assets/gone.png"), { type: "video", id: "v", x: 0, y: 0, w: 10, h: 10, src: "assets/m.webm" } as unknown as Element, { type: "embed", id: "e", x: 0, y: 0, w: 10, h: 10, url: "https://example.com" } as unknown as Element]));
    const { warnings } = await exportHtml(odd, { imageUrl: () => undefined, readImage: async () => undefined });
    // (This page has no fonts to give, so it also says so about the font.)
    expect(warnings.map((w) => w.message).filter((m) => !m.startsWith("The font"))).toEqual([
      "The picture assets/gone.png could not be read, so its place is grey.",
      "Videos are not put in the page: it shows their stills.",
      EMBEDS_LIVE,
    ]);
  });

  it("says that a YouTube video plays only from a web address, when the deck has one", async () => {
    const tube = deckOf(slide("a", [{ type: "embed", id: "e", x: 0, y: 0, w: 640, h: 360, url: "https://youtu.be/dQw4w9WgXcQ" } as unknown as Element]));
    const { warnings } = await exportHtml(tube, host);
    expect(warnings.map((w) => w.message)).toEqual(expect.arrayContaining([EMBEDS_LIVE, YOUTUBE_FROM_DISK]));
  });
});

describe("the live frames of the web page", () => {
  const embedded = (extra: Record<string, unknown> = {}): Element => ({ type: "embed", id: "e", x: 20, y: 30, w: 640, h: 360, url: "https://example.com/talk", poster: "assets/a.png", ...extra }) as unknown as Element;

  it("holds an empty frame for each embedded web page over its still, with the address in the markup for the script to give it", async () => {
    const { dom } = await made(deckOf(slide("a", [embedded()])));
    const frame = dom.querySelector<HTMLIFrameElement>('[data-slide="a"] iframe[data-ks-live]');
    expect(frame?.getAttribute("data-ks-live")).toBe("https://example.com/talk");
    expect(frame?.getAttribute("src")).toBeNull();
    expect(frame?.getAttribute("referrerpolicy")).toBe("strict-origin-when-cross-origin");
    expect(frame?.getAttribute("sandbox")).toContain("allow-popups");
    expect(frame?.getAttribute("allow")).toContain("fullscreen");
    expect(frame?.style.opacity).toBe("0");
    // The still is there under it: what the slide itself draws for the embed (the frame comes after it, so it is over it).
    const still = dom.querySelector('[data-slide="a"] [data-el="e"]');
    expect(still).not.toBeNull();
    expect(still?.compareDocumentPosition(frame as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("is the site's own player for a video link, and notes that YouTube needs an address of its own", async () => {
    const { dom } = await made(deckOf(slide("a", [embedded({ url: "https://youtu.be/dQw4w9WgXcQ?t=30" }), embedded({ id: "v", url: "https://vimeo.com/76979871" })])));
    const frames = [...dom.querySelectorAll("iframe[data-ks-live]")];
    expect(frames.map((f) => f.getAttribute("data-ks-live"))).toEqual(["https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=30&rel=0", "https://player.vimeo.com/video/76979871"]);
    expect(frames.map((f) => f.hasAttribute("data-ks-needs-address"))).toEqual([true, false]);
  });

  it("has a frame for each step an embed shows in, and none where a step hides it", async () => {
    const { dom } = await made(deckOf(slide("a", [embedded({ stepStates: { 0: "hidden", 1: "normal" } })], { steps: 1 })));
    const layers = [...dom.querySelectorAll('[data-slide="a"] > .ks-show-layer')];
    expect(layers.map((l) => l.querySelectorAll("iframe[data-ks-live]").length)).toEqual([0, 1]);
  });

  it("has none for a page of the host, a script, or a slide with no embeds", async () => {
    const { dom } = await made(deckOf(slide("a", [embedded({ url: "", source: { page: "notes/a.md", kind: "embed" } }), embedded({ id: "x", url: "javascript:alert(1)" })]), slide("b", [])));
    expect(dom.querySelectorAll("iframe")).toHaveLength(0);
  });

  it("has a script that gives the frame its address when the slide is shown and there is a network", async () => {
    const { html } = await made(deckOf(slide("a", [embedded()])));
    expect(html).toContain("data-ks-live");
    expect(html).toContain("navigator.onLine");
    expect(html).toContain("data-ks-needs-address");
  });

  it("is a page for a deck of one slide with nothing in it", async () => {
    const { dom } = await made(deckOf(slide("only", [])));
    expect(dom.querySelectorAll(".slides section")).toHaveLength(1);
  });
});

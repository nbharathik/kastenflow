// The check before leaving: lint's rules that matter on the way out, the pictures and pages the host no longer holds, what a still file cannot
// show, and what each format changes. A fake host with a few pictures and pages stands for the vault.

import type { DeckEngine, Element } from "@kasten-slides/wasm";
import { afterEach, describe, expect, it } from "vitest";

import type { SlidesHost } from "../host.ts";

import { type Kit, mountDialogs } from "../dialogs/test-kit.tsx";
import { lintOf } from "../lint/service.ts";
import { withPages } from "../../pages/fake-pages.ts";
import { runPreflight } from "./preflight.ts";
import { reductionsFor } from "./reductions.ts";
import type { PreflightFormat } from "./types.ts";

let kit: Kit | null = null;
afterEach(() => {
  if (kit) lintOf(kit.session).dispose();
  void kit?.session.dispose();
  kit = null;
});

const words = (t: string) => ({ paragraphs: [{ runs: [{ t }] }] });
const text = (id: string, extra: Record<string, unknown> = {}): Element => ({ type: "text", id, x: 100, y: 100, w: 300, h: 60, text: words("Hello"), ...extra }) as Element;
const picture = (id: string, src: string): Element => ({ type: "image", id, src, alt: "A picture", x: 100, y: 200, w: 100, h: 100 }) as Element;
const embed = (id: string, url: string, poster?: string): Element => ({ type: "embed", id, url, ...(poster ? { poster } : {}), x: 100, y: 200, w: 300, h: 200 }) as Element;
const video = (id: string, poster?: string): Element => ({ type: "video", id, src: "assets/clip.mp4", ...(poster ? { poster } : {}), x: 100, y: 200, w: 300, h: 200 }) as Element;

/** A deck with a finished cover and a slide with these elements. */
async function over(elements: Element[], prepare?: (engine: DeckEngine) => void): Promise<Kit> {
  kit = await mountDialogs({ elements, blank: true, prepare: (engine) => {
    const cover = engine.deck.slides[0]!;
    engine.apply("set_text", { slide: cover.id, id: cover.elements.find((e) => e.placeholder === "subtitle")!.id, markdown: "A subtitle" });
    prepare?.(engine);
  } });
  return kit;
}

const ruleSet = (issues: { rule: string }[]) => issues.map((issue) => issue.rule).sort();

describe("a deck with nothing wrong", () => {
  it("has no errors and no warnings, and lists nothing it does not have", async () => {
    const here = await over([text("t")]);
    const report = await runPreflight(here.session, here.host, "pptx");
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.reductions).toEqual([]);
  });
});

describe("the pictures the host holds", () => {
  it("an image that is not in the host's store is an error on its slide, naming the element, and one that is there is not", async () => {
    const here = await over([picture("gone", "assets/gone.png"), picture("there", "assets/there.png")]);
    // The host names an added image by its own path; the deck points at that path.
    const kept = await here.host.addImage("there.png", new Uint8Array([1, 2, 3]));
    here.engine.apply("patch_elements", { slide: here.session.state.slideId, patches: [{ id: "there", patch: { src: kept } }] });
    const report = await runPreflight(here.session, here.host, "pptx");
    const missing = report.errors.filter((issue) => issue.rule === "missing-image");
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ severity: "error", slide: here.session.state.slideId, element: "gone" });
    expect(missing[0]?.message).toContain("gone.png");
  });

  it("the still of an embedded page that is gone is an error too, said as a still", async () => {
    const here = await over([embed("e", "https://example.com", "assets/still.png")]);
    const report = await runPreflight(here.session, here.host, "pdf");
    const missing = report.errors.find((issue) => issue.rule === "missing-image");
    expect(missing?.message).toContain("still");
    expect(missing?.element).toBe("e");
  });

  it("a picture from the web is not looked for in the store, and is said not to have been looked at", async () => {
    const here = await over([picture("far", "https://example.com/a.png")]);
    const report = await runPreflight(here.session, here.host, "pptx");
    expect(report.errors.filter((issue) => issue.rule === "missing-image")).toEqual([]);
    expect(report.unchecked.join(" ")).toContain("1 web address");
  });

  it("a host that can only give addresses cannot say a picture is missing, so it does not", async () => {
    const here = await over([picture("p", "assets/x.png")]);
    const bare = { imageUrl: () => "blob:x" } as unknown as SlidesHost;
    const report = await runPreflight(here.session, bare, "pptx");
    expect(report.errors.filter((issue) => issue.rule === "missing-image")).toEqual([]);
  });
});

describe("lint's rules on the way out", () => {
  it("includes text past the edge, a link to a slide that is not there, and leaves out what is merely untidy", async () => {
    const here = await over([
      text("wide", { x: 800, w: 400 }),
      text("linked", { link: "slide:s-nope", y: 300 }),
      text("tight", { x: 4, y: 400 }),
    ]);
    const report = await runPreflight(here.session, here.host, "pdf");
    expect(ruleSet(report.errors)).toEqual(["broken-link", "off-slide"]);
    expect(report.errors.every((issue) => issue.slide === here.session.state.slideId)).toBe(true);
    // The margin warning is the Lint dialog's, not a reason to stop.
    expect(report.warnings.filter((issue) => issue.rule === "margin")).toEqual([]);
  });

  it("includes the rule for what PowerPoint cannot read only for PowerPoint", async () => {
    const here = await over([video("v", "assets/still.png")]);
    const pptx = await runPreflight(here.session, here.host, "pptx");
    expect(pptx.warnings.some((issue) => issue.rule === "pptx-unsafe")).toBe(true);
    const html = await runPreflight(here.session, here.host, "html");
    expect(html.warnings.some((issue) => issue.rule === "pptx-unsafe")).toBe(false);
  });

  it("says which rules could not be checked here", async () => {
    const here = await over([text("t")]);
    const report = await runPreflight(here.session, here.host, "pptx");
    expect(report.unchecked.join(" ")).toContain("unresolved-citation");
  });

  it("looks only at what the host can say when asked to leave lint out", async () => {
    const here = await over([text("wide", { x: 800, w: 400 })]);
    const report = await runPreflight(here.session, here.host, "present", { lint: false });
    expect(report.errors).toEqual([]);
  });
});

describe("web content a still file cannot show", () => {
  it("an embedded page with an address and no poster is a warning for a PDF and a picture, and for PowerPoint through lint", async () => {
    const here = await over([embed("e", "https://example.com"), embed("kept", "https://example.org", "assets/poster.png")]);
    const poster = await here.host.addImage("poster.png", new Uint8Array([1]));
    here.engine.apply("patch_elements", { slide: here.session.state.slideId, patches: [{ id: "kept", patch: { poster } }] });
    for (const format of ["pdf", "png"] as PreflightFormat[]) {
      const report = await runPreflight(here.session, here.host, format);
      const needing = report.warnings.filter((issue) => issue.rule === "needs-poster");
      expect(needing.map((issue) => issue.element), format).toEqual(["e"]);
    }
    const pptx = await runPreflight(here.session, here.host, "pptx");
    expect(pptx.warnings.some((issue) => issue.rule === "pptx-unsafe" && issue.element === "e")).toBe(true);
    // A presentation shows it live.
    const live = await runPreflight(here.session, here.host, "present", { lint: false });
    expect(live.warnings.filter((issue) => issue.rule === "needs-poster")).toEqual([]);
  });

  it("a video with no poster is a warning for a PDF", async () => {
    const here = await over([video("v")]);
    const report = await runPreflight(here.session, here.host, "pdf");
    expect(report.warnings.find((issue) => issue.rule === "needs-poster")).toMatchObject({ element: "v" });
  });

  it("web addresses are looked at only when asked, and an unreachable one is a warning", async () => {
    const here = await over([embed("up", "https://up.example"), embed("down", "https://down.example", "assets/p.png")]);
    const quiet = await runPreflight(here.session, here.host, "present", { lint: false });
    expect(quiet.warnings.filter((issue) => issue.rule === "unreachable")).toEqual([]);
    expect(quiet.unchecked.join(" ")).toContain("2 web addresses");
    const asked: string[] = [];
    const looked = await runPreflight(here.session, here.host, "present", { lint: false, network: true, reach: async (address) => (asked.push(address), address.includes("up")) });
    expect(asked.sort()).toEqual(["https://down.example", "https://up.example"]);
    expect(looked.warnings.filter((issue) => issue.rule === "unreachable").map((issue) => issue.element)).toEqual(["down"]);
    expect(looked.unchecked.join(" ")).not.toContain("web address");
  });
});

describe("pages of the host", () => {
  const link = (id: string, path: string) => text(id, { link: `page:${path}` });

  it("a link to a page that is not in the notes any more is a warning, and one to a page that is there is not", async () => {
    const here = await over([link("gone", "library/gone.md"), link("there", "library/there.md")]);
    withPages(here.host, [{ path: "library/there.md", title: "There", markdown: "Words." }]);
    const report = await runPreflight(here.session, here.host, "pptx");
    const missing = report.warnings.filter((issue) => issue.rule === "missing-page");
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ element: "gone", severity: "warning" });
    expect(missing[0]?.message).toContain("gone.md");
  });

  it("a page an element was made from that is gone is a warning that the slide keeps what it said", async () => {
    const source = { page: "library/old.md", kind: "contents" };
    const here = await over([text("made", { source })]);
    withPages(here.host, []);
    const report = await runPreflight(here.session, here.host, "html");
    const missing = report.warnings.find((issue) => issue.rule === "missing-page");
    expect(missing?.message).toContain("keeps what the page said");
  });

  it("is not checked where the host has no pages, and says so", async () => {
    const here = await over([link("l", "library/x.md")]);
    const report = await runPreflight(here.session, here.host, "pptx");
    expect(report.warnings.filter((issue) => issue.rule === "missing-page")).toEqual([]);
    expect(report.unchecked.join(" ")).toContain("no pages to look them up in");
  });

  it("finds a page by the host's own name for it, and reads a path written with %20", async () => {
    const here = await over([link("l", "library/my%20page.md")]);
    withPages(here.host, [{ path: "library/my page.md", title: "My page", markdown: "Words." }]);
    const report = await runPreflight(here.session, here.host, "pptx");
    expect(report.warnings.filter((issue) => issue.rule === "missing-page")).toEqual([]);
  });
});

describe("what a format changes", () => {
  it("lists for PowerPoint what the deck has: steps, a Morph, embeds, a video, a formula, a timer and a link to a page", async () => {
    const here = await over(
      [embed("e", "https://example.com", "assets/p.png"), video("v", "assets/s.png"), { type: "math", id: "m", latex: "x^2", x: 10, y: 10, w: 100, h: 50 } as Element, { type: "timer", id: "t", seconds: 60, x: 10, y: 100, w: 100, h: 50 } as Element, text("l", { link: "page:library/a.md", y: 400 })],
      (engine) => {
        const [cover] = engine.deck.slides;
        engine.apply("set_slide_steps", { slide: cover!.id, steps: 3 });
        engine.apply("set_transition", { ids: [cover!.id], transition: { kind: "morph" } });
      },
    );
    const report = await runPreflight(here.session, here.host, "pptx", { lint: false });
    const byId = new Map(report.reductions.map((item) => [item.id, item]));
    expect([...byId.keys()].sort()).toEqual(["embeds", "math", "morph", "page-links", "steps", "timers", "videos"]);
    expect(byId.get("steps")?.becomes).toContain("3 slides more");
    expect(byId.get("steps")?.slides).toHaveLength(1);
    expect(byId.get("embeds")?.count).toBe(1);
  });

  it("is different for each format, and lists nothing the deck does not have", async () => {
    const here = await over([embed("e", "https://example.com", "assets/p.png")]);
    const deck = here.session.deck;
    expect(reductionsFor(deck, "pptx").map((r) => r.id)).toEqual(["embeds"]);
    expect(reductionsFor(deck, "html").map((r) => r.id)).toEqual(["embeds"]);
    expect(reductionsFor(deck, "present").map((r) => r.id)).toEqual(["embeds"]);
    expect(reductionsFor(deck, "markdown").map((r) => r.id)).toEqual(["non-text"]);
    expect(reductionsFor(deck, "png").map((r) => r.id)).toEqual(["embeds"]);
  });
});

describe("the report", () => {
  it("lists a slide's problems together, in the order of the deck, errors and warnings apart", async () => {
    const here = await over([text("wide", { x: 800, w: 400 }), video("v")]);
    here.engine.apply("add_slide", { layout: "blank" });
    const second = here.session.deck.slides.at(-1)!.id;
    here.engine.apply("add_elements", { slide: second, elements: [picture("gone", "assets/gone.png")] });
    const report = await runPreflight(here.session, here.host, "pdf");
    expect(report.errors.map((issue) => issue.slide)).toEqual([here.session.deck.slides[1]!.id, second]);
    expect(report.warnings.map((issue) => issue.rule)).toEqual(["needs-poster"]);
    expect(report.format).toBe("pdf");
  });
});

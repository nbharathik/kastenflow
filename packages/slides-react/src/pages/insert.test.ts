// Insert → Page…: the four ways a page of the host goes on a slide, and what is kept of it, with a host that holds a few pages in memory.

import { pageBody, pageFingerprint, pageSection } from "@kasten-slides/wasm";
import type { Element } from "@kasten-slides/wasm";
import { describe, expect, it } from "vitest";

import type { HostPageText, SlidesHost } from "../editor/host.ts";
import { EditorSession } from "../editor/session/session.ts";
import { newDeck } from "../test/engine.ts";
import { type FakePages, withPages } from "./fake-pages.ts";
import { PageError, breakLink, insertPage, readPart, sectionsOf, standingOf, updatable, updateFromPages } from "./insert.ts";
import { parsePageLink } from "./links.ts";

const PLAN = "---\nid: plan-1\ntitle: Plan\n---\n# Plan\n\nIntro words about the talk.\n\n## Risks\n\n- late\n- over budget\n\n## Next\n\nGo and do it.\n";

const page = (path: string, title: string, markdown: string): HostPageText => ({ path, title, markdown, id: `id-${title}`, project: "talk", icon: "\u{1F4CB}" });

async function open(pages: HostPageText[] = [page("projects/talk/plan.md", "Plan", PLAN)]) {
  const notices: string[] = [];
  const host: SlidesHost = { save: async () => ({ status: "saved" }), imageUrl: () => undefined, addImage: async (name) => `assets/${name}`, deliver: async () => {}, notify: (message) => void notices.push(message) };
  const fake: FakePages = withPages(host, pages);
  const session = new EditorSession(await newDeck("Talk"), host, { saveDelay: 60_000 });
  session.slides.add({ layout: "blank" });
  return { host, fake, session, notices, plan: fake.pages.get("projects/talk/plan.md")! };
}

const elements = (session: EditorSession): Element[] => session.slide.elements;
const wordsOf = (element: Element | undefined): string => (element && "text" in element && element.text ? element.text.paragraphs.map((p) => p.runs.map((r) => r.t).join("")).join("\n") : "");

describe("embedding a page", () => {
  it("puts a live, read-only page on the slide that holds the words it was read with, as one step of undo", async () => {
    const { session, plan } = await open();
    const before = elements(session).length;
    const id = await insertPage(session, { mode: "embed", page: plan });
    const embed = session.elements.find([id!])[0];
    expect(embed?.type).toBe("embed");
    if (embed?.type !== "embed") return;
    expect(embed.url).toBe("");
    expect(embed.design).toEqual({ w: 640, h: 360 });
    expect(embed.source).toMatchObject({ page: "projects/talk/plan.md", kind: "embed", title: "Plan", id: "id-Plan" });
    expect(embed.source?.markdown).toBe(pageBody(PLAN));
    expect(embed.source?.hash).toBe(pageFingerprint(pageBody(PLAN)));
    // The frontmatter is not the page's words.
    expect(embed.source?.markdown).not.toContain("id: plan-1");
    expect(session.state.selection).toEqual([id]);
    expect(elements(session).length).toBe(before + 1);
    session.undo();
    expect(elements(session).length).toBe(before);
  });

  it("is a box with the shape of its window, so the page fills it with no bars", async () => {
    const { session, plan } = await open();
    const id = await insertPage(session, { mode: "embed", page: plan });
    const box = session.elements.boxOf(session.elements.find([id!])[0]!)!;
    expect(box.w / box.h).toBeCloseTo(640 / 360, 1);
  });

  it("says in words that the page cannot be found, and puts nothing on the slide", async () => {
    const { session, fake, plan } = await open();
    fake.remove(plan.path);
    const before = elements(session).length;
    await expect(insertPage(session, { mode: "embed", page: plan })).rejects.toThrow(PageError);
    expect(elements(session).length).toBe(before);
  });
});

describe("the contents of a page as slide text", () => {
  it("makes text on the slide that remembers its page, and leaves the frontmatter out", async () => {
    const { session, plan } = await open();
    const id = await insertPage(session, { mode: "contents", page: plan, sync: true });
    const made = session.elements.find([id!])[0]!;
    expect(wordsOf(made)).toContain("Intro words about the talk.");
    expect(wordsOf(made)).toContain("over budget");
    expect(wordsOf(made)).not.toContain("plan-1");
    expect(made.source).toMatchObject({ page: "projects/talk/plan.md", kind: "contents", sync: true, hash: pageFingerprint(pageBody(PLAN)) });
    expect(updatable(made)).toBe(true);
  });

  it("can be cut into a slide for each heading, after the one shown", async () => {
    const { session, plan } = await open();
    const slides = session.deck.slides.length;
    const shown = session.state.slideId;
    const first = await insertPage(session, { mode: "slides", page: plan });
    expect(first).toBeTruthy();
    // Plan (with its words), Risks and Next.
    expect(session.deck.slides.length).toBe(slides + 3);
    const at = session.deck.slides.findIndex((s) => s.id === shown);
    expect(session.deck.slides[at + 1]?.id).toBe(first);
    expect(session.state.slideId).toBe(first);
    const titles = session.deck.slides.slice(at + 1, at + 4).map((s) => s.elements.find((e) => e.placeholder === "title")).map(wordsOf);
    expect(titles).toEqual(["Plan", "Risks", "Next"]);
    session.undo();
    expect(session.deck.slides.length).toBe(slides);
  });
});

describe("a section of a page", () => {
  it("lists the headings the host's page has, from the engine when the host has no list of its own", async () => {
    const { host, plan } = await open();
    expect((await sectionsOf(host, plan.path)).map((s) => [s.title, s.level])).toEqual([
      ["Plan", 1],
      ["Risks", 2],
      ["Next", 2],
    ]);
  });

  it("takes the words under one heading and nothing past the next at its level", async () => {
    const { session, plan } = await open();
    const id = await insertPage(session, { mode: "section", page: plan, section: "Risks", sync: true });
    const made = session.elements.find([id!])[0]!;
    expect(wordsOf(made)).toContain("late");
    expect(wordsOf(made)).not.toContain("Go and do it");
    expect(made.source).toMatchObject({ kind: "section", section: "Risks", sync: true });
    expect(made.name).toBe("Section: Risks");
  });

  it("is refused in words when the heading is not there", async () => {
    const { session, plan } = await open();
    await expect(insertPage(session, { mode: "section", page: plan, section: "Nowhere" })).rejects.toThrow(/no section called "Nowhere"/);
  });
});

describe("a link to a page", () => {
  it("is words on the slide that open the page, and the section when one is named", async () => {
    const { session, plan } = await open();
    const id = await insertPage(session, { mode: "link", page: plan, section: "Risks" });
    const made = session.elements.find([id!])[0]!;
    const run = made.type === "text" ? made.text.paragraphs[0]?.runs[0] : undefined;
    expect(run?.t).toContain("Plan");
    expect(run?.t).toContain("Risks");
    expect(parsePageLink(run?.link)).toEqual({ path: "projects/talk/plan.md", section: "Risks" });
    expect(made.source?.kind).toBe("link");
    expect(updatable(made)).toBe(false);
  });

  it("can be a card that carries the link on the whole box", async () => {
    const { session, plan } = await open();
    const id = await insertPage(session, { mode: "link", page: plan, card: true });
    const made = session.elements.find([id!])[0]!;
    expect(made.type).toBe("shape");
    expect(parsePageLink(made.link)).toEqual({ path: "projects/talk/plan.md", section: null });
    expect(made.alt).toContain("Plan");
  });
});

describe("keeping up with the page", () => {
  it("tells whether the page changed since, and when it is gone", async () => {
    const { host, session, fake, plan } = await open();
    const id = await insertPage(session, { mode: "section", page: plan, section: "Risks" });
    const made = () => session.elements.find([id!])[0]!;
    expect(await standingOf(host, made())).toBe("current");
    fake.edit(plan.path, PLAN.replace("- late", "- late again"));
    expect(await standingOf(host, made())).toBe("changed");
    fake.remove(plan.path);
    expect(await standingOf(host, made())).toBe("missing");
  });

  it("makes the element again from the page as it is now, keeping its id, in one step of undo", async () => {
    const { session, fake, plan } = await open();
    const id = await insertPage(session, { mode: "section", page: plan, section: "Risks" });
    fake.edit(plan.path, PLAN.replace("- late", "- delayed"));
    const done = await updateFromPages(session, [id!]);
    expect(done).toEqual({ updated: 1, missing: 0, same: 0 });
    const made = session.elements.find([id!])[0]!;
    expect(made.id).toBe(id);
    expect(wordsOf(made)).toContain("delayed");
    // The fingerprint is the section's, not the page's.
    expect(made.source?.hash).toBe(pageFingerprint(pageSection(pageBody(PLAN.replace("- late", "- delayed")), "Risks")!));
    session.undo();
    expect(wordsOf(session.elements.find([id!])[0])).toContain("late");
  });

  it("leaves what has not changed alone, and counts what could not be read", async () => {
    const { session, fake, plan } = await open([page("projects/talk/plan.md", "Plan", PLAN), page("other.md", "Other", "# Other\n\nSome words.\n")]);
    const first = await insertPage(session, { mode: "contents", page: plan });
    const other = await insertPage(session, { mode: "contents", page: fake.pages.get("other.md")! });
    expect(await updateFromPages(session, [first!])).toEqual({ updated: 0, missing: 0, same: 1 });
    fake.remove("other.md");
    expect(await updateFromPages(session, [first!, other!])).toEqual({ updated: 0, missing: 1, same: 1 });
  });

  it("brings an embedded page up to date by what it holds, which is what it is drawn from", async () => {
    const { session, fake, plan } = await open();
    const id = await insertPage(session, { mode: "embed", page: plan });
    fake.edit(plan.path, `${PLAN}\nA last line.\n`);
    expect(await updateFromPages(session, [id!])).toMatchObject({ updated: 1 });
    const embed = session.elements.find([id!])[0];
    expect(embed?.source?.markdown).toContain("A last line.");
    expect(embed?.source?.hash).toBe(pageFingerprint(pageBody(`${PLAN}\nA last line.\n`)));
  });

  it("updates every element of the deck that came from a page when none is named", async () => {
    const { session, fake, plan } = await open();
    await insertPage(session, { mode: "contents", page: plan });
    session.slides.add({ layout: "blank" });
    await insertPage(session, { mode: "embed", page: plan });
    fake.edit(plan.path, `${PLAN}\nMore.\n`);
    expect(await updateFromPages(session)).toEqual({ updated: 2, missing: 0, same: 0 });
  });
});

describe("breaking the link", () => {
  it("leaves the words of contents as they are and takes the page away", async () => {
    const { session, plan } = await open();
    const id = await insertPage(session, { mode: "contents", page: plan });
    const words = wordsOf(session.elements.find([id!])[0]);
    await breakLink(session, id!);
    const after = session.elements.find([id!])[0]!;
    expect(after.source ?? null).toBeNull();
    expect(wordsOf(after)).toBe(words);
    expect(updatable(after)).toBe(false);
  });

  it("turns an embedded page into its words as plain slide text, in one step", async () => {
    const { session, plan } = await open();
    const id = await insertPage(session, { mode: "embed", page: plan });
    const count = elements(session).length;
    await breakLink(session, id!);
    expect(elements(session).length).toBe(count);
    expect(session.elements.find([id!]).length).toBe(0);
    const [made] = session.state.selection.map((s) => session.elements.find([s])[0]!);
    expect(made?.source ?? null).toBeNull();
    expect(wordsOf(made)).toContain("Intro words about the talk.");
    session.undo();
    expect(session.elements.find([id!])[0]?.type).toBe("embed");
  });
});

describe("reading a part of a page", () => {
  it("finds a section by its words without regard to case", async () => {
    const { host } = await open();
    expect((await readPart(host, "projects/talk/plan.md", "risks")).markdown).toMatch(/^## Risks/);
  });
});

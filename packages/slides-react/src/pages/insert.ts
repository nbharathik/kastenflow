// Putting a page of the host on a slide, and keeping what was put there in step with the page. Four ways in, all one step of undo:
//
// - an embedded page: a live, read-only view (an `embed` with no address whose `source` names the page and holds its words as the
//   snapshot the slide is drawn from where the page cannot be read);
// - its contents as slide text (or as slides, one for each section);
// - one section of it, which may be kept in step with the page;
// - a link to it, as words or as a card.
//
// The host reads pages (`readPage`); the engine turns Markdown into elements (the `add_page_contents` family of operations). Nothing
// here knows what a vault is: a page is a path the host names and the Markdown it reads.

import { pageBlocks, pageBody, pageFingerprint, pageSection, pageSections } from "@kasten-slides/wasm";
import type { Element, PageSource } from "@kasten-slides/wasm";

import { embedSize } from "../editor/composite-kinds.ts";
import { PAGE_DESIGN } from "../embed/scale.ts";
import { plainText, shape, textBox } from "../editor/factory.ts";
import type { HostPage, HostPageText, SlidesHost } from "../editor/host.ts";
import { insertPlaced } from "../editor/insert-composite.ts";
import { CLICK_SIZE } from "../editor/shapes.ts";
import type { EditorSession } from "../editor/session/session.ts";
import { makePageLink } from "./links.ts";

/** The four ways a page goes on a slide. "slides" is contents again, cut at its headings into a slide each. */
export type PageMode = "embed" | "contents" | "slides" | "section" | "link";

export interface PageChoice {
  mode: PageMode;
  page: HostPage;
  /** The heading of the section (for `section`, and a link that goes to one). */
  section?: string | null;
  /** Keep what is made in step with the page (for `section` and `contents`): it is flagged when the page changes. */
  sync?: boolean;
  /** A link as a card with the page's name, in place of words. */
  card?: boolean;
  /** For `slides`: the heading level a slide starts at (0 lets the page's own shape decide). */
  split?: number;
}

/** What went wrong, in words for the person: the host could not read the page, or the page has no such section. */
export class PageError extends Error {}

const SIZE_LIMIT = 40;

/** A page as the host reads it now, with the Markdown cut down to the page's body. */
export async function readBody(host: SlidesHost, path: string): Promise<(HostPageText & { body: string }) | undefined> {
  const text = await host.readPage?.(path);
  return text ? { ...text, body: pageBody(text.markdown) } : undefined;
}

/** The words of one section of a page (found by its heading, as written or without marks), or of the whole page when none is named. */
export async function readPart(host: SlidesHost, path: string, section: string | null | undefined): Promise<{ page: HostPageText; markdown: string }> {
  const page = await readBody(host, path);
  if (!page) throw new PageError("That page could not be found. It may have been moved or deleted.");
  if (!section) return { page, markdown: page.body };
  const found = pageSection(page.body, section);
  if (found === null) throw new PageError(`The page has no section called "${section}" now.`);
  return { page, markdown: found };
}

/** A heading of a page, as the section picker lists it. */
export interface SectionChoice {
  heading: string;
  title: string;
  level: number;
}

/** The headings of a page, from the host when it lists them itself and from the engine's reading of the Markdown when it does not. */
export async function sectionsOf(host: SlidesHost, path: string): Promise<SectionChoice[]> {
  if (host.pageSections) {
    const found = await host.pageSections(path);
    return found.map(({ heading, title, level }) => ({ heading, title, level }));
  }
  const page = await readBody(host, path);
  return page ? pageSections(page.body).map(({ heading, title, level }) => ({ heading, title, level })) : [];
}

/** The pictures a page names, by the path the page writes them with, and their size in pixels where the host knows it: so they keep their shape. */
export async function picturesOf(host: SlidesHost, markdown: string): Promise<Record<string, [number, number]>> {
  const sizes: Record<string, [number, number]> = {};
  const sources = [...new Set(pageBlocks(markdown).flatMap((block) => (block.type === "image" ? [block.src] : [])))].slice(0, SIZE_LIMIT);
  await Promise.all(
    sources.map(async (src) => {
      try {
        const held = await host.assetInfo?.(src);
        if (held?.width && held.height) sizes[src] = [held.width, held.height];
      } catch {
        // A picture the host cannot tell about is drawn at the shape the engine gives it.
      }
    }),
  );
  return sizes;
}

/** What an element keeps of the page it came from. */
export function sourceOf(page: HostPage, kind: PageSource["kind"], extra: Partial<PageSource> = {}): PageSource {
  return {
    page: page.path,
    ...(page.id ? { id: page.id } : {}),
    title: page.title,
    ...(page.icon ? { icon: page.icon } : {}),
    kind,
    ...extra,
  };
}

/** The page put on the slide as it is read now; resolves to the id of what was made, or undefined when nothing was. */
export async function insertPage(session: EditorSession, choice: PageChoice): Promise<string | undefined> {
  const { host } = session;
  const { page: held, mode } = choice;
  const section = choice.section?.trim() || null;
  if (mode === "link") return insertLink(session, held, section, choice.card === true);
  const { page, markdown } = await readPart(host, held.path, mode === "section" ? section : null);
  const info: HostPage = { ...held, title: page.title || held.title, ...(page.icon ? { icon: page.icon } : {}) };
  if (mode === "embed") {
    const element = {
      type: "embed",
      id: "",
      url: "",
      title: info.title,
      design: { ...PAGE_DESIGN },
      source: sourceOf(info, "embed", { markdown, hash: pageFingerprint(markdown), ...(choice.sync ? { sync: true } : {}) }),
    } as unknown as Element;
    return insertPlaced(session, element, embedSize(true));
  }
  const sizes = await picturesOf(host, markdown);
  if (mode === "slides") {
    const done = session.run(() => session.core.apply("add_page_slides", { markdown, title: info.title, split: choice.split ?? 0, sizes, after: session.state.slideId }));
    const first = done?.output.slides[0];
    if (first) session.goTo(first);
    return first;
  }
  const source = sourceOf(info, mode === "section" ? "section" : "contents", {
    ...(mode === "section" && section ? { section } : {}),
    ...(choice.sync ? { sync: true } : {}),
  });
  const done = session.run(() => session.core.apply("add_page_contents", { slide: session.state.slideId, markdown, source, sizes }));
  if (!done) return undefined;
  session.setTool("select");
  session.select([done.output.id]);
  return done.output.id;
}

/** A link to a page (or to a section of one) as words on the slide, or as a card. */
function insertLink(session: EditorSession, page: HostPage, section: string | null, card: boolean): string | undefined {
  const address = makePageLink(page.path, section);
  const words = `${page.icon ? `${page.icon} ` : ""}${section ? `${page.title} › ${section}` : page.title}`.trim();
  const source = sourceOf(page, "link", section ? { section } : {});
  if (card) {
    const element = {
      ...shape("roundRect", { x: 0, y: 0, w: 0, h: 0 }),
      text: { paragraphs: [{ runs: [{ t: words, color: "bg1", b: true }], align: "center" }], valign: "middle" },
      link: address,
      alt: `Link to the page ${page.title}`,
      name: `Link: ${page.title}`,
      source,
    } as unknown as Element;
    return insertPlaced(session, element, { w: 360, h: 96 });
  }
  const element = {
    ...textBox({ x: 0, y: 0, w: 0, h: 0 }),
    text: { ...plainText(""), paragraphs: [{ runs: [{ t: words, link: address }] }] },
    name: `Link: ${page.title}`,
    source,
  } as unknown as Element;
  return insertPlaced(session, element, CLICK_SIZE.text);
}

/** What an element says about the page it came from, when it came from one. */
export const sourceOfElement = (element: Element | undefined): PageSource | null => element?.source ?? null;

/** Whether an element was made from a page in a way that "Update from page" can make again (its contents, a section, or an embedded page). */
export const updatable = (element: Element | undefined): boolean => {
  const kind = element?.source?.kind;
  return kind === "contents" || kind === "section" || kind === "embed";
};

/** How an element that came from a page stands with it. */
export type Standing = "current" | "changed" | "missing";

/** Whether the page an element came from has changed since, by fingerprint; `missing` when the host no longer has it (or the section). */
export async function standingOf(host: SlidesHost, element: Element): Promise<Standing> {
  const source = element.source;
  if (!source || !updatable(element)) return "current";
  try {
    const { markdown } = await readPart(host, source.page, source.section ?? null);
    return source.hash && source.hash === pageFingerprint(markdown) ? "current" : "changed";
  } catch {
    return "missing";
  }
}

/**
 * Makes the elements `ids` of the shown slide again from their pages as they are now (the whole deck when `ids` is left out), as one
 * step of undo. Resolves to how many were changed and how many pages could not be read.
 */
export async function updateFromPages(session: EditorSession, ids?: readonly string[]): Promise<{ updated: number; missing: number; same: number }> {
  const { host } = session;
  const result = { updated: 0, missing: 0, same: 0 };
  const jobs: { slide: string; element: Element }[] = [];
  const walk = (slide: string, elements: readonly Element[]) => {
    for (const element of elements) {
      if (updatable(element) && (ids === undefined || ids.includes(element.id))) jobs.push({ slide, element });
      if (element.type === "group") walk(slide, element.children);
    }
  };
  if (ids === undefined) for (const slide of session.deck.slides) walk(slide.id, slide.elements);
  else walk(session.state.slideId, session.slide.elements);

  const operations: Parameters<typeof session.core.applyBatch>[0] = [];
  for (const { slide, element } of jobs) {
    const source = element.source as PageSource;
    try {
      const { page, markdown } = await readPart(host, source.page, source.section ?? null);
      if (source.hash === pageFingerprint(markdown) && (element.type !== "embed" || source.markdown === markdown)) {
        result.same += 1;
        continue;
      }
      if (element.type === "embed") {
        const next: PageSource = { ...source, title: page.title || source.title || null, markdown, hash: pageFingerprint(markdown) };
        operations.push(["patch_elements", { slide, patches: [{ id: element.id, patch: { source: next as never, title: page.title || null } }] }]);
      } else {
        operations.push(["update_page_contents", { slide, id: element.id, markdown, title: page.title, sizes: await picturesOf(host, markdown) }]);
      }
      result.updated += 1;
    } catch {
      result.missing += 1;
    }
  }
  if (operations.length > 0) session.run(() => session.core.applyBatch(operations));
  return result;
}

/**
 * Takes the link to the page away from an element, leaving what it shows: contents and sections stay as they are (they were always
 * ordinary elements); an embedded page becomes its words, as plain slide text.
 */
export async function breakLink(session: EditorSession, id: string): Promise<boolean> {
  const [element] = session.elements.find([id]);
  const source = element?.source;
  if (!element || !source) return false;
  if (element.type === "embed" && source.markdown) {
    const box = session.elements.boxOf(element);
    const sizes = await picturesOf(session.host, source.markdown);
    const slide = session.state.slideId;
    const area = box ? { x: box.x, y: box.y, w: box.w, h: box.h } : undefined;
    const operations: Parameters<typeof session.core.applyBatch>[0] = [
      ["add_page_contents", { slide, markdown: source.markdown, sizes, ...(area ? { area } : {}) }],
      ["delete_elements", { slide, ids: [id] }],
    ];
    const done = session.run(() => session.core.applyBatch(operations));
    const made = done?.[0]?.output as { id: string } | undefined;
    if (made) session.select([made.id]);
    return Boolean(done);
  }
  session.elements.patch({ source: null }, [id]);
  return true;
}

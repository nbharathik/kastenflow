// Reviewing the slides that were made from a page after the page has changed. Each element that is kept in step with a page (a storyboard's
// slides, or a section put on a slide with "keep in step") is compared with the page as it reads now by the fingerprint it was made from:
//
// - the page has not changed: nothing to do;
// - the page changed and the slide is as it was made: it can be updated (offered, and ticked);
// - the page changed and the slide was changed by hand too: keep yours (the fingerprint moves on, the slide does not) or replace it;
// - the page, or the section, is gone: said, and nothing is done.
//
// Everything the person chooses is applied as one step of undo.

import { pageFingerprint, pageMadeOf } from "@kasten-slides/wasm";
import type { Element, PageSource } from "@kasten-slides/wasm";

import { slideTitle } from "../dialogs/slide-title.ts";
import type { EditorSession } from "../session/session.ts";
import { picturesOf, readPart } from "../../pages/insert.ts";

/** How a slide stands with its page. */
export type ReviewState = "update" | "edited" | "missing";

/** What the person does with a slide that was changed on both sides. */
export type Choice = "keep" | "replace";

export interface ReviewRow {
  /** Tells the row from the others: the slide and the element. */
  key: string;
  slide: string;
  /** The slide's place in the deck, from 1, and what it is called. */
  number: number;
  title: string;
  element: string;
  page: string;
  section: string | null;
  state: ReviewState;
  /** The page's words as they read now (what an update is made from); empty for a page that is gone. */
  markdown: string;
  /** The page's title now. */
  pageTitle: string | null;
  /** The slide was made without a fingerprint of its words, so whether it was changed by hand cannot be told. */
  unsure: boolean;
  /** Why a row is `missing`. */
  reason: string | null;
}

/** A fingerprint of the kind a storyboard writes in `made`. */
const isFingerprint = (made: string | null | undefined): made is string => typeof made === "string" && /^[0-9a-f]{16}$/.test(made);

/** Whether an element is kept in step with a page it was made from: the contents of a page, or a section, with `sync`. */
export const kept = (element: Element): boolean => element.source?.sync === true && (element.source.kind === "contents" || element.source.kind === "section");

function eachKept(session: EditorSession, visit: (slide: string, element: Element) => void): void {
  const walk = (slide: string, list: readonly Element[]): void => {
    for (const element of list) {
      if (kept(element)) visit(slide, element);
      if (element.type === "group") walk(slide, element.children);
    }
  };
  for (const slide of session.deck.slides) walk(slide.id, slide.elements);
}

/** The slides that need a look, in the order of the deck. Nothing is changed. */
export async function reviewSources(session: EditorSession): Promise<ReviewRow[]> {
  const { host } = session;
  const jobs: { slide: string; element: Element }[] = [];
  eachKept(session, (slide, element) => jobs.push({ slide, element }));
  const rows: ReviewRow[] = [];
  for (const { slide, element } of jobs) {
    const source = element.source as PageSource;
    const at = session.deck.slides.findIndex((s) => s.id === slide);
    const shown = session.deck.slides[at];
    const base = { key: `${slide}/${element.id}`, slide, number: at + 1, title: shown ? slideTitle(shown) : slide, element: element.id, page: source.page, section: source.section ?? null };
    try {
      const { page, markdown } = await readPart(host, source.page, source.section ?? null);
      if (source.hash === pageFingerprint(markdown)) continue;
      const sure = isFingerprint(source.made);
      const edited = sure && source.made !== pageMadeOf(element);
      rows.push({ ...base, state: edited ? "edited" : "update", markdown, pageTitle: page.title || null, unsure: !sure, reason: null });
    } catch (error) {
      rows.push({ ...base, state: "missing", markdown: "", pageTitle: null, unsure: false, reason: error instanceof Error ? error.message : "The page could not be read." });
    }
  }
  return rows;
}

/** What a review came to, for the message. */
export interface Reviewed {
  updated: number;
  kept: number;
  replaced: number;
}

/**
 * Applies the person's choices as one step of undo: the rows in `update` are updated (a slide changed by hand since the review is left alone),
 * and each row that was changed on both sides is replaced or kept as chosen. Rows that are missing are never touched.
 */
export async function applyReview(session: EditorSession, rows: readonly ReviewRow[], update: ReadonlySet<string>, choices: ReadonlyMap<string, Choice>): Promise<Reviewed> {
  const done: Reviewed = { updated: 0, kept: 0, replaced: 0 };
  const operations: Parameters<typeof session.core.applyBatch>[0] = [];
  for (const row of rows) {
    if (row.state === "missing") continue;
    if (row.state === "update") {
      if (!update.has(row.key)) continue;
      operations.push(["update_page_contents", { slide: row.slide, id: row.element, markdown: row.markdown, ...(row.pageTitle ? { title: row.pageTitle } : {}), sizes: await picturesOf(session.host, row.markdown), keepEdits: true }]);
      done.updated += 1;
    } else if ((choices.get(row.key) ?? "keep") === "replace") {
      operations.push(["update_page_contents", { slide: row.slide, id: row.element, markdown: row.markdown, ...(row.pageTitle ? { title: row.pageTitle } : {}), sizes: await picturesOf(session.host, row.markdown) }]);
      done.replaced += 1;
    } else {
      operations.push(["acknowledge_source", { slide: row.slide, id: row.element, markdown: row.markdown }]);
      done.kept += 1;
    }
  }
  if (operations.length > 0) session.run(() => session.core.applyBatch(operations));
  return done;
}

/** What the person is told after a review. */
export function reviewedText({ updated, kept: held, replaced }: Reviewed): string {
  const parts: string[] = [];
  if (updated > 0) parts.push(updated === 1 ? "Updated 1 slide from its page." : `Updated ${updated} slides from their pages.`);
  if (replaced > 0) parts.push(replaced === 1 ? "Replaced 1 slide you had changed." : `Replaced ${replaced} slides you had changed.`);
  if (held > 0) parts.push(held === 1 ? "Kept 1 slide as you had it." : `Kept ${held} slides as you had them.`);
  return parts.length > 0 ? parts.join(" ") : "Nothing was changed.";
}

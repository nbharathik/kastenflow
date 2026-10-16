// The check before a deck leaves (an export) or is shown (a presentation). It is the lint the editor already has (text that does not fit,
// things past the edge, fonts that are missing, citations with no entry, links that go nowhere, what PowerPoint cannot read), plus what only
// the host can say: the pictures and stills it no longer holds, the pages of your notes that are gone, and the web content a still file
// cannot show. Then what the format will change in the deck, listed from the deck. Nothing is changed and nothing is fetched, unless the
// person asks for the web addresses to be looked at.

import type { Deck, Issue } from "@kasten-slides/wasm";

import { lintOf } from "../lint/service.ts";
import type { SlidesHost } from "../host.ts";
import type { EditorSession } from "../session/session.ts";
import { reductionsFor } from "./reductions.ts";
import { type PictureUse, isRemote, pagesOf, picturesOf, webOf } from "./scan.ts";
import type { PreflightFormat, PreflightIssue, PreflightOptions, PreflightReport } from "./types.ts";

/** The lint rules a check before leaving is about. What is merely untidy (overlaps, small type, contrast) is the Lint dialog's. */
const LINT_RULES = ["text-overflow", "off-slide", "font-missing", "unresolved-citation", "broken-link"];

/** How many pictures are asked of the host at once. */
const AT_ONCE = 8;

/** The name of a path in the host's store, for a sentence. */
const nameOf = (path: string): string => path.split(/[\\/]/).pop() || path;

/** Whether the host holds a picture: true or false when it can tell, undefined when it cannot (it gives an address for any path). */
async function holds(host: SlidesHost, path: string): Promise<boolean | undefined> {
  if (host.readImage) {
    try {
      return (await host.readImage(path)) !== undefined;
    } catch {
      return false;
    }
  }
  return host.imageUrl(path) === undefined ? false : undefined;
}

/** The addresses a page of the web answers, asked as a browser would without reading what it says (`no-cors`): a network that is down or a name that is not found fails. */
export async function reachByFetch(address: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    await fetch(address, { method: "HEAD", mode: "no-cors", cache: "no-store", signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Runs `check` on each item, a few at a time. */
async function inBatches<T, R>(items: readonly T[], check: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let at = 0; at < items.length; at += AT_ONCE) out.push(...(await Promise.all(items.slice(at, at + AT_ONCE).map(check))));
  return out;
}

function fromLint(issue: Issue, n: number): PreflightIssue | null {
  if (issue.severity === "info") return null;
  return { id: `lint|${issue.rule}|${issue.slide}|${issue.element ?? ""}|${n}`, severity: issue.severity, rule: issue.rule, slide: issue.slide, element: issue.element ?? null, message: issue.message, ...(issue.hint ? { hint: issue.hint } : {}) };
}

/** Pictures and stills the host no longer holds. */
async function missingPictures(host: SlidesHost, uses: readonly PictureUse[]): Promise<PreflightIssue[]> {
  const local = uses.filter((use) => !isRemote(use.path));
  const paths = [...new Set(local.map((use) => use.path))];
  const answers = new Map(await inBatches(paths, async (path) => [path, await holds(host, path)] as const));
  const issues: PreflightIssue[] = [];
  for (const use of local) {
    if (answers.get(use.path) !== false) continue;
    const where = use.slide === null ? "The theme's picture" : use.poster ? "The still" : "The picture";
    issues.push({
      id: `missing-image|${use.slide ?? ""}|${use.element ?? ""}|${use.path}`,
      severity: "error",
      rule: "missing-image",
      slide: use.slide,
      element: use.element,
      message: `${where} “${nameOf(use.path)}” is not in the host's pictures any more.`,
      hint: use.poster ? "Choose another still, or take the poster off: the file would show a panel with the address instead." : "Put the picture back, choose another, or delete the box: the file would show a grey box.",
    });
  }
  return issues;
}

/** Links to pages of the host, and pages elements were made from, that are not there. */
async function missingPages(host: SlidesHost, deck: Deck, unchecked: string[]): Promise<PreflightIssue[]> {
  const uses = pagesOf(deck);
  if (uses.length === 0) return [];
  if (!host.listPages) {
    unchecked.push("Links to pages: this editor has no pages to look them up in.");
    return [];
  }
  let known: Set<string>;
  try {
    const pages = await host.listPages();
    known = new Set(pages.flatMap((page) => [page.path, ...(page.id ? [page.id] : [])]));
  } catch {
    unchecked.push("Links to pages: the pages could not be listed.");
    return [];
  }
  const issues: PreflightIssue[] = [];
  const seen = new Set<string>();
  for (const use of uses) {
    const key = `${use.slide ?? ""}|${use.element ?? ""}|${use.path}|${use.how}`;
    if (known.has(use.path) || seen.has(key)) continue;
    seen.add(key);
    issues.push({
      id: `missing-page|${key}`,
      severity: "warning",
      rule: "missing-page",
      slide: use.slide,
      element: use.element,
      message: use.how === "link" ? `This link goes to “${nameOf(use.path)}”, which is not in your notes any more.` : `This was made from “${nameOf(use.path)}”, which is not in your notes any more; it keeps what the page said.`,
      hint: use.how === "link" ? "Choose another page, or take the link off." : "It cannot be updated from the page. Break the link to stop being asked.",
    });
  }
  return issues;
}

/** Web pages and videos that a still file cannot play: they need a still to show. */
function needPosters(deck: Deck, format: PreflightFormat): PreflightIssue[] {
  // A PowerPoint file's own lint rule says the same; a presentation and a web page show them live.
  if (format !== "pdf" && format !== "png") return [];
  const issues: PreflightIssue[] = [];
  const visit = (slide: string, list: Deck["slides"][number]["elements"]): void => {
    for (const element of list) {
      const poster = element.type === "embed" || element.type === "video" ? (element.poster ?? "") : "";
      if (element.type === "embed" && /^https?:/i.test(element.url.trim()) && poster === "") {
        issues.push({ id: `needs-poster|${slide}|${element.id}`, severity: "warning", rule: "needs-poster", slide, element: element.id, message: `The web page ${element.url.trim()} cannot be shown live in ${format === "pdf" ? "a PDF" : "a picture"}, and has no poster.`, hint: "Choose a still of the page as its poster, or the file shows a dashed panel with its address." });
      } else if (element.type === "video" && poster === "") {
        issues.push({ id: `needs-poster|${slide}|${element.id}`, severity: "warning", rule: "needs-poster", slide, element: element.id, message: `The video cannot play in ${format === "pdf" ? "a PDF" : "a picture"}, and has no poster.`, hint: "Choose a still from the video as its poster, or the file shows a dark panel with a play button." });
      }
      if (element.type === "group") visit(slide, element.children);
    }
  };
  for (const slide of deck.slides) visit(slide.id, slide.elements);
  return issues;
}

/** Web addresses that cannot be reached from here, when the person asked to look. */
async function unreachable(deck: Deck, options: PreflightOptions, unchecked: string[]): Promise<PreflightIssue[]> {
  const uses = webOf(deck);
  if (uses.length === 0) return [];
  if (!options.network) {
    unchecked.push(`${uses.length === 1 ? "1 web address" : `${uses.length} web addresses`} (pages and pictures from the web) ${uses.length === 1 ? "was" : "were"} not looked at: that is done only when you ask.`);
    return [];
  }
  const reach = options.reach ?? reachByFetch;
  const addresses = [...new Set(uses.map((use) => use.address))];
  const answers = new Map(await inBatches(addresses, async (address) => [address, await reach(address).catch(() => false)] as const));
  return uses
    .filter((use) => answers.get(use.address) === false)
    .map((use) => ({
      id: `unreachable|${use.slide ?? ""}|${use.element ?? ""}|${use.address}`,
      severity: "warning" as const,
      rule: "unreachable",
      slide: use.slide,
      element: use.element,
      message: `${use.address} could not be reached from here.`,
      hint: use.kind === "embed" ? "Offline, or the site refuses to answer. Choose a poster so the slide does not depend on it." : "Offline, or the site refuses to answer. A picture from the web is not kept in the deck: save it and use the file.",
    }));
}

/**
 * What a deck needs looked at before it becomes `format`. Errors are things that will be wrong in the result; warnings are things that will
 * be different or that the host cannot vouch for; `reductions` lists what the format changes; `unchecked` says what was not looked at.
 */
export async function runPreflight(session: EditorSession, host: SlidesHost, format: PreflightFormat, options: PreflightOptions = {}): Promise<PreflightReport> {
  const deck = session.deck;
  const unchecked: string[] = [];
  const found: PreflightIssue[] = [];

  // The lint the editor already has, for the rules that matter on the way out.
  if (options.lint !== false) {
    const lint = lintOf(session);
    await lint.checkAll();
    const snapshot = lint.getSnapshot();
    const rules = new Set(format === "pptx" ? [...LINT_RULES, "pptx-unsafe"] : LINT_RULES);
    for (const slide of deck.slides) {
      (snapshot.issues.get(slide.id) ?? []).forEach((issue, n) => {
        const mine = rules.has(issue.rule) ? fromLint(issue, n) : null;
        if (mine) found.push(mine);
      });
    }
    for (const skipped of snapshot.skipped) if (rules.has(skipped.rule)) unchecked.push(`${skipped.rule}: ${skipped.reason}`);
  }

  found.push(...(await missingPictures(host, picturesOf(deck))));
  found.push(...(await missingPages(host, deck, unchecked)));
  found.push(...needPosters(deck, format));
  found.push(...(await unreachable(deck, options, unchecked)));

  // In the order of the deck: a slide's problems together, the theme's last.
  const place = new Map(deck.slides.map((slide, i) => [slide.id, i]));
  const at = (issue: PreflightIssue): number => (issue.slide === null ? deck.slides.length : (place.get(issue.slide) ?? deck.slides.length));
  const ordered = found.map((issue, i) => ({ issue, i })).sort((a, b) => at(a.issue) - at(b.issue) || a.i - b.i).map(({ issue }) => issue);
  return {
    format,
    errors: ordered.filter((issue) => issue.severity === "error"),
    warnings: ordered.filter((issue) => issue.severity === "warning"),
    reductions: reductionsFor(deck, format),
    unchecked,
  };
}

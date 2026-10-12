// A page shown inside another: `![[Title]]` on a line of its own, as
// Obsidian's embeds and Notion's synced blocks show one. The page's content
// is drawn read-only with the editor's own schema, so it looks like the page
// it came from; `![[Title#Plan]]` shows only that section. It loads again
// only when the embedded page changes. The Markdown stays `![[Title]]`.

import { parserCtx, schemaCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { DOMSerializer, Fragment, type Node as DocNode } from "@milkdown/kit/prose/model";

import { sectionOf } from "../../markdown/sections";
import { isFileTarget, linksOf, parseWikiTarget, type EmbeddedPage } from "../links";
import { el, withGlyph } from "../ui/dom";

/** Blocks drawn at most; a longer page shows its start. */
const MAX_BLOCKS = 60;

/** The embedded page's content as DOM, or a line saying why there is none. */
export function embedContent(ctx: Ctx, page: EmbeddedPage, heading: string): Node {
  const markdown = heading ? sectionOf(page.markdown, heading) : page.markdown;
  if (markdown === null) return el("p", "kasten-embed-note", { textContent: `“${page.title}” has no section “${heading}”.` });
  if (!markdown.trim()) return el("p", "kasten-embed-note", { textContent: "An empty page." });
  let blocks: Fragment;
  try {
    const doc = ctx.get(parserCtx)(markdown);
    const children: DocNode[] = [];
    doc.content.forEach((child) => void (children.length < MAX_BLOCKS && children.push(child)));
    blocks = Fragment.fromArray(children);
  } catch {
    return el("p", "kasten-embed-note", { textContent: markdown.slice(0, 2000) });
  }
  const dom = DOMSerializer.fromSchema(ctx.get(schemaCtx)).serializeFragment(blocks);
  // Pictures are linked relative to the embedded page, not this one.
  for (const img of dom.querySelectorAll("img")) img.setAttribute("src", page.url(img.getAttribute("src") ?? ""));
  // Links inside read as page names, not as `[[brackets]]`.
  for (const link of dom.querySelectorAll<HTMLElement>("[data-wiki-link]")) {
    const target = parseWikiTarget(link.dataset.wikiLink ?? "");
    link.textContent = target.alias || target.title;
    link.className = "kasten-embed-link";
  }
  return dom;
}

/** Draws an embed into `dom`, which the link's node view owns. */
export class EmbedCard {
  /** The link and page version drawn last, so an unchanged page is not
   * fetched again when the page around it saves. */
  private drawn: string | null = null;
  private ticket = 0;

  constructor(
    private readonly dom: HTMLElement,
    private readonly ctx: Ctx,
  ) {}

  render(value: string): void {
    const target = parseWikiTarget(value);
    const source = linksOf(this.ctx).embed?.(target.title) ?? null;
    const key = `${value}\u0000${source?.stamp ?? "missing"}`;
    if (key === this.drawn) return;
    this.drawn = key;
    const ticket = ++this.ticket;
    const label = target.heading ? `${target.alias || target.title} › ${target.heading}` : target.alias || target.title;
    if (!source) {
      // A file is never a page to make: its name says what it is.
      const note = isFileTarget(target.title) ? `No file called “${target.title}”.` : `No page called “${target.title}” yet. Click to create it.`;
      this.draw(label, undefined, el("p", "kasten-embed-note", { textContent: note }));
      return;
    }
    if (!this.dom.querySelector(".kasten-embed-body")) this.draw(label, undefined, el("p", "kasten-embed-note", { textContent: "Loading…" }));
    source.load().then(
      (page) => ticket === this.ticket && this.draw(label, page.icon, embedContent(this.ctx, page, target.heading)),
      () => ticket === this.ticket && this.draw(label, undefined, el("p", "kasten-embed-note", { textContent: `“${target.title}” could not be read.` })),
    );
  }

  /** Forgets what was drawn, so the next render draws again. */
  reset(): void {
    this.drawn = null;
    this.ticket++;
  }

  private draw(label: string, icon: string | undefined, content: Node): void {
    const head = el("span", "kasten-embed-head");
    head.append(
      withGlyph(el("span", "kasten-embed-icon"), icon ?? "icon:page", 16),
      el("span", "kasten-embed-title", { textContent: label }),
      el("span", "kasten-embed-open", { textContent: "Open ↗" }),
    );
    const body = el("div", "kasten-embed-body");
    body.append(content);
    this.dom.replaceChildren(head, body);
  }
}

// A `[[link]]` as Notion shows a page mention: the page's icon and title,
// underlined, without brackets. A click opens the page; a link to a page
// that does not exist yet shows greyed and creates it; a link whose title
// several pages share, with nothing to pick one, asks which. A link to a file
// (a deck, a whiteboard) opens it and never makes a page. A
// link alone on its line, as /page makes for a sub-page, is a page block: a
// full-width row with a hint of the page's text. An embed on a line of its
// own (`![[Title]]`) shows the page itself (embed-view.ts), a whiteboard, a
// database or a deck.

import type { Ctx } from "@milkdown/kit/ctx";
import type { Node } from "@milkdown/kit/prose/model";
import type { Decoration, EditorView, NodeView } from "@milkdown/kit/prose/view";
import { $view } from "@milkdown/kit/utils";

import { findLink, foundPage, isBoardTarget, isDatabaseTarget, isDeckTarget, isDiagramTarget, isFileTarget, linkHowOf, linksOf, parseWikiTarget, retarget, type PageLink } from "../links";
import type { Popover } from "../ui/popover";
import { el, withGlyph } from "../ui/dom";
import { isAlone } from "./alone";
import { BoardEmbed } from "./board-embed";
import { DatabaseEmbed } from "./database-embed";
import { DeckEmbed } from "./deck-embed";
import { DiagramEmbed } from "./diagram-embed";
import { EmbedCard } from "./embed-view";
import { fileMention } from "./file-mention";
import { chooseLink } from "./link-chooser";
import { attachPeek, hidePeekOf } from "./mention-preview";
import { wikiLinkSchema } from "../wikilink";

/** Live mentions, so they can show pages created after they were drawn. */
const views = new Set<WikiLinkView>();

/** Page blocks' hints by title, read once and kept until pages change. */
const hints = new Map<string, string>();

/** Redraws every mention, e.g. after pages were created, renamed or trashed. */
export function refreshMentions(): void {
  hints.clear();
  for (const view of views) view.refresh();
}

/** Whether an event came from an embedded page's header. */
const inHead = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest(".kasten-embed-head"));

class WikiLinkView implements NodeView {
  readonly dom: HTMLElement;
  private card: EmbedCard | null = null;
  private board: BoardEmbed | null = null;
  private database: DatabaseEmbed | null = null;
  private deck: DeckEmbed | null = null;
  private diagram: DiagramEmbed | null = null;
  private chooser: Popover | null = null;

  constructor(
    private node: Node,
    private readonly ctx: Ctx,
    private aloneOnLine: boolean,
    private readonly view?: EditorView,
    private readonly getPos?: () => number | undefined,
  ) {
    this.dom = el("span", "kasten-mention", { contentEditable: "false" });
    this.dom.addEventListener("mousedown", (event) => {
      // An embedded whiteboard, database, deck or diagram takes its own clicks.
      if (this.board?.owns(event.target) || this.database?.owns(event.target) || this.deck?.owns(event.target) || this.diagram?.owns(event.target) || this.card?.owns(event.target)) return;
      // The middle button opens a new tab, as in a browser.
      if (event.button !== 0 && event.button !== 1) return;
      // A page, deck or diagram shown in place acts on a click (below): pressing it to
      // select its text or to drag its block opens nothing.
      if (this.card || this.deck || this.diagram) {
        if (inHead(event.target)) event.preventDefault();
        return;
      }
      event.preventDefault();
      this.follow(event);
    });
    // A page or deck shown in place opens from its header; a page not written
    // yet is made from a click anywhere on it, as it says.
    const clicked = (event: MouseEvent) => {
      if (!(this.card || this.deck || this.diagram) || (event.button !== 0 && event.button !== 1)) return;
      if (!inHead(event.target) && !(this.card && this.missing())) return;
      event.preventDefault();
      this.follow(event);
    };
    this.dom.addEventListener("click", clicked);
    this.dom.addEventListener("auxclick", clicked);
    // A right-click shows the Open menu for the file the link names; on a page
    // or deck shown in place, from its header only.
    this.dom.addEventListener("contextmenu", (event) => {
      if (this.dom.classList.contains("kasten-embed") && !inHead(event.target)) return;
      const path = this.vaultPath();
      if (path && linksOf(this.ctx).openMenu?.(event, path)) event.preventDefault();
    });
    attachPeek(
      this.dom,
      () => parseWikiTarget(String(this.node.attrs.value)).title,
      () => linksOf(this.ctx),
    );
    this.render();
    views.add(this);
  }

  refresh(): void {
    this.render();
  }

  destroy(): void {
    views.delete(this);
    hidePeekOf(this.dom);
    this.chooser?.close();
    this.board?.destroy();
    this.database?.destroy();
    this.deck?.destroy();
    this.diagram?.destroy();
    // A smart page shown in place stops with its page.
    this.card?.reset();
  }

  update(node: Node, decorations: readonly Decoration[]): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.aloneOnLine = isAlone(decorations);
    this.render();
    return true;
  }

  stopEvent(event: Event): boolean {
    if (this.board?.owns(event.target) || this.database?.owns(event.target) || this.deck?.owns(event.target) || this.diagram?.owns(event.target) || this.card?.owns(event.target)) return true;
    // A head's icon tool is a button the keyboard presses: the editor leaves its keys alone.
    if (event.type === "keydown" && event.target instanceof Element && event.target.closest(".kasten-embed-tool")) return true;
    return event.type === "mousedown" || event.type === "click";
  }

  ignoreMutation(): boolean {
    return true;
  }

  /** Opens the linked page: Ctrl or Cmd for a new tab, Shift for the side
   * stack, Alt for a split. */
  private follow(event: MouseEvent): void {
    const links = linksOf(this.ctx);
    const { title, heading } = parseWikiTarget(String(this.node.attrs.value));
    const how = linkHowOf(event);
    // `[[#Heading]]` goes to a heading on this page.
    if (!title && heading) return links.open("", how, heading);
    // A file opens, or does nothing when it is not there; it never makes a page.
    if (isFileTarget(title)) return void fileMention(links, title)?.open(how);
    const go = (target: string) => (heading ? links.open(target, how, heading) : links.open(target, how));
    const found = findLink(links, title);
    if (found && "choices" in found) {
      this.chooser?.close();
      const relink = links.linkText && this.view ? (page: PageLink) => this.relink(page) : null;
      this.chooser = chooseLink(this.dom, found.choices, (page) => go(page.path ?? page.title), relink);
      return;
    }
    const page = foundPage(found);
    if (page || !links.create) go(page?.path ?? title);
    else void links.create(title, true);
  }

  /** The vault path of what the link names, when it names one thing. */
  private vaultPath(): string | null {
    const links = linksOf(this.ctx);
    const { title } = parseWikiTarget(String(this.node.attrs.value));
    if (isFileTarget(title)) return fileMention(links, title)?.path ?? null;
    return foundPage(findLink(links, title))?.path ?? null;
  }

  /** Whether the link goes to no page yet, which a click makes. A file is
   * never a page to make. */
  private missing(): boolean {
    const { title } = parseWikiTarget(String(this.node.attrs.value));
    return !isFileTarget(title) && findLink(linksOf(this.ctx), title) === null;
  }

  /** Makes the link name `page`, so it no longer asks. */
  private relink(page: PageLink): void {
    const text = linksOf(this.ctx).linkText?.(page);
    const pos = this.getPos?.();
    if (!text || pos === undefined || !this.view) return;
    const value = retarget(String(this.node.attrs.value), text, page.title);
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, value }));
  }

  /** Whether the link is alone on its line, where an embed shows the page
   * and a plain link is a page block (from `aloneLinks`). */
  private alone(): boolean {
    return this.aloneOnLine;
  }

  /** What the link shows: a whiteboard, a database, a deck or a page in
   * place, or a mention (a file that has no view of its own is one too). */
  private kind(value: string, embed: boolean): "board" | "database" | "deck" | "diagram" | "page" | "mention" {
    if (!embed || !this.alone()) return "mention";
    const target = parseWikiTarget(value).title;
    if (isBoardTarget(target)) return "board";
    if (isDatabaseTarget(target)) return "database";
    if (isDeckTarget(target)) return "deck";
    // `![[x.drawio]]` is a diagram, never a page: it must not fall into the page embed.
    if (isDiagramTarget(target)) return "diagram";
    return isFileTarget(target) ? "mention" : "page";
  }

  private render(): void {
    const value = String(this.node.attrs.value);
    const embed = Boolean(this.node.attrs.embed);
    const kind = this.kind(value, embed);
    // Whatever drew the link before goes away when it now shows another way.
    if (kind !== "board" && this.board) {
      this.board.destroy();
      this.board = null;
    }
    if (kind !== "database" && this.database) {
      this.database.destroy();
      this.database = null;
    }
    if (kind !== "deck" && this.deck) {
      this.deck.destroy();
      this.deck = null;
    }
    if (kind !== "diagram" && this.diagram) {
      this.diagram.destroy();
      this.diagram = null;
    }
    if (kind !== "page" && this.card) {
      this.card.reset();
      this.card = null;
    }
    if (kind !== "mention") {
      this.dom.className = `kasten-embed${kind === "board" ? " kasten-board-embed" : kind === "database" ? " kasten-db-embed" : kind === "deck" ? " kasten-deck-embed" : kind === "diagram" ? " kasten-diagram-embed" : ""}`;
      this.dom.title = "";
      this.dom.dataset.wikiLink = value;
    }
    if (kind === "board") {
      this.board ??= new BoardEmbed(this.dom, this.ctx);
      return this.board.render(value);
    }
    if (kind === "database") {
      this.database ??= new DatabaseEmbed(this.dom, this.ctx);
      return this.database.render(value);
    }
    if (kind === "deck") {
      this.deck ??= new DeckEmbed(this.dom, this.ctx);
      return this.deck.render(value);
    }
    if (kind === "diagram") {
      this.diagram ??= new DiagramEmbed(this.dom, this.ctx);
      return this.diagram.render(value);
    }
    if (kind === "page") {
      this.card ??= new EmbedCard(this.dom, this.ctx);
      return this.card.render(value);
    }
    const target = parseWikiTarget(value);
    const file = fileMention(linksOf(this.ctx), target.title);
    const found = file ? (file.found ? { page: { title: file.title, icon: file.icon } } : null) : findLink(linksOf(this.ctx), target.title);
    const page = foundPage(found);
    const choices = found && "choices" in found ? found.choices : null;
    const shown = page?.title ?? choices?.[0]?.title ?? (file ? file.title : target.title);
    const label = target.alias || (target.heading ? `${shown} › ${target.heading}` : shown);
    const block = !embed && !file && this.alone();
    this.dom.className = `kasten-mention${block ? " is-block" : ""}${found ? "" : " is-missing"}${choices ? " is-ambiguous" : ""}${embed ? " is-embed" : ""}`;
    this.dom.title = page ? `Open ${shown}` : choices ? `${choices.length} pages are called ${shown}: click to choose one` : file ? `No file called ${target.title}` : `Create ${target.title}`;
    this.dom.dataset.wikiLink = value;
    const icon = withGlyph(el("span", "kasten-mention-icon"), embed ? "↪" : (page?.icon ?? (file ? file.icon : "icon:page")), block ? 18 : 15);
    const title = el("span", "kasten-mention-title", { textContent: label });
    if (!block) return void this.dom.replaceChildren(icon, title);
    const hint = el("span", "kasten-page-block-hint", { textContent: found ? "" : "A new page. Click to start it" });
    if (page) this.hint(page.path ?? target.title, hint);
    this.dom.replaceChildren(icon, title, hint, withGlyph(el("span", "kasten-page-block-open"), "icon:arrow-up-right", 15));
  }

  /** The start of the page's text, beside its title in a page block. */
  private hint(title: string, into: HTMLElement): void {
    const known = hints.get(title);
    if (known !== undefined) return void (into.textContent = known);
    void linksOf(this.ctx)
      .preview?.(title)
      .then((preview) => {
        const text = (preview?.text ?? "").replace(/\s+/g, " ").trim();
        hints.set(title, text);
        if (into.isConnected) into.textContent = text;
      })
      .catch(() => {});
  }
}

export const wikiLinkView = $view(
  wikiLinkSchema.node,
  (ctx) => (node, view, getPos, decorations) => new WikiLinkView(node, ctx, isAlone(decorations), view, getPos),
);

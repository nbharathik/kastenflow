// A tag database shown inside a page, as Notion's inline databases are:
// `![[tags/paper.yaml]]` on a line of its own, `![[tags/paper.yaml#Board]]`
// for one of its views. The window draws the database's views
// live (LinkProvider.mountDatabase): edits in its table or board are the
// notes' own. The Markdown stays the link.

import "./database-embed.css";

import type { Ctx } from "@milkdown/kit/ctx";

import { findDatabase, linksOf, parseWikiTarget } from "../links";
import { el, withGlyph } from "../ui/dom";
import { freshHost } from "./embed-host";
import { embedTool } from "./embed-tools";

export class DatabaseEmbed {
  private readonly body: HTMLElement;
  private readonly title: HTMLElement;
  private mounted: { key: string; unmount: () => void } | null = null;
  private tag: string | null = null;

  constructor(
    private readonly dom: HTMLElement,
    private readonly ctx: Ctx,
  ) {
    this.title = el("span", "kasten-embed-title");
    // An icon, no words: its name is for screen readers and the tooltip.
    const open = embedTool("kasten-board-embed-open", "icon:arrow-up-right", "Open database", "Open the database (Ctrl+click for a new tab)");
    const openDatabase = (how: "here" | "tab") => {
      if (this.tag) linksOf(this.ctx).openDatabase?.(this.tag, how);
    };
    open.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openDatabase(event.ctrlKey || event.metaKey || event.button === 1 ? "tab" : "here");
    });
    // The keyboard presses the button: Enter and Space arrive as a click that no mouse press came before.
    open.addEventListener("click", (event) => {
      if (event.detail === 0) openDatabase(event.ctrlKey || event.metaKey ? "tab" : "here");
    });
    const head = el("span", "kasten-embed-head");
    head.append(withGlyph(el("span", "kasten-embed-icon"), "icon:database", 16), this.title, open);
    this.body = el("div", "kasten-db-embed-body");
    this.dom.replaceChildren(head, this.body);
  }

  /** Whether an event belongs to the database, so the page leaves it alone. */
  owns(target: EventTarget | null): boolean {
    return target instanceof Node && (this.body.contains(target) || this.dom.querySelector(".kasten-board-embed-open")?.contains(target) === true);
  }

  render(value: string): void {
    const target = parseWikiTarget(value);
    const links = linksOf(this.ctx);
    const found = findDatabase(links.databases?.() ?? [], target.title);
    this.tag = found?.tag ?? null;
    this.title.textContent = found ? `#${found.tag}${target.heading ? ` › ${target.heading}` : ""}` : target.title;
    if (!found || !links.mountDatabase) {
      this.unmount();
      this.body.replaceChildren(el("p", "kasten-embed-note", { textContent: found ? "Databases show here in the app." : `No tag database “${target.title}”.` }));
      return;
    }
    const key = `${found.tag}\u0000${target.heading}`;
    if (this.mounted?.key === key) return;
    this.unmount();
    this.mounted = { key, unmount: links.mountDatabase(freshHost(this.body), found.tag, target.heading) };
  }

  destroy(): void {
    this.unmount();
  }

  private unmount(): void {
    const mounted = this.mounted;
    this.mounted = null;
    if (mounted) queueMicrotask(mounted.unmount);
  }
}

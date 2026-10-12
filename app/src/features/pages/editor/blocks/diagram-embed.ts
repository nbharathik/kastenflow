// A diagram shown inside a page: `![[Flow.drawio]]` (or a plain Markdown
// image of its picture) on a line of its own. The page shows the diagram's
// picture, centred, as an ordinary image: no editor is needed to see it. The
// window draws it (LinkProvider.mountDiagram), with a toolbar on hover (Edit,
// Open in a tab, Copy as image, Export) and a double click to edit; the
// Markdown stays the link. The title above it is for the header's click and
// shows on hover.

import "./diagram-embed.css";

import type { Ctx } from "@milkdown/kit/ctx";

import { findDiagram, linksOf, parseWikiTarget } from "../links";
import { el, withGlyph } from "../ui/dom";
import { freshHost } from "./embed-host";

export class DiagramEmbed {
  private readonly body: HTMLElement;
  private readonly title: HTMLElement;
  private mounted: { path: string; unmount: () => void } | null = null;
  private path: string | null = null;

  constructor(
    private readonly dom: HTMLElement,
    private readonly ctx: Ctx,
  ) {
    this.title = el("span", "kasten-embed-title");
    const head = el("span", "kasten-embed-head");
    head.append(withGlyph(el("span", "kasten-embed-icon"), "icon:diagram", 16), this.title);
    this.body = el("div", "kasten-diagram-embed-body");
    this.dom.replaceChildren(head, this.body);
  }

  /** Whether an event belongs to the picture and its toolbar, so the page leaves it alone. */
  owns(target: EventTarget | null): boolean {
    return target instanceof Node && this.body.contains(target);
  }

  /** The diagram this shows, for the header's click. */
  get diagramPath(): string | null {
    return this.path;
  }

  render(value: string): void {
    const target = parseWikiTarget(value).title;
    const links = linksOf(this.ctx);
    const diagram = findDiagram(links.diagrams?.() ?? [], target);
    this.title.textContent = diagram?.title ?? target.replace(/^.*\//, "").replace(/\.drawio(\.svg)?$/i, "");
    this.path = diagram?.path ?? null;
    if (!diagram || !links.mountDiagram) {
      this.unmount();
      this.body.replaceChildren(el("p", "kasten-embed-note", { textContent: diagram ? "Diagrams show here in the app." : `No diagram “${target}”.` }));
      return;
    }
    if (this.mounted?.path === diagram.path) return;
    this.unmount();
    this.mounted = { path: diagram.path, unmount: links.mountDiagram(freshHost(this.body), diagram.path) };
  }

  destroy(): void {
    this.unmount();
  }

  private unmount(): void {
    const mounted = this.mounted;
    this.mounted = null;
    // The page may be going away inside React's own update: let it finish.
    if (mounted) queueMicrotask(mounted.unmount);
  }
}

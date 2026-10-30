// A smart page shown inside another: `![[Conference tracker]]` on a line of its
// own, `![[Conference tracker#deadlines]]` for one named view of it. The window
// draws the live view (LinkProvider.mountSmart); the page around it holds only
// the link, never HTML or scripts. This is the part of a page embed that
// replaces the page's Markdown when the page is a smart page.

import type { Ctx } from "@milkdown/kit/ctx";

import { linksOf, type EmbeddedPage } from "../links";
import { freshHost } from "./embed-host";

export class SmartEmbed {
  private mounted: { unmount: () => void } | null = null;
  private body: HTMLElement | null = null;

  constructor(private readonly ctx: Ctx) {}

  /** Draws the page's view into `body`; false when this window cannot draw smart pages (the Markdown shows instead). */
  mount(body: HTMLElement, page: EmbeddedPage, view: string): boolean {
    const links = linksOf(this.ctx);
    if (!page.smart || !links.mountSmart) return false;
    this.unmount();
    this.body = body;
    this.mounted = { unmount: links.mountSmart(freshHost(body), { path: page.smart.path, id: page.smart.id, title: page.title, view }) };
    return true;
  }

  /** Whether an event belongs to the smart view, so the page around it leaves it alone. */
  owns(target: EventTarget | null): boolean {
    return target instanceof Node && this.body !== null && this.body.contains(target);
  }

  unmount(): void {
    const mounted = this.mounted;
    this.mounted = null;
    this.body = null;
    // The page may be going away inside React's own update: let it finish.
    if (mounted) queueMicrotask(mounted.unmount);
  }
}

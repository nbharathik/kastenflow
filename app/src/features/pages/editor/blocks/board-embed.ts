// A whiteboard shown inside a page: `![[path/board.canvas]]` on a line of
// its own, as Obsidian embeds a canvas. The board is live: after
// a click on it, it pans, zooms and edits as it does in its own tab, and its
// bars (tools, zoom) appear; a click outside hands the page its scrolling and
// keys back and the bars go. A slim header names it, opens it and presents it;
// a grip on its bottom edge sets how tall it is, which is kept per board. The
// window draws the board (LinkProvider.mountBoard); the Markdown stays the link.

import "./board-embed.css";

import type { Ctx } from "@milkdown/kit/ctx";

import { findBoard, linksOf, parseWikiTarget } from "../links";
import { el, withGlyph } from "../ui/dom";
import { clampHeight, heightOf, keepHeight } from "./embed-heights";
import { freshHost } from "./embed-host";

/** The key presses on the grip that make the embed taller or shorter, in pixels. */
const STEP = 40;

export class BoardEmbed {
  private readonly body: HTMLElement;
  private readonly cover: HTMLElement;
  private readonly title: HTMLElement;
  private readonly chrome: HTMLElement[];
  private mounted: { path: string; unmount: () => void } | null = null;
  private path: string | null = null;
  private readonly outside = (event: PointerEvent) => {
    if (!this.dom.contains(event.target as Node)) this.setActive(false);
  };

  constructor(
    private readonly dom: HTMLElement,
    private readonly ctx: Ctx,
  ) {
    this.title = el("span", "kasten-embed-title");
    const open = el("button", "kasten-board-embed-open", { type: "button", textContent: "Open ↗", title: "Open the whiteboard (Ctrl+click for a new tab)" });
    open.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.path) linksOf(this.ctx).openBoard?.(this.path, event.ctrlKey || event.metaKey || event.button === 1 ? "tab" : event.shiftKey ? "stack" : "here");
    });
    const present = el("button", "kasten-board-embed-present", { type: "button", textContent: "Present", title: "Present the whiteboard's sections" });
    present.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      // The board inside answers: it is the one that knows its sections.
      this.dom.dispatchEvent(new CustomEvent("kasten:present"));
    });
    const head = el("span", "kasten-embed-head");
    head.append(withGlyph(el("span", "kasten-embed-icon"), "icon:board", 16), this.title, present, open);
    this.body = el("div", "kasten-board-embed-body");
    this.cover = el("button", "kasten-board-embed-cover", { type: "button", textContent: "Click to work on the whiteboard" });
    this.cover.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.setActive(true);
    });
    const grip = this.grip();
    this.dom.replaceChildren(head, this.body, this.cover, grip);
    this.chrome = [open, present, grip];
  }

  /** The grip on the bottom edge: drag it, or use the arrow keys on it, to set the height. */
  private grip(): HTMLElement {
    const grip = el("div", "kasten-board-embed-grip", { tabIndex: 0, title: "Drag to set the height" });
    grip.setAttribute("role", "separator");
    grip.setAttribute("aria-orientation", "horizontal");
    grip.setAttribute("aria-label", "Whiteboard height");
    const set = (height: number) => {
      const value = clampHeight(height);
      this.body.style.height = `${value}px`;
      grip.setAttribute("aria-valuenow", String(value));
      return value;
    };
    const current = () => this.body.offsetHeight || heightOf(this.path ?? "");
    grip.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const y0 = event.clientY;
      const h0 = current();
      let height = h0;
      const move = (e: PointerEvent) => {
        height = set(h0 + e.clientY - y0);
      };
      const end = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
        if (this.path) keepHeight(this.path, height);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    });
    grip.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      event.stopPropagation();
      const height = set(current() + (event.key === "ArrowDown" ? STEP : -STEP));
      if (this.path) keepHeight(this.path, height);
    });
    return grip;
  }

  /** Whether an event belongs to the board, so the page leaves it alone. */
  owns(target: EventTarget | null): boolean {
    return target instanceof Node && (this.body.contains(target) || this.cover.contains(target) || this.chrome.some((part) => part.contains(target)));
  }

  render(value: string): void {
    const target = parseWikiTarget(value).title;
    const links = linksOf(this.ctx);
    const board = findBoard(links.boards?.() ?? [], target);
    this.title.textContent = board?.title ?? target.replace(/^.*\//, "").replace(/\.canvas$/i, "");
    this.path = board?.path ?? null;
    if (board) this.body.style.height = `${heightOf(board.path)}px`;
    if (!board || !links.mountBoard) {
      this.unmount();
      this.body.replaceChildren(el("p", "kasten-embed-note", { textContent: board ? "Whiteboards show here in the app." : `No whiteboard “${target}”.` }));
      this.cover.hidden = true;
      return;
    }
    this.cover.hidden = this.dom.dataset.active === "true";
    if (this.mounted?.path === board.path) return;
    this.unmount();
    this.mounted = { path: board.path, unmount: links.mountBoard(freshHost(this.body), board.path, { embedded: true }) };
  }

  destroy(): void {
    this.setActive(false);
    this.unmount();
  }

  private setActive(active: boolean): void {
    if (active) {
      this.dom.dataset.active = "true";
      this.cover.hidden = true;
      document.addEventListener("pointerdown", this.outside, true);
    } else {
      delete this.dom.dataset.active;
      this.cover.hidden = !this.mounted;
      document.removeEventListener("pointerdown", this.outside, true);
    }
  }

  private unmount(): void {
    const mounted = this.mounted;
    this.mounted = null;
    // The page may be going away inside React's own update: let it finish.
    if (mounted) queueMicrotask(mounted.unmount);
  }
}

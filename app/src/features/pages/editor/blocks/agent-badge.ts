// The badge on the first block of an agent's writing, and the card it
// opens: who wrote it and when, with Accept, Undo this session and See in
// History. Undoing a whole session asks
// first, in place.

import { relativeTime } from "../../../../lib/dates";
import { said } from "../../../../lib/said";
import type { AgentMark } from "../../../../lib/vault/types";
import { el, withGlyph } from "../ui/dom";
import type { AgentActions } from "./agent-marks";

const GAP = 6;
const MARGIN = 8;
/** The badge's height in agent.css. */
const BADGE_HEIGHT = 20;
/** Less room than this and the badge shows its star alone. */
const NAME_ROOM = 48;

let current: Card | null = null;

/** Lines the badge up with the first line of the block after its anchor
 * (the anchor sits above that block's top margin), and gives the name the
 * room there is before whatever clips the page. */
function align(anchor: HTMLElement): void {
  const block = anchor.nextElementSibling;
  const badge = anchor.firstElementChild;
  if (!(block instanceof HTMLElement) || !(badge instanceof HTMLElement)) return;
  const line = block.matches("p, h1, h2, h3, h4, h5, h6") ? block : (block.querySelector<HTMLElement>("p, h1, h2, h3, h4, h5, h6") ?? block);
  const style = getComputedStyle(line);
  const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.5 || 24;
  const shown = anchor.getClientRects().length > 0 && block.getClientRects().length > 0;
  const offset = shown ? line.getBoundingClientRect().top - anchor.getBoundingClientRect().top : Number.parseFloat(getComputedStyle(block).marginTop) || 0;
  const top = Math.max(0, offset + (Number.parseFloat(style.paddingTop) || 0) + (lineHeight - BADGE_HEIGHT) / 2);
  badge.style.top = `${top}px`;
  // Keep and Undo sit just under the badge.
  const quick = anchor.querySelector<HTMLElement>(".kasten-agent-quick");
  if (quick) quick.style.top = `${top + BADGE_HEIGHT + 2}px`;
  if (!shown) return;
  let edge = anchor.parentElement;
  while (edge && getComputedStyle(edge).overflowX === "visible") edge = edge.parentElement;
  edge ??= document.documentElement;
  const room = edge.getBoundingClientRect().right - badge.getBoundingClientRect().left - MARGIN;
  badge.style.maxWidth = `${Math.max(BADGE_HEIGHT, room)}px`;
  badge.classList.toggle("is-narrow", room < NAME_ROOM);
  watch(edge);
}

function alignAll(): void {
  for (const anchor of document.querySelectorAll<HTMLElement>(".kasten-agent-anchor")) align(anchor);
}

/** The edges badges measure against; a panel opening beside the page
 * narrows one without the window changing. */
const watched = new WeakSet<Element>();
const edges =
  typeof ResizeObserver === "undefined"
    ? null
    : new ResizeObserver((entries) => {
        for (const { target } of entries) {
          if (target.isConnected) continue;
          edges?.unobserve(target);
          watched.delete(target);
        }
        alignAll();
      });

function watch(edge: Element): void {
  if (!edges || watched.has(edge)) return;
  watched.add(edge);
  edges.observe(edge);
}

let listening = false;

/** A zero-height anchor before the block, holding the badge in the margin. */
export function agentBadge(mark: AgentMark, actions: () => AgentActions): HTMLElement {
  const anchor = el("div", "kasten-agent-anchor");
  anchor.contentEditable = "false";
  const badge = el("button", "kasten-agent-badge", { type: "button", title: `Written by ${mark.client}, ${relativeTime(mark.time)}` });
  badge.setAttribute("aria-haspopup", "dialog");
  badge.setAttribute("aria-label", `Written by ${mark.client}`);
  badge.append(withGlyph(el("span", "kasten-agent-star"), "icon:agent", 12), el("span", "kasten-agent-name", { textContent: mark.client }));
  // Keep the caret where it is.
  badge.addEventListener("mousedown", (event) => event.preventDefault());
  badge.addEventListener("click", () => {
    const wasOpen = current?.badge === badge;
    current?.close();
    if (!wasOpen) current = new Card(badge, mark, actions);
  });
  // Keep and Undo for the writing, shown on hover and focus when the page's tint is on (agent.css).
  const quick = el("span", "kasten-agent-quick");
  const keep = el("button", "", { type: "button", textContent: "Keep", title: "Keep the agent's writing on this page as it stands" });
  keep.addEventListener("click", () => void actions().accept().catch(said("Could not keep the agent's writing")));
  const undo = el("button", "", { type: "button", textContent: "Undo", title: "Undo what this agent session changed (asks first)" });
  undo.addEventListener("click", () => {
    current?.close();
    current = new Card(badge, mark, actions, { kind: "confirm" });
  });
  for (const button of [keep, undo]) button.addEventListener("mousedown", (event) => event.preventDefault());
  quick.append(keep, undo);
  anchor.append(badge, quick);
  // Measured once the editor has put it in the page.
  requestAnimationFrame(() => align(anchor));
  if (!edges && !listening) {
    listening = true;
    window.addEventListener("resize", alignAll);
  }
  return anchor;
}

type Stage = { kind: "ask" } | { kind: "confirm" } | { kind: "busy"; label: string } | { kind: "failed"; message: string };

class Card {
  private readonly el = el("div", "kasten-agent-card");
  private readonly text = el("p", "kasten-agent-card-text");
  private readonly buttons = el("div", "kasten-agent-card-actions");

  constructor(
    readonly badge: HTMLElement,
    private readonly mark: AgentMark,
    private readonly actions: () => AgentActions,
    first: Stage = { kind: "ask" },
  ) {
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", `Written by ${mark.client}`);
    const head = el("div", "kasten-agent-card-head");
    head.append(
      withGlyph(el("span", "kasten-agent-star"), "icon:agent", 12),
      el("span", "", { textContent: `Written by ${mark.client}` }),
      el("span", "kasten-agent-card-time", { textContent: `· ${relativeTime(mark.time)}` }),
    );
    this.el.append(head, this.text, this.buttons);
    document.body.append(this.el);
    this.show(first);
    // Asked to confirm an undo, focus starts on Cancel, not on the undo.
    const choices = this.buttons.querySelectorAll("button");
    (first.kind === "confirm" ? choices[choices.length - 1] : choices[0])?.focus();
    document.addEventListener("pointerdown", this.onOutside, true);
    document.addEventListener("keydown", this.onKey, true);
    document.addEventListener("scroll", this.onScroll, true);
  }

  close(): void {
    this.el.remove();
    document.removeEventListener("pointerdown", this.onOutside, true);
    document.removeEventListener("keydown", this.onKey, true);
    document.removeEventListener("scroll", this.onScroll, true);
    if (current === this) current = null;
  }

  private show(stage: Stage): void {
    const busy = stage.kind === "busy";
    const button = (label: string, run: () => void, tone = "", title = "") => {
      const b = el("button", tone, { type: "button", textContent: label, disabled: busy, title });
      b.addEventListener("click", run);
      return b;
    };
    this.buttons.replaceChildren();
    this.text.classList.toggle("is-failed", stage.kind === "failed");
    if (stage.kind === "confirm") {
      this.text.textContent = "Undo everything this session changed? It is reverted as new commits; edits you made since are kept.";
      this.buttons.append(
        button("Undo session", () => void this.run("Undoing…", () => this.actions().undo(this.mark.session)), "is-danger"),
        button("Cancel", () => this.show({ kind: "ask" })),
      );
    } else {
      this.text.textContent = stage.kind === "busy" ? stage.label : stage.kind === "failed" ? stage.message : "Marked until you edit it or accept it.";
      const keep = "Keep the agent's writing on this page as it stands";
      this.buttons.append(
        button("Accept", () => void this.run("Accepting…", () => this.actions().accept()), "is-primary", keep),
        button("Undo this session", () => this.show({ kind: "confirm" })),
        button("See in History", () => {
          this.close();
          this.actions().history(this.mark.session);
        }),
      );
    }
    this.place();
  }

  private async run(label: string, action: () => Promise<void>): Promise<void> {
    this.show({ kind: "busy", label });
    try {
      await action();
      this.close();
    } catch (err) {
      this.show({ kind: "failed", message: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Below the badge, its right edges lined up, or above when there is no room. */
  private place(): void {
    const at = this.badge.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = this.el;
    const left = Math.max(MARGIN, Math.min(at.right - width, window.innerWidth - MARGIN - width));
    const below = at.bottom + GAP;
    const top = below + height > window.innerHeight - MARGIN ? Math.max(MARGIN, at.top - GAP - height) : below;
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
  }

  private readonly onOutside = (event: Event) => {
    const target = event.target as Node;
    if (!this.el.contains(target) && !this.badge.contains(target)) this.close();
  };

  private readonly onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    this.close();
    this.badge.focus({ preventScroll: true });
  };

  /** The card stays by its badge as the page scrolls, and goes with it. */
  private readonly onScroll = (event: Event) => {
    if (this.el.contains(event.target as Node)) return;
    const at = this.badge.getBoundingClientRect();
    if (!this.badge.isConnected || at.bottom < 0 || at.top > window.innerHeight) this.close();
    else this.place();
  };
}

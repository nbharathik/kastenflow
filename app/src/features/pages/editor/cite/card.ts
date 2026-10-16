// The card a citation shows when hovered, or when the caret rests in it: the
// reference's title, who wrote it, its link, and two actions, Copy citation and
// Open reference. A key with no reference says so and offers to add one. The
// editor itself is not touched; the card is drawn over the page like the peek
// of a page link.

import { occludeElement } from "../../../browser/occlusion";
import { openAddPaper } from "../../../references/add-state";
import { copyText } from "../../../references/copy";
import { fullCitation, linkOf, shortAuthors, workOf } from "../../../references/labels";
import { openReference } from "../../../references/requests";
import { useWorkspace } from "../../../workspace/store";
import { el, type Rect } from "../ui/dom";
import { lookup } from "./book";

const SHOW_DELAY = 350;
const HIDE_DELAY = 220;

let card: HTMLElement | null = null;
let uncover: () => void = () => {};
let showTimer: ReturnType<typeof setTimeout> | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
/** Who the card is for, so the same chip does not draw it again. */
let owner: unknown = null;

function button(label: string, run: () => void): HTMLButtonElement {
  const b = el("button", "kasten-cite-card-button", { type: "button", textContent: label });
  b.addEventListener("mousedown", (event) => event.preventDefault());
  b.addEventListener("click", () => {
    run();
    hideCard();
  });
  return b;
}

function section(key: string): HTMLElement {
  const box = el("div", "kasten-cite-card-item");
  const found = lookup(key);
  if (!found) {
    box.append(el("div", "kasten-cite-card-title", { textContent: `No reference has the key “${key}”` }), el("div", "kasten-cite-card-meta", { textContent: "Add the paper, or check the key." }));
    const actions = el("div", "kasten-cite-card-actions");
    actions.append(button("Add a paper…", () => openAddPaper()), button("Open References", () => useWorkspace.getState().go({ view: "references" })));
    box.append(actions);
    return box;
  }
  const work = workOf(found.entry);
  box.append(el("div", "kasten-cite-card-title", { textContent: work.title || key }));
  const meta = [shortAuthors(work), work.year, work.venue].filter(Boolean).join(" · ");
  if (meta) box.append(el("div", "kasten-cite-card-meta", { textContent: meta }));
  const link = linkOf(found.entry);
  if (link) {
    const a = el("a", "kasten-cite-card-link", { href: link.href, textContent: link.text, target: "_blank", rel: "noreferrer noopener" });
    box.append(a);
  }
  const actions = el("div", "kasten-cite-card-actions");
  actions.append(button("Copy citation", () => void copyText(fullCitation(found.entry), "Copied the citation")), button("Open reference", () => openReference(key)));
  box.append(actions);
  return box;
}

function place(anchor: Rect): void {
  if (!card) return;
  const width = card.offsetWidth || 320;
  const height = card.offsetHeight || 140;
  card.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8))}px`;
  const below = anchor.bottom + 6;
  card.style.top = `${below + height > window.innerHeight ? Math.max(8, anchor.top - height - 6) : below}px`;
}

/** Takes the card away now. */
export function hideCard(): void {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  showTimer = undefined;
  hideTimer = undefined;
  owner = null;
  uncover();
  uncover = () => {};
  card?.remove();
  card = null;
}

/** Draws the card for `keys` below (or above) `anchor`, for `who`. */
export function showCard(who: unknown, anchor: () => Rect, keys: readonly string[]): void {
  clearTimeout(hideTimer);
  if (owner === who && card) return;
  card?.remove();
  uncover();
  owner = who;
  card = el("div", "kasten-cite-card", { role: "tooltip" });
  for (const key of keys) card.append(section(key));
  card.append(el("div", "kasten-cite-card-hint", { textContent: "Ctrl+Enter in the citation opens the reference." }));
  card.addEventListener("mouseenter", () => clearTimeout(hideTimer));
  card.addEventListener("mouseleave", () => scheduleHide());
  document.body.append(card);
  uncover = occludeElement(card);
  place(anchor());
}

/** Shows the card after a short wait, unless the pointer has left by then. */
export function scheduleCard(who: unknown, anchor: () => Rect, keys: readonly string[], delay = SHOW_DELAY): void {
  clearTimeout(hideTimer);
  clearTimeout(showTimer);
  showTimer = setTimeout(() => showCard(who, anchor, keys), delay);
}

/** Takes the card away after a moment, so the pointer can cross to it. */
export function scheduleHide(): void {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideCard, HIDE_DELAY);
}

/** Who the card is drawn for now. */
export const cardOwner = (): unknown => owner;

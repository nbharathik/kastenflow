// `![[path/talk.deck]]` on its own line shows the deck; a link to a deck, or
// to any file, opens it and never offers to make a page of that name.

import type { Crepe } from "@milkdown/crepe";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createKastenCrepe } from "../crepe";
import { findDeck, isDeckTarget, isFileTarget, type DeckLink, type LinkProvider } from "../links";
import { openNote, type OpenNote } from "../session";
import { refreshMentions } from "./wikilink-view";

const DECKS: DeckLink[] = [
  { path: "projects/trip/talks/pitch.deck", title: "Trip pitch", hint: "Seaside trip" },
  { path: "library/review.deck", title: "Quarterly review" },
];

let crepe: Crepe | undefined;
let root: HTMLElement | undefined;

afterEach(async () => {
  await crepe?.destroy();
  root?.remove();
  crepe = undefined;
});

function provider() {
  const unmount = vi.fn();
  const links: LinkProvider = {
    pages: () => [],
    open: vi.fn(),
    create: vi.fn(async () => null),
    decks: () => DECKS,
    mountDeck: vi.fn((host: HTMLElement, path: string) => {
      host.textContent = `deck ${path}`;
      return unmount;
    }),
    openDeck: vi.fn(),
    openFile: vi.fn(() => true),
  };
  return { links, unmount };
}

async function open(body: string, links: LinkProvider): Promise<OpenNote> {
  root = document.createElement("div");
  root.className = "kasten-page-editor";
  document.body.append(root);
  crepe = await createKastenCrepe(root, { links });
  return openNote(crepe, body);
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const press = (node: Element, init: MouseEventInit = {}) => node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, ...init }));
const click = (node: Element, init: MouseEventInit = {}) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init }));

describe("deck targets", () => {
  it("are told from pages, whiteboards and other files", () => {
    expect(isDeckTarget("talks/pitch.deck")).toBe(true);
    expect(isDeckTarget("Trip plan")).toBe(false);
    expect(isFileTarget("pitch.deck")).toBe(true);
    expect(isFileTarget("photo.PNG")).toBe(true);
    expect(isFileTarget("scan.pdf")).toBe(true);
    // Page titles that only look like they end in an extension.
    expect(isFileTarget("Node.js")).toBe(false);
    expect(isFileTarget("Version 2.0")).toBe(false);
    expect(isFileTarget("Trip plan")).toBe(false);
  });

  it("find a deck by path, file name or title", () => {
    expect(findDeck(DECKS, "projects/trip/talks/pitch.deck")?.title).toBe("Trip pitch");
    expect(findDeck(DECKS, "pitch.deck")?.title).toBe("Trip pitch");
    expect(findDeck(DECKS, "quarterly review.deck")?.path).toBe("library/review.deck");
    expect(findDeck(DECKS, "nowhere.deck")).toBeUndefined();
  });
});

describe("deck embeds", () => {
  it("show the deck on a line of its own, and keep the Markdown a link", async () => {
    const { links, unmount } = provider();
    const body = "Before.\n\n![[projects/trip/talks/pitch.deck]]\n\nAfter.\n";
    const note = await open(body, links);
    await settle();
    const embed = root!.querySelector<HTMLElement>(".kasten-deck-embed")!;
    expect(embed.querySelector(".kasten-embed-title")!.textContent).toBe("Trip pitch");
    expect(links.mountDeck).toHaveBeenCalledTimes(1);
    expect(embed.querySelector(".kasten-deck-embed-body")!.textContent).toBe("deck projects/trip/talks/pitch.deck");
    // Drawn again with nothing new, it is not mounted again.
    refreshMentions();
    expect(links.mountDeck).toHaveBeenCalledTimes(1);
    expect(note.save()).toBe(body);
    await crepe!.destroy();
    crepe = undefined;
    await settle();
    expect(unmount).toHaveBeenCalled();
  });

  it("open from the header, and pressing the slide or its buttons opens nothing", async () => {
    const { links } = provider();
    await open("![[projects/trip/talks/pitch.deck]]\n", links);
    await settle();
    const embed = root!.querySelector<HTMLElement>(".kasten-deck-embed")!;
    const body = embed.querySelector<HTMLElement>(".kasten-deck-embed-body")!;
    press(body);
    click(body);
    expect(links.openDeck).not.toHaveBeenCalled();
    const head = embed.querySelector<HTMLElement>(".kasten-embed-head")!;
    press(head);
    expect(links.openDeck).not.toHaveBeenCalled();
    click(head, { ctrlKey: true });
    expect(links.openDeck).toHaveBeenCalledWith("projects/trip/talks/pitch.deck", "tab");
  });

  it("say when there is no such deck, and never offer to make a page", async () => {
    const { links } = provider();
    await open("![[Hotel pitch.deck]]\n", links);
    const embed = root!.querySelector<HTMLElement>(".kasten-deck-embed")!;
    expect(embed.querySelector(".kasten-deck-embed-body")!.textContent).toBe("No deck “Hotel pitch.deck”.");
    press(embed);
    click(embed);
    click(embed.querySelector(".kasten-embed-head")!);
    expect(links.create).not.toHaveBeenCalled();
    expect(links.openDeck).not.toHaveBeenCalled();
  });

  it("draw a deck inside a sentence as a mention that opens it", async () => {
    const { links } = provider();
    const body = "See [[pitch.deck]] and ![[review.deck]] here.\n";
    const note = await open(body, links);
    const mentions = [...root!.querySelectorAll<HTMLElement>(".kasten-mention")];
    expect(mentions.map((m) => m.textContent)).toEqual(["Trip pitch", "↪Quarterly review"]);
    expect(root!.querySelector(".kasten-deck-embed")).toBeNull();
    press(mentions[0]!);
    expect(links.openDeck).toHaveBeenCalledWith("projects/trip/talks/pitch.deck", "here");
    press(mentions[1]!, { ctrlKey: true });
    expect(links.openDeck).toHaveBeenCalledWith("library/review.deck", "tab");
    expect(links.create).not.toHaveBeenCalled();
    expect(note.save()).toBe(body);
  });
});

describe("opening what a link names", () => {
  it("shows the Open menu on a right-click, on a mention or an embed's header, and opens to the right with Ctrl+Alt", async () => {
    const { links } = provider();
    links.pages = () => [{ title: "Trip plan", path: "library/trip-plan.md" }];
    links.openMenu = vi.fn(() => true);
    await open("See [[Trip plan]] and [[pitch.deck]].\n\n![[projects/trip/talks/pitch.deck]]\n\n[[Nowhere]]\n", links);
    await settle();
    const menu = (node: Element) => node.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    const [page, deck, missing] = [...root!.querySelectorAll<HTMLElement>(".kasten-mention")];
    menu(page!);
    expect(links.openMenu).toHaveBeenLastCalledWith(expect.any(MouseEvent), "library/trip-plan.md");
    menu(deck!);
    expect(links.openMenu).toHaveBeenLastCalledWith(expect.any(MouseEvent), "projects/trip/talks/pitch.deck");
    expect(links.openMenu).toHaveBeenCalledTimes(2);
    // On the embedded deck only its header is the link; a page that is not there has no menu.
    const embed = root!.querySelector<HTMLElement>(".kasten-deck-embed")!;
    menu(embed.querySelector(".kasten-deck-embed-body")!);
    expect(links.openMenu).toHaveBeenCalledTimes(2);
    menu(embed.querySelector(".kasten-embed-head")!);
    expect(links.openMenu).toHaveBeenCalledTimes(3);
    menu(missing!);
    expect(links.openMenu).toHaveBeenCalledTimes(3);
    press(page!, { ctrlKey: true, altKey: true });
    expect(links.open).toHaveBeenLastCalledWith("library/trip-plan.md", "right");
    press(page!, { shiftKey: true });
    expect(links.open).toHaveBeenLastCalledWith("library/trip-plan.md", "stack");
  });
});

describe("links to files that are not there", () => {
  it("never make a page, in a sentence or on a line of their own", async () => {
    const { links } = provider();
    await open("See [[Old talk.deck]] and [[photo.png]].\n\n![[Old talk.deck]]\n\n![[photo.png]]\n", links);
    const mentions = [...root!.querySelectorAll<HTMLElement>(".kasten-mention")];
    expect(mentions.map((m) => m.title)).toEqual(["No file called Old talk.deck", "Open photo.png", "Open photo.png"]);
    for (const mention of mentions) press(mention);
    for (const card of root!.querySelectorAll(".kasten-embed")) click(card);
    expect(links.create).not.toHaveBeenCalled();
    // A file the workspace may know is handed to it.
    expect(links.openFile).toHaveBeenCalledWith("photo.png", "here");
  });

  it("still make a page for a title that only looks like a file name", async () => {
    const { links } = provider();
    await open("See [[Node.js]] for that.\n", links);
    press(root!.querySelector(".kasten-mention")!);
    expect(links.create).toHaveBeenCalledWith("Node.js", true);
  });
});

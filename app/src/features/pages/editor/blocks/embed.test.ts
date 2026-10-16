// `![[Title]]` on its own line shows the page; the Markdown stays as it was.

import type { Crepe } from "@milkdown/crepe";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createKastenCrepe } from "../crepe";
import type { EmbeddedPage, LinkProvider } from "../links";
import { openNote } from "../session";
import { refreshMentions } from "./wikilink-view";

const TRIP = ["Intro to the trip.", "", "## Plan", "", "Book the guesthouse with [[Hotels|the hotels]].", "", "![1.00](../assets/map.png)", "", "## Budget", "", "About 1200.", ""].join("\n");

let crepe: Crepe | undefined;
let root: HTMLElement | undefined;

afterEach(async () => {
  await crepe?.destroy();
  root?.remove();
  crepe = undefined;
});

function provider(stamp: { value: string }) {
  const load = vi.fn(async (): Promise<EmbeddedPage> => ({ title: "Trip plan", icon: "✈️", markdown: TRIP, url: (src) => `asset://vault/${src.replace(/^\.\.\//, "")}` }));
  const links: LinkProvider = {
    pages: () => [{ title: "Trip plan", icon: "✈️" }, { title: "Hotels" }],
    open: vi.fn(),
    embed: (title) => (title.toLowerCase() === "trip plan" ? { stamp: stamp.value, load } : null),
  };
  return { links, load };
}

async function open(body: string, links: LinkProvider) {
  root = document.createElement("div");
  document.body.append(root);
  crepe = await createKastenCrepe(root, { links });
  return openNote(crepe, body);
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("note embeds", () => {
  it("shows the page on a line of its own, and keeps the Markdown as written", async () => {
    const { links } = provider({ value: "1" });
    const body = "Before.\n\n![[Trip plan]]\n\nSee ![[Trip plan]] inline.\n";
    const note = await open(body, links);
    await settle();
    const card = root!.querySelector<HTMLElement>(".kasten-embed")!;
    expect(card.querySelector(".kasten-embed-title")!.textContent).toBe("Trip plan");
    expect(card.querySelector(".kasten-embed-body")!.textContent).toContain("Book the guesthouse with the hotels.");
    expect([...card.querySelectorAll(".kasten-embed-body h2")].map((h) => h.textContent)).toEqual(["Plan", "Budget"]);
    expect(card.querySelector("img")!.getAttribute("src")).toBe("asset://vault/assets/map.png");
    // In a sentence, an embed stays a mention.
    expect(root!.querySelectorAll(".kasten-embed")).toHaveLength(1);
    expect(root!.querySelector(".kasten-mention.is-embed")).not.toBeNull();
    expect(note.save()).toBe(body);
  });

  it("shows one section for a heading", async () => {
    const { links } = provider({ value: "1" });
    await open("![[Trip plan#Budget]]\n", links);
    await settle();
    const card = root!.querySelector<HTMLElement>(".kasten-embed")!;
    expect(card.querySelector(".kasten-embed-title")!.textContent).toBe("Trip plan › Budget");
    expect(card.querySelector(".kasten-embed-body")!.textContent).toBe("BudgetAbout 1200.");
  });

  it("loads again only when the embedded page changed", async () => {
    const stamp = { value: "1" };
    const { links, load } = provider(stamp);
    await open("![[Trip plan]]\n", links);
    await settle();
    refreshMentions();
    refreshMentions();
    expect(load).toHaveBeenCalledTimes(1);
    stamp.value = "2";
    refreshMentions();
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("says when the page is not there yet", async () => {
    const { links } = provider({ value: "1" });
    await open("![[Hotel ideas]]\n", links);
    expect(root!.querySelector(".kasten-embed-body")!.textContent).toBe("No page called “Hotel ideas” yet. Click to create it.");
  });

  it("opens from a click on its header, and pressing it to select or drag opens nothing", async () => {
    const { links } = provider({ value: "1" });
    await open("![[Trip plan]]\n", links);
    await settle();
    const head = root!.querySelector<HTMLElement>(".kasten-embed-head")!;
    const body = root!.querySelector<HTMLElement>(".kasten-embed-body")!;
    head.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    body.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    expect(links.open).not.toHaveBeenCalled();
    head.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    expect(links.open).toHaveBeenCalledWith("Trip plan", "here");
  });

  it("has an icon to open the page, named, with the page in its tooltip, that the keyboard reaches", async () => {
    const { links } = provider({ value: "1" });
    await open("![[Trip plan]]\n", links);
    await settle();
    const tool = root!.querySelector<HTMLButtonElement>(".kasten-embed-head .kasten-embed-open")!;
    expect(tool.tagName).toBe("BUTTON");
    expect(tool.textContent).toBe("");
    expect(tool.getAttribute("aria-label")).toBe("Open page");
    expect(tool.title).toBe("Open “Trip plan”");
    // Enter on the focused button is a click: the header's handler opens the page.
    tool.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, detail: 0 }));
    expect(links.open).toHaveBeenCalledWith("Trip plan", "here");
  });

  it("makes a page not written yet only from a click, not a press", async () => {
    const { links } = provider({ value: "1" });
    links.create = vi.fn(async () => null);
    await open("![[Hotel ideas]]\n", links);
    const card = root!.querySelector<HTMLElement>(".kasten-embed")!;
    card.querySelector(".kasten-embed-head")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    expect(links.create).not.toHaveBeenCalled();
    card.querySelector(".kasten-embed-body")!.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    expect(links.create).toHaveBeenCalledWith("Hotel ideas", true);
  });
});

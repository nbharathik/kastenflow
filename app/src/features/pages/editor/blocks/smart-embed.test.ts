// `![[Conference tracker]]` on a line of its own shows a smart page as its live
// view, and `![[Conference tracker#deadlines]]` one named view of it. The
// Markdown stays the link: no HTML or script is ever written into the page.

import type { Crepe } from "@milkdown/crepe";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createKastenCrepe } from "../crepe";
import type { EmbedSource, LinkProvider } from "../links";
import { openNote, type OpenNote } from "../session";
import { refreshMentions } from "./wikilink-view";

let crepe: Crepe | undefined;
let root: HTMLElement | undefined;

afterEach(async () => {
  await crepe?.destroy();
  root?.remove();
  crepe = undefined;
});

const SMART = { path: "library/conference-tracker.md", id: "01SMART" };

function provider(extra: Partial<LinkProvider> = {}) {
  const unmount = vi.fn();
  const links: LinkProvider = {
    pages: () => [{ title: "Conference tracker" }, { title: "Trip plan" }],
    open: vi.fn(),
    create: vi.fn(async () => null),
    embed: vi.fn((target: string): EmbedSource | null => ({
      stamp: `${target}:1`,
      load: async () => ({
        title: target,
        markdown: "Plain words of the page.\n",
        url: (src: string) => src,
        ...(target === "Conference tracker" ? { smart: SMART } : {}),
      }),
    })),
    mountSmart: vi.fn((host: HTMLElement, spec) => {
      host.textContent = `smart ${spec.path} [${spec.view}]`;
      return unmount;
    }),
    ...extra,
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

const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const press = (node: Element) => node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
const click = (node: Element, init: MouseEventInit = {}) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init }));

describe("a smart page embedded in a page", () => {
  it("shows its live view in place of its Markdown, and keeps the Markdown a link", async () => {
    const { links, unmount } = provider();
    const body = "Before.\n\n![[Conference tracker]]\n\nAfter.\n";
    const note = await open(body, links);
    await settle();
    expect(links.mountSmart).toHaveBeenCalledTimes(1);
    expect(links.mountSmart).toHaveBeenCalledWith(expect.any(HTMLElement), { path: SMART.path, id: SMART.id, title: "Conference tracker", view: "" });
    const embed = root!.querySelector<HTMLElement>(".kasten-embed")!;
    expect(embed.querySelector(".kasten-smart-embed-body")!.textContent).toBe("smart library/conference-tracker.md []");
    expect(embed.textContent).not.toContain("Plain words");
    // Drawn again with nothing new, it is not mounted again.
    refreshMentions();
    await settle();
    expect(links.mountSmart).toHaveBeenCalledTimes(1);
    expect(note.save()).toBe(body);
    // The page going away takes the view with it.
    await crepe!.destroy();
    crepe = undefined;
    await settle();
    expect(unmount).toHaveBeenCalled();
  });

  it("stops the live view when the page can no longer be read", async () => {
    let reads = 0;
    const { links, unmount } = provider({
      embed: vi.fn((target: string): EmbedSource | null => {
        const now = ++reads;
        return {
          stamp: `${target}:${now}`,
          load: async () => {
            if (now > 1) throw new Error("gone");
            return { title: target, markdown: "x", url: (src: string) => src, smart: SMART };
          },
        };
      }),
    });
    await open("![[Conference tracker]]\n", links);
    await settle();
    expect(links.mountSmart).toHaveBeenCalledTimes(1);
    expect(unmount).not.toHaveBeenCalled();
    refreshMentions();
    await settle();
    expect(root!.querySelector(".kasten-embed")!.textContent).toContain("could not be read");
    expect(unmount).toHaveBeenCalledTimes(1);
  });

  it("names the view asked for, with # after the page", async () => {
    const { links } = provider();
    const body = "![[Conference tracker#deadlines]]\n";
    const note = await open(body, links);
    await settle();
    expect(links.mountSmart).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ path: SMART.path, view: "deadlines" }));
    expect(root!.querySelector(".kasten-embed-title")!.textContent).toBe("Conference tracker › deadlines");
    expect(note.save()).toBe(body);
  });

  it("leaves an ordinary page as its Markdown", async () => {
    const { links } = provider();
    await open("![[Trip plan]]\n", links);
    await settle();
    expect(links.mountSmart).not.toHaveBeenCalled();
    expect(root!.querySelector(".kasten-embed")!.textContent).toContain("Plain words of the page.");
  });

  it("shows the page's Markdown where the window cannot draw smart pages", async () => {
    const { links } = provider({ mountSmart: undefined });
    await open("![[Conference tracker]]\n", links);
    await settle();
    expect(root!.querySelector(".kasten-embed")!.textContent).toContain("Plain words of the page.");
  });

  it("is a mention in a sentence, and draws no view there", async () => {
    const { links } = provider();
    const body = "See ![[Conference tracker]] here.\n";
    const note = await open(body, links);
    await settle();
    expect(links.mountSmart).not.toHaveBeenCalled();
    expect(note.save()).toBe(body);
  });

  it("opens the page from its header, and pressing the view opens nothing", async () => {
    const { links } = provider();
    await open("![[Conference tracker]]\n", links);
    await settle();
    const embed = root!.querySelector<HTMLElement>(".kasten-embed")!;
    const view = embed.querySelector<HTMLElement>(".kasten-smart-embed-body")!;
    press(view);
    click(view);
    expect(links.open).not.toHaveBeenCalled();
    click(embed.querySelector(".kasten-embed-head")!, { ctrlKey: true });
    expect(links.open).toHaveBeenCalledWith("Conference tracker", "tab");
  });
});

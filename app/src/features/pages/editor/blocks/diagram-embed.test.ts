// `![[Flow.drawio]]` on its own line shows the diagram's picture; a link to a
// diagram opens it and never offers to make a page of that name, and the
// Markdown stays the link.

import type { Crepe } from "@milkdown/crepe";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createKastenCrepe } from "../crepe";
import { findDiagram, isDiagramTarget, isFileTarget, type DiagramLink, type LinkProvider } from "../links";
import { openNote, type OpenNote } from "../session";
import { refreshMentions } from "./wikilink-view";

const DIAGRAMS: DiagramLink[] = [
  { path: "projects/trip/diagrams/Login-flow.drawio", title: "Login flow", hint: "Seaside trip" },
  { path: "library/Network.drawio", title: "Network" },
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
    embed: vi.fn(() => null),
    diagrams: () => DIAGRAMS,
    mountDiagram: vi.fn((host: HTMLElement, path: string) => {
      host.textContent = `diagram ${path}`;
      return unmount;
    }),
    openDiagram: vi.fn(),
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

describe("diagram targets", () => {
  it("are told from pages and other files, the picture beside a diagram included", () => {
    expect(isDiagramTarget("Login-flow.drawio")).toBe(true);
    expect(isDiagramTarget("library/Login-flow.DRAWIO")).toBe(true);
    expect(isDiagramTarget("Login-flow.drawio.svg")).toBe(true);
    expect(isDiagramTarget("diagram.svg")).toBe(false);
    expect(isDiagramTarget("Trip plan")).toBe(false);
    expect(isFileTarget("Login-flow.drawio")).toBe(true);
    // A title that only looks like it ends in an extension is still a page.
    expect(isFileTarget("Notes.drawing")).toBe(false);
  });

  it("find a diagram by path, file name, the picture's name or title", () => {
    expect(findDiagram(DIAGRAMS, "projects/trip/diagrams/Login-flow.drawio")?.title).toBe("Login flow");
    expect(findDiagram(DIAGRAMS, "login-flow.drawio")?.title).toBe("Login flow");
    expect(findDiagram(DIAGRAMS, "Network.drawio.svg")?.path).toBe("library/Network.drawio");
    expect(findDiagram(DIAGRAMS, "network.drawio")?.path).toBe("library/Network.drawio");
    expect(findDiagram(DIAGRAMS, "Nowhere.drawio")).toBeUndefined();
  });
});

describe("diagram embeds", () => {
  it("show the diagram on a line of its own, never as a page, and keep the Markdown a link", async () => {
    const { links, unmount } = provider();
    const body = "Before.\n\n![[Login-flow.drawio]]\n\nAfter.\n";
    const note = await open(body, links);
    await settle();
    const embed = root!.querySelector<HTMLElement>(".kasten-diagram-embed")!;
    expect(embed.querySelector(".kasten-embed-title")!.textContent).toBe("Login flow");
    expect(links.mountDiagram).toHaveBeenCalledTimes(1);
    expect(embed.querySelector(".kasten-diagram-embed-body")!.textContent).toBe("diagram projects/trip/diagrams/Login-flow.drawio");
    // It is not a page: nothing asked for one.
    expect(links.embed).not.toHaveBeenCalled();
    expect(root!.querySelector(".kasten-embed:not(.kasten-diagram-embed)")).toBeNull();
    // Drawn again with nothing new, it is not mounted again.
    refreshMentions();
    expect(links.mountDiagram).toHaveBeenCalledTimes(1);
    expect(note.save()).toBe(body);
    await crepe!.destroy();
    crepe = undefined;
    await settle();
    expect(unmount).toHaveBeenCalled();
  });

  it("show the picture's own link as the diagram too", async () => {
    const { links } = provider();
    const body = "![[Network.drawio.svg]]\n";
    const note = await open(body, links);
    await settle();
    expect(root!.querySelector(".kasten-diagram-embed .kasten-embed-title")!.textContent).toBe("Network");
    expect(links.mountDiagram).toHaveBeenCalledWith(expect.any(HTMLElement), "library/Network.drawio");
    expect(note.save()).toBe(body);
  });

  it("open from the header, and pressing the picture or its toolbar opens nothing", async () => {
    const { links } = provider();
    await open("![[Network.drawio]]\n", links);
    await settle();
    const embed = root!.querySelector<HTMLElement>(".kasten-diagram-embed")!;
    const body = embed.querySelector<HTMLElement>(".kasten-diagram-embed-body")!;
    press(body);
    click(body);
    expect(links.openDiagram).not.toHaveBeenCalled();
    const head = embed.querySelector<HTMLElement>(".kasten-embed-head")!;
    press(head);
    expect(links.openDiagram).not.toHaveBeenCalled();
    click(head, { ctrlKey: true });
    expect(links.openDiagram).toHaveBeenCalledWith("library/Network.drawio", "tab");
  });

  it("say when there is no such diagram, and never offer to make a page", async () => {
    const { links } = provider();
    await open("![[Hotel map.drawio]]\n", links);
    const embed = root!.querySelector<HTMLElement>(".kasten-diagram-embed")!;
    expect(embed.querySelector(".kasten-diagram-embed-body")!.textContent).toBe("No diagram “Hotel map.drawio”.");
    press(embed);
    click(embed);
    click(embed.querySelector(".kasten-embed-head")!);
    expect(links.create).not.toHaveBeenCalled();
    expect(links.openDiagram).not.toHaveBeenCalled();
  });

  it("draw a diagram inside a sentence as a mention that opens it", async () => {
    const { links } = provider();
    const body = "See [[Network.drawio]] and ![[Login-flow.drawio]] here.\n";
    const note = await open(body, links);
    const mentions = [...root!.querySelectorAll<HTMLElement>(".kasten-mention")];
    expect(mentions.map((m) => m.textContent)).toEqual(["Network", "↪Login flow"]);
    expect(root!.querySelector(".kasten-diagram-embed")).toBeNull();
    press(mentions[0]!);
    expect(links.openDiagram).toHaveBeenCalledWith("library/Network.drawio", "here");
    press(mentions[1]!, { ctrlKey: true });
    expect(links.openDiagram).toHaveBeenCalledWith("projects/trip/diagrams/Login-flow.drawio", "tab");
    expect(links.create).not.toHaveBeenCalled();
    expect(note.save()).toBe(body);
  });

  it("show a missing diagram's link as a file that is not there, in a sentence or alone with no support from the workspace", async () => {
    const { links } = provider();
    links.mountDiagram = undefined;
    await open("See [[Old.drawio]].\n\n![[Network.drawio]]\n", links);
    const mention = root!.querySelector<HTMLElement>(".kasten-mention")!;
    expect(mention.title).toBe("No file called Old.drawio");
    press(mention);
    expect(links.create).not.toHaveBeenCalled();
    expect(root!.querySelector(".kasten-diagram-embed-body")!.textContent).toBe("Diagrams show here in the app.");
  });
});

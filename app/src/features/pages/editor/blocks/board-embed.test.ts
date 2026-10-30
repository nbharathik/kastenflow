// `![[path/board.canvas]]` on its own line shows the whiteboard, live; the
// slash menu's Whiteboard picks one or makes one; the Markdown stays a link.

import type { Crepe } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createKastenCrepe } from "../crepe";
import { findBoard, isBoardTarget, type BoardLink, type LinkProvider } from "../links";
import { startLink } from "../menus/mention";
import { openNote, type OpenNote } from "../session";
import { heightOf } from "./embed-heights";
import { refreshMentions } from "./wikilink-view";

const BOARDS: BoardLink[] = [
  { path: "projects/trip/boards/map.canvas", title: "Route map", hint: "Seaside trip" },
  { path: "library/ideas.canvas", title: "Ideas" },
];

let crepe: Crepe | undefined;
let root: HTMLElement | undefined;

afterEach(async () => {
  await crepe?.destroy();
  root?.remove();
  crepe = undefined;
  document.querySelector(".kasten-menu")?.remove();
});

function provider() {
  const unmount = vi.fn();
  const links: LinkProvider = {
    pages: () => [],
    open: vi.fn(),
    boards: () => BOARDS,
    mountBoard: vi.fn((host: HTMLElement, path: string) => {
      host.textContent = `board ${path}`;
      return unmount;
    }),
    openBoard: vi.fn(),
    createBoard: vi.fn(async (title: string) => {
      const board = { path: `library/${title.toLowerCase()}.canvas`, title };
      BOARDS.push(board);
      return board.path;
    }),
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

describe("whiteboard embeds", () => {
  it("finds boards by path, file name or title", () => {
    expect(isBoardTarget("a/b.canvas")).toBe(true);
    expect(isBoardTarget("Trip plan")).toBe(false);
    expect(findBoard(BOARDS, "projects/trip/boards/map.canvas")?.title).toBe("Route map");
    expect(findBoard(BOARDS, "map.canvas")?.title).toBe("Route map");
    expect(findBoard(BOARDS, "ideas.canvas")?.path).toBe("library/ideas.canvas");
    expect(findBoard(BOARDS, "route map.canvas")?.path).toBe("projects/trip/boards/map.canvas");
    expect(findBoard(BOARDS, "nowhere.canvas")).toBeUndefined();
  });

  it("shows the board live on a line of its own, behind a cover until clicked", async () => {
    const { links, unmount } = provider();
    const body = "Before.\n\n![[projects/trip/boards/map.canvas]]\n\nAfter.\n";
    const note = await open(body, links);
    await settle();
    const embed = root!.querySelector<HTMLElement>(".kasten-board-embed")!;
    expect(embed.querySelector(".kasten-embed-title")!.textContent).toBe("Route map");
    expect(links.mountBoard).toHaveBeenCalledTimes(1);
    expect(embed.querySelector(".kasten-board-embed-body")!.textContent).toBe("board projects/trip/boards/map.canvas");
    const cover = embed.querySelector<HTMLElement>(".kasten-board-embed-cover")!;
    expect(cover.hidden).toBe(false);
    cover.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(embed.dataset.active).toBe("true");
    expect(cover.hidden).toBe(true);
    // A press elsewhere gives the page back its scrolling.
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(embed.dataset.active).toBeUndefined();
    embed.querySelector(".kasten-board-embed-open")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, ctrlKey: true }));
    expect(links.openBoard).toHaveBeenCalledWith("projects/trip/boards/map.canvas", "tab");
    expect(note.save()).toBe(body);
    await crepe!.destroy();
    crepe = undefined;
    await settle();
    expect(unmount).toHaveBeenCalled();
  });

  it("mounts the board embedded, with a slim head that presents it and a grip that sets its height", async () => {
    localStorage.removeItem("kasten.embedHeights");
    const { links } = provider();
    await open("![[projects/trip/boards/map.canvas]]\n", links);
    await settle();
    const embed = root!.querySelector<HTMLElement>(".kasten-board-embed")!;
    expect(links.mountBoard).toHaveBeenCalledWith(expect.any(HTMLElement), "projects/trip/boards/map.canvas", { embedded: true });
    // Present is asked of the board inside, which knows its sections.
    const asked = vi.fn();
    embed.addEventListener("kasten:present", asked);
    embed.querySelector(".kasten-board-embed-present")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(asked).toHaveBeenCalledTimes(1);
    // Both tools are icons with a name and a tooltip, and the keyboard presses them as a click with no mouse before it.
    const presentTool = embed.querySelector<HTMLButtonElement>(".kasten-board-embed-present")!;
    const openTool = embed.querySelector<HTMLButtonElement>(".kasten-board-embed-open")!;
    expect([presentTool.textContent, openTool.textContent]).toEqual(["", ""]);
    expect([presentTool.getAttribute("aria-label"), openTool.getAttribute("aria-label")]).toEqual(["Present whiteboard", "Open whiteboard"]);
    expect(presentTool.title).toContain("Present");
    expect(openTool.title).toContain("Open");
    presentTool.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }));
    expect(asked).toHaveBeenCalledTimes(2);
    presentTool.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    expect(asked, "a mouse click came after its mousedown, which did the work").toHaveBeenCalledTimes(2);
    openTool.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }));
    expect(links.openBoard).toHaveBeenCalledWith("projects/trip/boards/map.canvas", "here");
    // The grip: keys and a drag set the height, kept per board and kept within limits.
    const body = embed.querySelector<HTMLElement>(".kasten-board-embed-body")!;
    const grip = embed.querySelector<HTMLElement>(".kasten-board-embed-grip")!;
    expect(body.style.height).toBe("440px");
    grip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(body.style.height).toBe("480px");
    grip.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientY: 100 }));
    window.dispatchEvent(new PointerEvent("pointermove", { clientY: 5000 }));
    expect(body.style.height).toBe("1200px");
    window.dispatchEvent(new PointerEvent("pointermove", { clientY: -5000 }));
    window.dispatchEvent(new PointerEvent("pointerup", {}));
    expect(body.style.height).toBe("200px");
    expect(JSON.parse(localStorage.getItem("kasten.embedHeights")!)).toEqual({ "projects/trip/boards/map.canvas": 200 });
    // Drawn again, or opened in another page, it is as it was left.
    refreshMentions();
    expect(body.style.height).toBe("200px");
    expect(heightOf("library/ideas.canvas")).toBe(440);
    localStorage.removeItem("kasten.embedHeights");
  });

  it("focuses the board when it is activated, so Ctrl+Z goes to the board", async () => {
    const { links } = provider();
    links.mountBoard = vi.fn((host: HTMLElement) => {
      const canvas = document.createElement("div");
      canvas.className = "kasten-board";
      canvas.tabIndex = 0;
      host.append(canvas);
      return () => canvas.remove();
    });
    await open("![[projects/trip/boards/map.canvas]]\n", links);
    await settle();
    const embed = root!.querySelector<HTMLElement>(".kasten-board-embed")!;
    embed.querySelector<HTMLElement>(".kasten-board-embed-cover")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(embed.querySelector(".kasten-board"));
  });

  it("has named undo and redo buttons in the head that ask the board", async () => {
    const { links } = provider();
    await open("![[projects/trip/boards/map.canvas]]\n", links);
    await settle();
    const embed = root!.querySelector<HTMLElement>(".kasten-board-embed")!;
    const undo = embed.querySelector<HTMLButtonElement>(".kasten-board-embed-undo")!;
    const redo = embed.querySelector<HTMLButtonElement>(".kasten-board-embed-redo")!;
    expect([undo.getAttribute("aria-label"), redo.getAttribute("aria-label")]).toEqual(["Undo whiteboard edit", "Redo whiteboard edit"]);
    expect(undo.tabIndex).toBe(0);
    const asked: string[] = [];
    embed.addEventListener("kasten:undo", () => asked.push("undo"));
    embed.addEventListener("kasten:redo", () => asked.push("redo"));
    undo.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    redo.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }));
    expect(asked).toEqual(["undo", "redo"]);
  });

  it("greys out undo and redo while the board says it has nothing to undo or redo", async () => {
    const { links } = provider();
    await open("![[projects/trip/boards/map.canvas]]\n", links);
    await settle();
    const embed = root!.querySelector<HTMLElement>(".kasten-board-embed")!;
    const undo = embed.querySelector<HTMLButtonElement>(".kasten-board-embed-undo")!;
    const redo = embed.querySelector<HTMLButtonElement>(".kasten-board-embed-redo")!;
    embed.dispatchEvent(new CustomEvent("kasten:history", { detail: { canUndo: false, canRedo: false } }));
    expect([undo.disabled, redo.disabled]).toEqual([true, true]);
    embed.dispatchEvent(new CustomEvent("kasten:history", { detail: { canUndo: true, canRedo: false } }));
    expect([undo.disabled, redo.disabled]).toEqual([false, true]);
  });

  it("gives each board its own element, so React unmounts it cleanly when it goes", async () => {
    const { links } = provider();
    let boards = BOARDS;
    links.boards = () => boards;
    const hosts = new Set<HTMLElement>();
    const lost: string[] = [];
    // As a React root does: one root per element, and what it drew must
    // still be in that element when it unmounts (else "removeChild" throws).
    links.mountBoard = vi.fn((host: HTMLElement, path: string) => {
      if (hosts.has(host)) lost.push(`second root in one element for ${path}`);
      hosts.add(host);
      const drawn = document.createElement("div");
      drawn.textContent = `board ${path}`;
      host.append(drawn);
      return () => {
        if (drawn.parentNode !== host) lost.push(`${path} was taken from its element`);
        drawn.remove();
      };
    });
    await open("![[projects/trip/boards/map.canvas]]\n", links);
    await settle();
    // The boards are read again, and for a moment the list is empty.
    boards = [];
    refreshMentions();
    expect(root!.querySelector(".kasten-board-embed-body")!.textContent).toBe("No whiteboard “projects/trip/boards/map.canvas”.");
    boards = BOARDS;
    refreshMentions();
    await settle();
    expect(root!.querySelector(".kasten-board-embed-body")!.textContent).toBe("board projects/trip/boards/map.canvas");
    await crepe!.destroy();
    crepe = undefined;
    await settle();
    expect(links.mountBoard).toHaveBeenCalledTimes(2);
    expect(lost).toEqual([]);
  });

  it("embeds a board picked from /whiteboard, or a new one", async () => {
    const { links } = provider();
    const note = await open("Intro\n", links);
    const view = crepe!.editor.ctx.get(editorViewCtx);
    const size = view.state.doc.content.size;
    const tr = view.state.tr.insert(size, view.state.schema.nodes.paragraph!.create());
    view.dispatch(tr.setSelection(TextSelection.create(tr.doc, size + 1)));
    const empty = size + 1;
    startLink(view, empty, "board");
    const items = () => [...document.querySelectorAll<HTMLElement>(".kasten-menu .kasten-menu-item")];
    expect(items().map((i) => i.dataset.key)).toEqual(["board:projects/trip/boards/map.canvas", "board:library/ideas.canvas", "create"]);
    items()[1]!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    items()[1]?.click();
    await settle();
    expect(note.save()).toContain("Intro\n\n![[library/ideas.canvas]]\n");

    const end = view.state.doc.content.size - 1;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)));
    startLink(view, end, "board");
    for (const char of "Plan") view.dispatch(view.state.tr.insertText(char));
    const create = document.querySelector<HTMLElement>('.kasten-menu .kasten-menu-item[data-key="create"]')!;
    expect(create.textContent).toContain("New whiteboard “Plan”");
    create.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    create.click();
    await settle();
    await settle();
    expect(links.createBoard).toHaveBeenCalledWith("Plan");
    expect(note.save()).toContain("![[library/plan.canvas]]");
  });

  it("puts a board made meanwhile where it was asked for, and leaves the caret where it went", async () => {
    const { links } = provider();
    let made: (path: string | null) => void = () => {};
    links.createBoard = vi.fn(() => new Promise<string | null>((resolve) => (made = resolve)));
    const note = await open("Intro\n\nOutro\n", links);
    const view = crepe!.editor.ctx.get(editorViewCtx);
    const { schema } = view.state;
    const spot = view.state.doc.child(0).nodeSize;
    view.dispatch(view.state.tr.insert(spot, schema.nodes.paragraph!.create()));
    startLink(view, spot + 1, "board");
    for (const char of "Plan") view.dispatch(view.state.tr.insertText(char));
    const create = document.querySelector<HTMLElement>('.kasten-menu .kasten-menu-item[data-key="create"]')!;
    create.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    create.click();
    // While the board is made, a line goes in above and the caret moves on.
    view.dispatch(view.state.tr.insert(0, schema.nodes.paragraph!.create(null, schema.text("Added above while waiting"))));
    const outro = view.state.doc.content.size - 2;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, outro)));
    made("library/plan.canvas");
    await settle();
    expect(note.save()).toBe("Added above while waiting\n\nIntro\n\n![[library/plan.canvas]]\n\nOutro\n");
    expect(view.state.selection.$from.parent.textContent).toBe("Outro");
  });

  it("does nothing once the page has closed", async () => {
    const { links } = provider();
    let made: (path: string | null) => void = () => {};
    links.createBoard = vi.fn(() => new Promise<string | null>((resolve) => (made = resolve)));
    await open("Intro\n", links);
    const view = crepe!.editor.ctx.get(editorViewCtx);
    const end = view.state.doc.content.size - 1;
    startLink(view, end, "board");
    const create = document.querySelector<HTMLElement>('.kasten-menu .kasten-menu-item[data-key="create"]')!;
    create.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    create.click();
    await crepe!.destroy();
    crepe = undefined;
    made("library/plan.canvas");
    await settle();
    expect(view.isDestroyed).toBe(true);
  });
});

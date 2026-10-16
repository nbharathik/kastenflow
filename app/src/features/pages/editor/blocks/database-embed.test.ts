// `![[tags/paper.yaml]]` on its own line shows the tag's database, live, on
// the view named after `#`; /database picks one; the Markdown stays a link.

import type { Crepe } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TagViewKind } from "../../../../lib/vault/types";
import { createKastenCrepe } from "../crepe";
import { findDatabase, isDatabaseTarget, tagFrom, type DatabaseLink, type LinkProvider } from "../links";
import { startLink } from "../menus/mention";
import { openNote } from "../session";
import { refreshMentions } from "./wikilink-view";

const DATABASES: DatabaseLink[] = [
  { tag: "paper", path: "tags/paper.yaml", count: 12 },
  { tag: "task", path: "tags/task.yaml", count: 40 },
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
  const links: LinkProvider = {
    pages: () => [],
    open: vi.fn(),
    databases: () => DATABASES,
    mountDatabase: vi.fn((host: HTMLElement, tag: string, view: string) => {
      host.textContent = `database ${tag} ${view}`;
      return () => {};
    }),
    openDatabase: vi.fn(),
  };
  return links;
}

async function open(body: string, links: LinkProvider) {
  root = document.createElement("div");
  root.className = "kasten-page-editor";
  document.body.append(root);
  crepe = await createKastenCrepe(root, { links });
  return openNote(crepe, body);
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("tag database embeds", () => {
  it("finds a database by its file or its tag", () => {
    expect(isDatabaseTarget("tags/paper.yaml")).toBe(true);
    expect(isDatabaseTarget("library/paper.md")).toBe(false);
    expect(findDatabase(DATABASES, "tags/task.yaml")?.tag).toBe("task");
    expect(findDatabase(DATABASES, "tags/Paper.yml")?.tag).toBe("paper");
    expect(findDatabase(DATABASES, "tags/none.yaml")).toBeUndefined();
  });

  it("gives each database its own element, so React unmounts it cleanly when it goes", async () => {
    const links = provider();
    let databases = DATABASES;
    links.databases = () => databases;
    const hosts = new Set<HTMLElement>();
    const lost: string[] = [];
    // As a React root does (see the whiteboard embeds' test).
    links.mountDatabase = vi.fn((host: HTMLElement, tag: string, view: string) => {
      if (hosts.has(host)) lost.push(`second root in one element for ${tag}`);
      hosts.add(host);
      const drawn = document.createElement("div");
      drawn.textContent = `database ${tag} ${view}`;
      host.append(drawn);
      return () => {
        if (drawn.parentNode !== host) lost.push(`${tag} was taken from its element`);
        drawn.remove();
      };
    });
    await open("![[tags/paper.yaml#Pipeline]]\n", links);
    await settle();
    // The tags are read again, and for a moment none are known.
    databases = [];
    refreshMentions();
    databases = DATABASES;
    refreshMentions();
    await settle();
    expect(root!.querySelector(".kasten-db-embed-body")!.textContent).toBe("database paper Pipeline");
    await crepe!.destroy();
    crepe = undefined;
    await settle();
    expect(links.mountDatabase).toHaveBeenCalledTimes(2);
    expect(lost).toEqual([]);
  });

  it("shows the database live on the view named, and keeps the Markdown", async () => {
    const links = provider();
    const body = "Reading list:\n\n![[tags/paper.yaml#Pipeline]]\n";
    const note = await open(body, links);
    await settle();
    const embed = root!.querySelector<HTMLElement>(".kasten-db-embed")!;
    expect(embed.querySelector(".kasten-embed-title")!.textContent).toBe("#paper › Pipeline");
    expect(links.mountDatabase).toHaveBeenCalledWith(expect.any(HTMLElement), "paper", "Pipeline");
    expect(embed.querySelector(".kasten-db-embed-body")!.textContent).toBe("database paper Pipeline");
    embed.querySelector(".kasten-board-embed-open")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(links.openDatabase).toHaveBeenCalledWith("paper", "here");
    // Open is an icon with a name and a tooltip; the keyboard presses it as a click with no mouse before it.
    const openTool = embed.querySelector<HTMLButtonElement>(".kasten-board-embed-open")!;
    expect(openTool.textContent).toBe("");
    expect(openTool.getAttribute("aria-label")).toBe("Open database");
    expect(openTool.title).toContain("Open the database");
    vi.mocked(links.openDatabase!).mockClear();
    openTool.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0, ctrlKey: true }));
    expect(links.openDatabase).toHaveBeenCalledWith("paper", "tab");
    expect(note.save()).toBe(body);
  });

  it("puts a database picked from /database on its own line", async () => {
    const links = provider();
    const note = await open("Intro\n", links);
    const view = crepe!.editor.ctx.get(editorViewCtx);
    const size = view.state.doc.content.size;
    const tr = view.state.tr.insert(size, view.state.schema.nodes.paragraph!.create());
    view.dispatch(tr.setSelection(TextSelection.create(tr.doc, size + 1)));
    startLink(view, size + 1, "database");
    const items = [...document.querySelectorAll<HTMLElement>(".kasten-menu .kasten-menu-item")];
    // The biggest first.
    expect(items.map((i) => i.dataset.key)).toEqual(["db:tags/task.yaml", "db:tags/paper.yaml"]);
    items[1]!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    items[1]!.click();
    await settle();
    expect(note.save()).toContain("Intro\n\n![[tags/paper.yaml]]\n");
  });

  it("makes a new database from a view in the slash menu, or shows one on a view of that kind", async () => {
    const links = provider();
    links.createDatabase = vi.fn(async (name: string, kind: TagViewKind) => ({ path: `tags/${tagFrom(name)}.yaml`, view: kind === "table" ? "Table" : "Board" }));
    links.viewOf = vi.fn(async () => "Board");
    const note = await open("Intro\n", links);
    const view = crepe!.editor.ctx.get(editorViewCtx);
    const endLine = () => {
      const size = view.state.doc.content.size;
      const tr = view.state.tr.insert(size, view.state.schema.nodes.paragraph!.create());
      view.dispatch(tr.setSelection(TextSelection.create(tr.doc, size + 1)));
      return size + 1;
    };
    const pick = async (item: HTMLElement) => {
      item.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      item.click();
      await settle();
      await settle();
    };

    // "Table view": a name typed makes a new database, a table first.
    startLink(view, endLine(), "database", "table");
    view.dispatch(view.state.tr.insertText("Reading list"));
    const made = document.querySelector<HTMLElement>('.kasten-menu .kasten-menu-item[data-key="create"]')!;
    expect(made.textContent).toContain("New database “Reading list”");
    await pick(made);
    expect(links.createDatabase).toHaveBeenCalledWith("Reading list", "table");
    expect(note.save()).toContain("![[tags/reading-list.yaml#Table]]\n");
    expect(note.save()).not.toContain("[[Reading list");

    // "Board view" on an existing database opens it on a board, one added if need be.
    startLink(view, endLine(), "database", "kanban");
    const items = [...document.querySelectorAll<HTMLElement>(".kasten-menu .kasten-menu-item")];
    expect(items.map((i) => i.dataset.key)).toEqual(["db:tags/task.yaml", "db:tags/paper.yaml"]);
    await pick(items[1]!);
    expect(links.viewOf).toHaveBeenCalledWith("paper", "kanban");
    expect(note.save()).toContain("![[tags/paper.yaml#Board]]\n");
  });

  it("makes a tag from a database's name", () => {
    expect(tagFrom("Reading list")).toBe("reading-list");
    expect(tagFrom("  #Films & shows 2026 ")).toBe("films-shows-2026");
    expect(tagFrom("!!!")).toBeNull();
  });
});

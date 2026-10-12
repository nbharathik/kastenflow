// "/diagram": pick a diagram to show in the page, narrowing by typing, or
// make a new one (its editor opens at once); the embed lands on a line of
// its own, named by the file's name, and the file stays a link.

import { TextSelection } from "@milkdown/kit/prose/state";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useTestEditor } from "../../../../test/editor";
import type { DiagramLink, LinkProvider } from "../links";
import { matchChoices, SLASH_CHOICES } from "./catalog";
import { embedTarget, matchDiagrams, startDiagramPick } from "./diagram-pick";

const DIAGRAMS: DiagramLink[] = [
  { path: "projects/trip/diagrams/Login-flow.drawio", title: "Login flow", hint: "Seaside trip" },
  { path: "library/Network.drawio", title: "Network" },
  { path: "library/Login-notes.drawio", title: "Login notes" },
  // Two diagrams called Map.drawio: only a path says which.
  { path: "library/Map.drawio", title: "Map" },
  { path: "projects/trip/diagrams/Map.drawio", title: "Map" },
];

const links: LinkProvider = {
  pages: () => [],
  open: vi.fn(),
  diagrams: () => DIAGRAMS,
  createDiagram: vi.fn(async (title: string) => `library/${title.replace(/\s+/g, "-")}.drawio`),
};
const editor = useTestEditor({ links });
const items = () => [...document.querySelectorAll<HTMLElement>(".kasten-menu .kasten-menu-item")];
const keys = () => items().map((i) => i.dataset.key);
const press = (key: string) => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Opens the menu in a new empty paragraph at the end of `body`. */
function openAtEnd(body: string): number {
  editor.open(body);
  const { view } = editor;
  const size = view.state.doc.content.size;
  const tr = view.state.tr.insert(size, view.state.schema.nodes.paragraph!.create());
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, size + 1)));
  startDiagramPick(view, editor.ctx, size + 1);
  return size + 1;
}

afterEach(() => {
  press("Escape");
  document.querySelector(".kasten-menu")?.remove();
  vi.clearAllMocks();
});

describe("/diagram", () => {
  it("is offered among the blocks, and found by what it is called elsewhere", () => {
    expect(SLASH_CHOICES.find((c) => c.key === "diagram")).toMatchObject({ label: "Diagram", icon: "icon:diagram", action: { type: "diagram" } });
    for (const word of ["diagram", "drawio", "flowchart", "architecture"]) expect(matchChoices(SLASH_CHOICES, word)[0]!.key, word).toBe("diagram");
  });

  it("matches diagrams by title, those starting with the words first", () => {
    expect(matchDiagrams(DIAGRAMS, "login").map((d) => d.title)).toEqual(["Login flow", "Login notes"]);
    expect(matchDiagrams(DIAGRAMS, "").length).toBe(5);
    expect(matchDiagrams(DIAGRAMS, "zzz")).toEqual([]);
  });

  it("names a diagram by its file's name, or by its path when another has the same name", () => {
    expect(embedTarget("library/Network.drawio", DIAGRAMS)).toBe("Network.drawio");
    expect(embedTarget("projects/trip/diagrams/Login-flow.drawio", DIAGRAMS)).toBe("Login-flow.drawio");
    expect(embedTarget("library/Map.drawio", DIAGRAMS)).toBe("library/Map.drawio");
    expect(embedTarget("projects/trip/diagrams/Map.drawio", DIAGRAMS)).toBe("projects/trip/diagrams/Map.drawio");
  });

  it("lists the diagrams and a new one, narrows as you type, and embeds the pick on a line of its own", () => {
    openAtEnd("Intro\n");
    expect(keys()).toEqual([
      "diagram:projects/trip/diagrams/Login-flow.drawio",
      "diagram:library/Network.drawio",
      "diagram:library/Login-notes.drawio",
      "diagram:library/Map.drawio",
      "diagram:projects/trip/diagrams/Map.drawio",
      "create",
    ]);
    for (const key of "net") press(key);
    expect(keys()).toEqual(["diagram:library/Network.drawio", "create"]);
    expect(items()[1]!.textContent).toContain("New diagram “net”");
    press("Backspace");
    press("Backspace");
    press("Backspace");
    expect(keys()).toHaveLength(6);
    for (const key of "netw") press(key);
    press("Enter");
    expect(editor.save()).toBe("Intro\n\n![[Network.drawio]]\n");
    expect(document.querySelector(".kasten-menu")).toBeNull();
  });

  it("makes a new diagram from what was typed, and puts it where it was asked for", async () => {
    openAtEnd("Intro\n");
    for (const key of "Plan") press(key);
    items().find((i) => i.dataset.key === "create")!.click();
    await settle();
    await settle();
    expect(links.createDiagram).toHaveBeenCalledWith("Plan");
    expect(editor.save()).toBe("Intro\n\n![[Plan.drawio]]\n");
  });

  it("makes an untitled one when nothing was typed", async () => {
    openAtEnd("Intro\n");
    items().find((i) => i.dataset.key === "create")!.click();
    await settle();
    await settle();
    expect(links.createDiagram).toHaveBeenCalledWith("Untitled diagram");
  });

  it("goes with Escape, leaving the page alone", () => {
    openAtEnd("Intro\n");
    press("Escape");
    expect(document.querySelector(".kasten-menu")).toBeNull();
    expect(editor.save()).toBe("Intro\n");
  });
});

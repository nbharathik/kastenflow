// Diagrams on a slide: Insert → Diagram puts the host's picture on the slide
// and keeps the diagram's name with it; Edit diagram brings the picture back
// from the host's editor and replaces it, one step of undo.

import { DeckEngine } from "@kasten-slides/wasm";
import { describe, expect, it, vi } from "vitest";

import { newDeck } from "../test/engine.ts";
import { COMMANDS, isEnabled, runCommand } from "./commands/index.ts";
import type { CommandContext } from "./commands/types.ts";
import { DIAGRAM_KEY, diagramOf, selectedDiagram } from "./diagrams.ts";
import { image, shape } from "./factory.ts";
import { paletteItems } from "./dialogs/insert-items.ts";
import type { DiagramPicture, SlidesHost } from "./host.ts";
import { contextItems } from "./menus/context-items.ts";
import { imageItems } from "./menus/items-insert.tsx";
import { EditorSession } from "./session/session.ts";
import { EditorUi } from "./ui-state.ts";

const FLOW: DiagramPicture = { path: "assets/Login-flow.png", source: "library/Login-flow.drawio", name: "Login flow", width: 1200, height: 800 };
const BIGGER: DiagramPicture = { path: "assets/Login-flow-2.png", source: "library/Login-flow.drawio", name: "Login flow", width: 1200, height: 1200 };

function hostWith(extra: Partial<SlidesHost>): SlidesHost & { notices: string[] } {
  const notices: string[] = [];
  return { save: async () => ({ status: "saved" }), imageUrl: () => undefined, addImage: async (name) => `assets/${name}`, deliver: async () => {}, notify: (message) => void notices.push(message), notices, ...extra };
}

async function open(extra: Partial<SlidesHost> = {}) {
  const host = hostWith(extra);
  const session = new EditorSession(await newDeck("Talk"), host, { saveDelay: 10_000 });
  const context: CommandContext = { session, ui: new EditorUi() };
  return { host, session, context };
}

/** The diagram pictures on the shown slide. */
const diagramsOn = (session: EditorSession) => session.slide.elements.filter((e) => diagramOf(e) !== undefined);

describe("a picture of a diagram", () => {
  it("is an image that names its diagram, and no other element is", async () => {
    const { session } = await open();
    const [plain] = session.elements.insert([image("assets/figure.png", { x: 10, y: 10, w: 100, h: 60 })]) as [string];
    expect(diagramOf(session.elements.find([plain])[0])).toBeUndefined();
    session.elements.patch({ [DIAGRAM_KEY]: "library/Flow.drawio" }, [plain]);
    expect(diagramOf(session.elements.find([plain])[0])).toBe("library/Flow.drawio");
    const [box] = session.elements.insert([shape("rect", { x: 10, y: 100, w: 40, h: 40 })]) as [string];
    session.elements.patch({ [DIAGRAM_KEY]: "library/Flow.drawio" }, [box]);
    expect(diagramOf(session.elements.find([box])[0])).toBeUndefined();
    session.select([plain]);
    expect(selectedDiagram(session.state)).toEqual({ id: plain, source: "library/Flow.drawio" });
    session.select([plain, box]);
    expect(selectedDiagram(session.state)).toBeUndefined();
    session.select([]);
    expect(selectedDiagram(session.state)).toBeUndefined();
  });
});

describe("Insert → Diagram", () => {
  it("is offered only where the host has diagrams", async () => {
    const without = await open();
    expect(isEnabled(COMMANDS.get("insert.diagram")!, without.context)).toBe(false);
    expect(imageItems(without.context).map((r) => r.id)).toEqual(["insert.image", "insert.gallery"]);
    expect(paletteItems(without.context).some((i) => i.id === "palette.diagram")).toBe(false);
    const withDiagrams = await open({ pickDiagram: async () => FLOW });
    expect(isEnabled(COMMANDS.get("insert.diagram")!, withDiagrams.context)).toBe(true);
    expect(imageItems(withDiagrams.context).map((r) => r.id)).toEqual(["insert.image", "insert.gallery", "insert.diagram"]);
    expect(paletteItems(withDiagrams.context).find((i) => i.id === "palette.diagram")).toMatchObject({ group: "Media", label: "Diagram…" });
  });

  it("puts the picture on the slide with its diagram's name, in one step of undo", async () => {
    const { session, context } = await open({ pickDiagram: async () => FLOW });
    const before = session.slide.elements.length;
    await runCommand("insert.diagram", context);
    const [placed] = diagramsOn(session);
    expect(session.slide.elements).toHaveLength(before + 1);
    expect(placed).toMatchObject({ type: "image", src: "assets/Login-flow.png", alt: "Diagram: Login flow", [DIAGRAM_KEY]: "library/Login-flow.drawio" });
    // The picture keeps the shape of the diagram: 3 by 2.
    expect(Math.abs(placed!.w! / placed!.h! - 1.5)).toBeLessThan(0.02);
    expect(session.state.selection).toEqual([placed!.id]);
    await runCommand("edit.undo", context);
    expect(diagramsOn(session)).toHaveLength(0);
  });

  it("keeps the name in the deck's text, where any build keeps it", async () => {
    const { session, context } = await open({ pickDiagram: async () => FLOW });
    await runCommand("insert.diagram", context);
    const text = session.core.save();
    expect(text).toMatch(/"x-diagram": ?"library\/Login-flow\.drawio"/);
    // Opened again from that text, the picture is still a picture of the diagram.
    const again = new EditorSession(DeckEngine.open(text), hostWith({}), { saveDelay: 10_000 });
    expect(diagramsOn(again)).toHaveLength(1);
  });

  it("does nothing when the person chooses nothing, and says so when the host fails", async () => {
    const none = await open({ pickDiagram: async () => null });
    await runCommand("insert.diagram", none.context);
    expect(diagramsOn(none.session)).toHaveLength(0);
    const broken = await open({
      pickDiagram: async () => {
        throw new Error("The diagram has no picture yet");
      },
    });
    await runCommand("insert.diagram", broken.context);
    expect(broken.host.notices).toEqual(["The diagram has no picture yet"]);
  });
});

describe("Edit diagram", () => {
  async function withPicture(edit: SlidesHost["editDiagram"]) {
    const opened = await open({ pickDiagram: async () => FLOW, ...(edit ? { editDiagram: edit } : {}) });
    await runCommand("insert.diagram", opened.context);
    const placed = diagramsOn(opened.session)[0]!;
    return { ...opened, placed };
  }

  it("is for a selected picture of a diagram, where the host can edit", async () => {
    const { context, session, placed } = await withPicture(async () => null);
    expect(isEnabled(COMMANDS.get("edit.diagram")!, context)).toBe(true);
    session.select([]);
    expect(isEnabled(COMMANDS.get("edit.diagram")!, context)).toBe(false);
    session.select([placed.id]);
    const readOnly = await open({ pickDiagram: async () => FLOW });
    await runCommand("insert.diagram", readOnly.context);
    expect(isEnabled(COMMANDS.get("edit.diagram")!, readOnly.context)).toBe(false);
  });

  it("is in the right-click menu of such a picture and not of another element", async () => {
    const { context, session, placed } = await withPicture(async () => null);
    const ids = () => contextItems("element", context).flatMap((item) => ("id" in item ? [item.id] : []));
    session.select([placed.id]);
    expect(ids()).toContain("edit.diagram");
    const [other] = session.elements.insert([shape("rect", { x: 10, y: 10, w: 40, h: 40 })]) as [string];
    session.select([other]);
    expect(ids()).not.toContain("edit.diagram");
  });

  it("asks the host to edit the diagram the picture names, and swaps in the new picture, width kept", async () => {
    const edit = vi.fn(async () => BIGGER);
    const { context, session, placed } = await withPicture(edit);
    session.select([placed.id]);
    await runCommand("edit.diagram", context);
    expect(edit).toHaveBeenCalledWith("library/Login-flow.drawio");
    const [after] = diagramsOn(session);
    expect(after).toMatchObject({ id: placed.id, src: "assets/Login-flow-2.png", x: placed.x, y: placed.y, w: placed.w, [DIAGRAM_KEY]: "library/Login-flow.drawio" });
    // Now square: the height follows the width.
    expect(after!.h).toBeCloseTo(placed.w!, 0);
    await runCommand("edit.undo", context);
    expect(diagramsOn(session)[0]).toMatchObject({ src: "assets/Login-flow.png", h: placed.h });
  });

  it("leaves the picture alone when the diagram did not change", async () => {
    const { context, session, placed } = await withPicture(async () => null);
    session.select([placed.id]);
    await runCommand("edit.diagram", context);
    expect(diagramsOn(session)[0]).toMatchObject({ src: "assets/Login-flow.png" });
  });

  it("leaves the slide alone when the host gives back the very picture it has", async () => {
    const { context, session, placed } = await withPicture(async () => FLOW);
    session.select([placed.id]);
    const revision = session.state.revision;
    await runCommand("edit.diagram", context);
    expect(session.state.revision).toBe(revision);
  });

  it("does not put the picture on a slide the person moved to meanwhile", async () => {
    let finish: (picture: DiagramPicture | null) => void = () => {};
    const { context, session, placed, host } = await withPicture(() => new Promise<DiagramPicture | null>((resolve) => (finish = resolve)));
    session.select([placed.id]);
    const editing = runCommand("edit.diagram", context);
    session.slides.add({ layout: "blank" });
    finish(BIGGER);
    await editing;
    expect(host.notices.at(-1)).toMatch(/slide changed while the diagram was open/);
    expect(session.deck.slides[0]!.elements.find((e) => e.id === placed.id)).toMatchObject({ src: "assets/Login-flow.png" });
  });

  it("says when the host fails", async () => {
    const { context, session, placed, host } = await withPicture(async () => {
      throw new Error("The editor is not installed");
    });
    session.select([placed.id]);
    await runCommand("edit.diagram", context);
    expect(host.notices).toEqual(["The editor is not installed"]);
  });
});

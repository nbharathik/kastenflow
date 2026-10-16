// The preview's chat when it is asked to draw a diagram or to explain one: scripted steps, a real diagram.

import { describe, expect, it } from "vitest";

import { MemoryVault } from "../../workspace/preview/memory-vault";
import type { ChatEvent, ContextChip } from "../types";
import { diagramAsk, rowOfBoxes } from "./diagram-reply";
import { BUILT_IN_ACTIONS } from "./actions";
import { PREVIEW_PROVIDER, previewChat } from "./fake-chat";

const draw = BUILT_IN_ACTIONS.find((a) => a.slug === "draw-diagram")!.instruction;
const explain = BUILT_IN_ACTIONS.find((a) => a.slug === "explain-diagram")!.instruction;
const PLAN: ContextChip = { kind: "note", label: "Seaside trip", ref: ["library/seaside-trip.md"] };

async function ask(vault: MemoryVault, text: string, context: ContextChip[]): Promise<ChatEvent[]> {
  const chat = previewChat(() => vault, { pace: 0 });
  const events: ChatEvent[] = [];
  let ended!: () => void;
  const done = new Promise<void>((resolve) => (ended = resolve));
  chat.onEvent((event) => {
    events.push(event);
    if (event.kind === "done" || event.kind === "error") ended();
  });
  await chat.send({ chat: "c1", provider: PREVIEW_PROVIDER.name, model: "canned-replies", text, context });
  await done;
  return events;
}

const textOf = (events: ChatEvent[]) => events.map((e) => e.text ?? "").join("");

describe("what the preview takes for a diagram request", () => {
  it("is the draw action's words, or the explain action's words with a diagram attached", () => {
    const chip: ContextChip = { kind: "diagram", label: "Flow", ref: ["library/Flow.drawio"] };
    expect(diagramAsk({ text: draw, context: [PLAN] })).toBe("draw");
    expect(diagramAsk({ text: "Draw a diagram of the plan", context: [] })).toBe("draw");
    expect(diagramAsk({ text: explain, context: [chip] })).toBe("explain");
    // Without a diagram there is nothing to explain, and other talk is the usual canned chat.
    expect(diagramAsk({ text: explain, context: [PLAN] })).toBeNull();
    expect(diagramAsk({ text: "Make a card about diagrams", context: [chip] })).toBeNull();
  });
});

describe("drawing a diagram in the preview", () => {
  it("makes a real diagram from the headings of the attached page, and shows the tool call", async () => {
    const vault = new MemoryVault({ "library/seaside-trip.md": "---\ntitle: Seaside trip\n---\n# Seaside trip\n\n## Pack\n\n## Travel\n\n## Stay\n" });
    const events = await ask(vault, draw, [PLAN]);
    const tool = events.find((e) => e.kind === "tool")!;
    expect(tool.tool).toMatchObject({ name: "diagram_new", input: { title: "Seaside trip: overview" } });
    const result = events.find((e) => e.kind === "toolResult")!.result!;
    expect(result).toMatchObject({ id: tool.tool!.id, ok: true, paths: ["library/Seaside-trip-overview.drawio"] });
    expect(result.summary).toBe("Made the diagram “Seaside trip: overview” with 7 cells · lint: 0 errors, 0 warnings");
    const made = (await vault.diagram(result.paths[0]!)).xml;
    for (const label of ["Seaside trip", "Pack", "Travel", "Stay"]) expect(made).toContain(`value="${label}"`);
    expect(made.match(/edge="1"/g)).toHaveLength(3);
    expect(textOf(events)).toContain("browser preview");
    expect(events.at(-1)).toMatchObject({ kind: "done" });
  });

  it("falls back to four plain boxes when the page has no headings or none is attached", async () => {
    const vault = new MemoryVault({});
    const events = await ask(vault, draw, []);
    const result = events.find((e) => e.kind === "toolResult")!.result!;
    expect(result.ok).toBe(true);
    expect((await vault.diagram(result.paths[0]!)).xml).toContain('value="Review"');
  });

  it("says so when there is no vault to make it in", async () => {
    const none = previewChat(() => null, { pace: 0 });
    const seen: ChatEvent[] = [];
    let ended!: () => void;
    const done = new Promise<void>((resolve) => (ended = resolve));
    none.onEvent((event) => {
      seen.push(event);
      if (event.kind === "done") ended();
    });
    await none.send({ chat: "c2", provider: PREVIEW_PROVIDER.name, model: "canned-replies", text: draw, context: [] });
    await done;
    expect(seen.find((e) => e.kind === "toolResult")!.result).toMatchObject({ ok: false, paths: [] });
    expect(textOf(seen)).toContain("could not be made");
  });
});

describe("explaining a diagram in the preview", () => {
  it("counts what the attached diagram holds, and changes nothing", async () => {
    const vault = new MemoryVault({});
    const path = await vault.createDiagram("Flow", null, rowOfBoxes(["A", "B", "C"]));
    const before = (await vault.diagram(path)).hash;
    const events = await ask(vault, explain, [{ kind: "diagram", label: "Flow", ref: [path] }]);
    expect(textOf(events)).toContain("It holds 3 boxes and 2 arrows.");
    expect(events.some((e) => e.kind === "tool")).toBe(false);
    expect((await vault.diagram(path)).hash).toBe(before);
  });
});

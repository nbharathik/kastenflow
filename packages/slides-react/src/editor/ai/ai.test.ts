import type { Element } from "@kasten-slides/wasm";
import { describe, expect, it, vi } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { type CommandContext, commandOf, isEnabled, runCommand } from "../commands/index.ts";
import { MemoryHost } from "../memory-host.ts";
import { EditorSession } from "../session/session.ts";
import { EditorUi } from "../ui-state.ts";
import type { AiOutcome, AiRequest } from "./ai-host.ts";
import { TASK_LABELS, promptFor } from "./prompts.ts";

const scope = { slideNumber: 3, slideId: "s-abc", slideTitle: "Results", elementIds: [] as string[] };

describe("what the editor asks the assistant", () => {
  it("names the slide and the elements, and always says to use the deck tools so the work can be seen and undone", () => {
    for (const task of Object.keys(TASK_LABELS) as (keyof typeof TASK_LABELS)[]) {
      const prompt = promptFor(task, { ...scope, elementIds: ["e-1", "e-2"], page: { path: "notes/plan.md", title: "Plan" } });
      expect(prompt, task).toContain("deck tools");
      expect(prompt, task).toContain("undo");
      if (task !== "build" && task !== "check") expect(prompt, task).toContain("s-abc");
    }
    expect(promptFor("rewrite", { ...scope, elementIds: ["e-1", "e-2"] })).toContain("e-1, e-2");
    expect(promptFor("notes", scope)).toContain("speaker notes");
    expect(promptFor("layout", scope)).toContain("lint_deck");
  });

  it("works on the selected words when there are some, else on the selected elements, else on the slide", () => {
    expect(promptFor("shorten", { ...scope, words: "A long sentence." })).toContain("“A long sentence.”");
    expect(promptFor("bullets", { ...scope, elementIds: ["e-9"] })).toContain("the selected element (e-9)");
    expect(promptFor("grammar", scope)).toContain("the text on slide 3");
  });

  it("builds from a note in two steps: an outline first, for review, then the slides", () => {
    const prompt = promptFor("build", { ...scope, page: { path: "notes/plan.md", title: "Plan" } });
    expect(prompt).toContain("notes/plan.md");
    expect(prompt.indexOf("outline")).toBeLessThan(prompt.indexOf("wait for my reply"));
    expect(prompt.indexOf("wait for my reply")).toBeLessThan(prompt.indexOf("build the slides"));
  });

  it("checks the deck with lint and a look at each slide", () => {
    const prompt = promptFor("check", scope);
    expect(prompt).toContain("lint_deck");
    expect(prompt).toContain("as it is drawn");
  });
});

async function open(ai?: (request: AiRequest) => Promise<AiOutcome>) {
  const host = new MemoryHost();
  const asked: AiRequest[] = [];
  if (ai) {
    host.ai = {
      ask: async (request) => {
        asked.push(request);
        return ai(request);
      },
    };
  }
  const session = new EditorSession(await newDeck("AI", "Light"), host, { saveDelay: 60_000, onError: () => {} });
  session.slides.add({ layout: "blank" });
  const context: CommandContext = { session, ui: new EditorUi() };
  return { host, session, context, asked };
}

const words = { type: "text", id: "", x: 100, y: 100, w: 400, h: 80, text: { paragraphs: [{ runs: [{ t: "Hello there" }] }] } } as Element;

describe("the commands", () => {
  it("are not offered where the host has no assistant", async () => {
    const { context } = await open();
    for (const task of Object.keys(TASK_LABELS)) expect(isEnabled(commandOf(`ai.${task}`), context), task).toBe(false);
  });

  it("need words to work on for the word tasks, and nothing for a slide or the deck", async () => {
    const { context, session } = await open(async () => ({ status: "sent" }));
    for (const task of ["rewrite", "shorten", "bullets", "grammar"]) expect(isEnabled(commandOf(`ai.${task}`), context), task).toBe(false);
    for (const task of ["layout", "notes", "check"]) expect(isEnabled(commandOf(`ai.${task}`), context), task).toBe(true);
    // Building from a note needs a host that can choose one.
    expect(isEnabled(commandOf("ai.build"), context)).toBe(false);
    session.elements.insert([words]);
    for (const task of ["rewrite", "shorten", "bullets", "grammar"]) expect(isEnabled(commandOf(`ai.${task}`), context), task).toBe(true);
  });

  it("send the request with the slide and the selection, and open the assistant's tab to show the answer", async () => {
    const { context, session, asked } = await open(async () => ({ status: "sent" }));
    const [id] = session.elements.insert([words]);
    await runCommand("ai.shorten", context);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ task: "shorten", slideId: session.slide.id, elementIds: [id] });
    expect(asked[0]?.prompt).toContain(id as string);
    expect(context.ui.state.panel).toBe("ai");
  });

  it("tell the person when the assistant would not take the request", async () => {
    const { context, host } = await open(async () => ({ status: "refused", message: "No assistant is set up." }));
    await runCommand("ai.notes", context);
    expect(host.notices).toEqual(["No assistant is set up."]);
  });

  it("build from the note chosen, and do nothing when none is chosen", async () => {
    const chosen = { path: "notes/plan.md", title: "Plan" };
    const first = await open(async () => ({ status: "sent" }));
    Object.assign(first.host, { pickPage: vi.fn(async () => chosen) });
    await runCommand("ai.build", first.context);
    expect(first.asked[0]?.prompt).toContain("notes/plan.md");
    const second = await open(async () => ({ status: "sent" }));
    Object.assign(second.host, { pickPage: vi.fn(async () => null) });
    await runCommand("ai.build", second.context);
    expect(second.asked).toHaveLength(0);
    expect(second.context.ui.state.panel).not.toBe("ai");
  });
});

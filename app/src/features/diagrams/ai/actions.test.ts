// What a person can ask AI to do with a diagram, and that the app's list of built-in actions in the browser preview is the files the
// app ships.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { useShell } from "../../../lib/store";
import type { DeckInfo } from "../../../lib/vault/types";
import { drafts } from "../../chat/message-drafts";
import { BUILT_IN_ACTIONS } from "../../chat/preview/actions";
import { useChat } from "../../chat/store";
import { resetChat, scriptedChat, type Scripted } from "../../chat/test-kit";
import { followSlide, slideChip, threadOfDeck } from "../../slides/ai-thread";
import { useDecks } from "../../slides/store";
import { checkWithAi, drawForSlide, drawFromScratch, drawWithAi, explainWithAi, tidyWithAi } from "./actions";

const FLOW = { path: "library/Login-flow.drawio", title: "Login flow" };
const DIAGRAM_CHIP = { kind: "diagram", label: "Login flow", ref: ["library/Login-flow.drawio"] };
const action = (slug: string) => BUILT_IN_ACTIONS.find((a) => a.slug === slug)!;
let chat: Scripted;

beforeEach(() => {
  localStorage.clear();
  chat = scriptedChat();
  resetChat(chat);
  useShell.setState({ chatOpen: false });
  drafts.clear();
  useDecks.setState({ list: [] });
});

describe("Check, Explain and Tidy", () => {
  it.each([
    ["check-diagram", checkWithAi],
    ["explain-diagram", explainWithAi],
    ["tidy-diagram", tidyWithAi],
  ] as const)("%s starts a chat about the diagram and asks what the action says", async (slug, run) => {
    expect(await run(FLOW)).toBe(true);
    expect(chat.requests).toHaveLength(1);
    expect(chat.requests[0]).toMatchObject({ text: action(slug).instruction, context: [DIAGRAM_CHIP] });
    expect(useShell.getState().chatOpen).toBe(true);
    // About that diagram and nothing else: it does not take up the page in front.
    const thread = useChat.getState().threads[useChat.getState().active!]!;
    expect(thread.follow).toBe(false);
    expect(thread.context.map((c) => c.origin)).toEqual(["added"]);
  });

  it("leaves the action's words in the box when there is no provider to ask", async () => {
    resetChat(scriptedChat([]));
    expect(await checkWithAi(FLOW)).toBe(true);
    expect(drafts.get(useChat.getState().active!)).toBe(action("check-diagram").instruction);
  });
});

describe("Draw with AI", () => {
  it("opens a chat about the diagram with the start of a sentence ready, and sends nothing", () => {
    const id = drawWithAi(FLOW);
    expect(chat.requests).toEqual([]);
    expect(useShell.getState().chatOpen).toBe(true);
    expect(drafts.get(id)).toBe("Change this diagram: ");
    expect(useChat.getState().active).toBe(id);
    expect(useChat.getState().threads[id]!.context).toMatchObject([DIAGRAM_CHIP]);
  });

  it("from the Diagrams view attaches nothing, and is ready for what to draw", () => {
    const id = drawFromScratch();
    expect(drafts.get(id)).toBe("Draw a diagram of ");
    expect(useChat.getState().threads[id]!.context).toEqual([]);
    expect(chat.requests).toEqual([]);
  });
});

describe("Draw with AI from Insert → Diagram…", () => {
  it("asks for a diagram of the deck, which it names", async () => {
    useDecks.setState({ list: [{ path: "library/talk.deck", title: "Tool use" } as DeckInfo] });
    expect(await drawForSlide("library/talk.deck")).toBe(true);
    expect(chat.requests[0]).toMatchObject({ text: action("draw-diagram").instruction, context: [{ kind: "deck", label: "Tool use", ref: ["library/talk.deck"] }] });
  });

  it("names the deck by its file when the list does not have it yet", async () => {
    await drawForSlide("projects/pitch/pitch-talk.deck");
    expect(chat.requests[0]!.context).toEqual([{ kind: "deck", label: "pitch-talk", ref: ["projects/pitch/pitch-talk.deck"] }]);
  });

  it("asks about the slide the assistant tab says the person is looking at", async () => {
    const deck = "library/talk.deck";
    const chip = slideChip({ deckPath: deck, slideId: "s2", slideNumber: 2, slideTitle: "The loop", elementIds: ["e7"] });
    followSlide(threadOfDeck(deck), chip, null);
    await drawForSlide(deck);
    expect(chat.requests[0]!.context).toEqual([{ kind: "slide", label: "Slide 2: The loop · 1 selected", ref: [deck, "s2", "e7"] }]);
  });

  it("opens a chat ready for what to draw when no deck is known", async () => {
    expect(await drawForSlide(undefined)).toBe(true);
    expect(chat.requests).toEqual([]);
    expect(drafts.get(useChat.getState().active!)).toBe("Draw a diagram of ");
  });
});

/** The shipped files of the actions, where the app reads them from. */
const BUILT_IN = [join(process.cwd(), "src-tauri"), join(process.cwd(), "app", "src-tauri")].find((dir) => existsSync(dir));

function shipped(slug: string) {
  const text = readFileSync(join(BUILT_IN!, "src/chat/actions/builtin", `${slug}.md`), "utf8").replace(/\r\n/g, "\n");
  const [, front = "", ...body] = text.split(/^---\s*$/m);
  const field = (key: string) => new RegExp(`^${key}:\\s*(.*)$`, "m").exec(front)?.[1]?.trim() ?? "";
  const list = (key: string) =>
    field(key)
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return { title: field("title"), icon: field("icon"), writes: field("writes"), where: list("where"), needs: list("needs"), optional: list("optional"), instruction: body.join("---").trim() };
}

describe("the built-in diagram actions in the browser preview", () => {
  it.each(["draw-diagram", "explain-diagram", "tidy-diagram", "check-diagram"])("%s is the file the app ships", (slug) => {
    expect(BUILT_IN).toBeDefined();
    const file = shipped(slug);
    const mirror = action(slug);
    expect({ title: mirror.title, icon: mirror.icon, writes: mirror.writes, where: mirror.where, needs: mirror.needs, optional: mirror.optional, instruction: mirror.instruction }).toEqual(file);
  });

  it("are offered in the chat only, so the editor's menus stay as they were", () => {
    for (const slug of ["draw-diagram", "explain-diagram", "tidy-diagram", "check-diagram"]) expect(action(slug).where).toEqual(["chat"]);
  });
});

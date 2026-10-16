// A diagram changed by the chat reaches the places that show it: applying the staged changes, and a tool that writes at once, tell the
// diagrams (an editor that is open on one loads what was written).

import { beforeEach, describe, expect, it, vi } from "vitest";

import { onDiagramChanged } from "../../diagrams/store";
import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { flushStream, useChat } from "../store";
import { CLAUDE, resetChat, scriptedChat, type Scripted } from "../test-kit";
import { applyChanges } from "./changes";

const FLOW = "library/Login-flow.drawio";
let chat: Scripted;
const heard: string[] = [];

/** A thread that has staged `count` changes and whose answer is over. */
async function staged(count = 2) {
  const id = useChat.getState().start();
  await useChat.getState().send(id, "Draw it");
  chat.emit({ chat: id, turn: "turn-1", kind: "changes", changes: { id: "set-1", count, paths: [FLOW] } });
  chat.emit({ chat: id, turn: "turn-1", kind: "done" });
  return id;
}

beforeEach(async () => {
  localStorage.clear();
  heard.length = 0;
  chat = scriptedChat([CLAUDE]);
  resetChat(chat);
  await useWorkspace.getState().connect({ client: new MemoryVault({}) });
  await useChat.getState().loadProviders();
  onDiagramChanged((path) => void heard.push(path));
});

describe("applying a chat's staged changes", () => {
  it("tells the diagram it changed, by its source, whichever of its two files the commit names", async () => {
    const id = await staged();
    chat.applyResult = { status: "applied", commit: "c0ffee", paths: [FLOW, `${FLOW}.svg`, "library/welcome.md"] };
    expect((await applyChanges(id)).ok).toBe(true);
    expect([...new Set(heard)]).toEqual([FLOW]);
  });

  it("tells nothing when only notes were written", async () => {
    const id = await staged();
    chat.applyResult = { status: "applied", commit: "c0ffee", paths: ["library/welcome.md"] };
    await applyChanges(id);
    expect(heard).toEqual([]);
  });

  it("tells nothing when the vault moved on and nothing was written", async () => {
    const id = await staged();
    chat.applyResult = { status: "stale", files: [FLOW] };
    await applyChanges(id);
    expect(heard).toEqual([]);
  });
});

describe("a tool that writes a diagram at once", () => {
  it("tells the diagram, as it does the boards and decks", async () => {
    const id = useChat.getState().start();
    await useChat.getState().send(id, "Draw it");
    chat.emit({ chat: id, turn: "turn-1", kind: "tool", tool: { id: "k1", name: "diagram_edit", input: {} } });
    chat.emit({ chat: id, turn: "turn-1", kind: "toolResult", result: { id: "k1", ok: true, summary: "Changed “Login flow”: add 1 node", paths: [FLOW] } });
    flushStream();
    await vi.waitFor(() => expect([...new Set(heard)]).toEqual([FLOW]));
  });

  it("tells nothing for a change that waits in the staged changes, which wrote nothing", async () => {
    const id = useChat.getState().start();
    await useChat.getState().send(id, "Draw it");
    chat.emit({ chat: id, turn: "turn-1", kind: "tool", tool: { id: "k1", name: "diagram_edit", input: {} } });
    chat.emit({ chat: id, turn: "turn-1", kind: "toolResult", result: { id: "k1", ok: true, summary: "Changed “Login flow”: add 1 node", paths: [FLOW], staged: true } });
    flushStream();
    await new Promise((done) => setTimeout(done, 20));
    expect(heard).toEqual([]);
  });
});

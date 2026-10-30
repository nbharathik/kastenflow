import { describe, expect, it } from "vitest";

import { MemoryVault } from "../../workspace/preview/memory-vault";
import type { ChatEvent, ChatRequest } from "../types";
import { demoChat, DEMO_MODELS, DEMO_PROVIDER } from "./chat";
import { DEMO_PROMPT, isPlanRequest, PLAN_TITLE, weekPlan } from "./plan";

const page = (title: string) => `---\ntype: page\ntitle: ${title}\n---\n# ${title}\n`;
const NOTES = {
  "library/launch-checklist.md": page("Launch checklist"),
  "library/reading-list.md": page("Reading list"),
  "library/trip-ideas.md": page("Trip ideas"),
  "library/zebra-notes.md": page("Zebra notes"),
};

const request = (text: string, over: Partial<ChatRequest> = {}): ChatRequest => ({ chat: "c1", provider: DEMO_PROVIDER.name, model: DEMO_PROVIDER.model, text, context: [], ...over });

/** Sends a request and collects the turn's events until it ends. */
async function ask(chat: ReturnType<typeof demoChat>, send: ChatRequest): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  let ended!: () => void;
  const done = new Promise<void>((resolve) => (ended = resolve));
  const stop = chat.onEvent((event) => {
    events.push(event);
    if (event.kind === "done" || event.kind === "error") ended();
  });
  await chat.send(send);
  await done;
  stop();
  return events;
}

const textOf = (events: ChatEvent[]) => events.map((e) => e.text ?? "").join("");

describe("the demo's chat", () => {
  it("knows the request it is made to answer", () => {
    expect(isPlanRequest(DEMO_PROMPT)).toBe(true);
    expect(isPlanRequest("Please plan my week")).toBe(true);
    expect(isPlanRequest("What is this?")).toBe(false);
  });

  it("starts with a ChatGPT plan and offers its models", async () => {
    const chat = demoChat(() => null, { pace: 0 });
    expect((await chat.providers()).map((p) => p.name)).toEqual(["ChatGPT"]);
    expect(await chat.listProviderModels({ name: "ChatGPT", kind: "chatgpt", baseUrl: "", model: "" }, null)).toEqual(DEMO_MODELS);
  });

  it("proposes a week plan first: nothing is in the notes until it is applied", async () => {
    const vault = new MemoryVault(NOTES);
    const chat = demoChat(() => vault, { pace: 0 });
    const events = await ask(chat, request(DEMO_PROMPT));
    expect(events.find((e) => e.kind === "tool")!.tool).toMatchObject({ name: "create_note", input: { type: "page", title: PLAN_TITLE } });
    const result = events.find((e) => e.kind === "toolResult")!.result!;
    expect(result).toMatchObject({ ok: true, staged: true, summary: "Created page “Week plan”" });
    expect(events.find((e) => e.kind === "changes")!.changes).toMatchObject({ count: 1, paths: [result.paths[0]] });
    expect(textOf(events)).toContain("Nothing is in your notes until you apply them");
    expect(events.at(-1)!.kind).toBe("done");
    // The staged page names the vault's own notes, the same three every time.
    const view = await chat.changes("c1");
    expect(view.files).toHaveLength(1);
    expect(view.files[0]).toMatchObject({ title: PLAN_TITLE, kind: "note", new: true, before: null, stale: false });
    expect(view.files[0]!.after).toContain("[[Launch checklist]]");
    expect(view.files[0]!.after).toContain("[[Reading list]]");
    expect(view.files[0]!.after).toContain("[[Trip ideas]]");
    expect(view.files[0]!.after).not.toContain("Zebra");
    expect((view.files[0]!.after.match(/- \[ \]/g) ?? []).length).toBe(3);
    expect((await vault.list()).map((n) => n.title)).not.toContain(PLAN_TITLE);
  });

  it("applies the plan through the vault's agent ops, and one undo takes it back", async () => {
    const vault = new MemoryVault(NOTES);
    const chat = demoChat(() => vault, { pace: 0 });
    await ask(chat, request(DEMO_PROMPT));
    const applied = await chat.applyChanges("c1");
    expect(applied.status).toBe("applied");
    const paths = applied.status === "applied" ? applied.paths : [];
    expect(paths).toHaveLength(1);
    expect((await vault.list()).map((n) => n.title)).toContain(PLAN_TITLE);
    expect((await vault.tasks()).filter((t) => t.title === PLAN_TITLE)).toHaveLength(3);
    expect(await chat.changes("c1")).toMatchObject({ files: [] });
    const [session] = await vault.sessions();
    expect(session).toMatchObject({ client: "chat" });
    expect(await vault.undoSession(session!.id)).toMatchObject({ conflict: null });
    expect((await vault.list()).map((n) => n.title)).not.toContain(PLAN_TITLE);
  });

  it("discarding the proposal leaves the notes as they were", async () => {
    const vault = new MemoryVault(NOTES);
    const chat = demoChat(() => vault, { pace: 0 });
    await ask(chat, request(DEMO_PROMPT));
    await chat.discardChanges("c1");
    expect((await chat.changes("c1")).files).toEqual([]);
    expect((await vault.list()).map((n) => n.title)).not.toContain(PLAN_TITLE);
  });

  it("writes at once when the thread applies directly", async () => {
    const vault = new MemoryVault(NOTES);
    const chat = demoChat(() => vault, { pace: 0 });
    const events = await ask(chat, request(DEMO_PROMPT, { writes: "direct" }));
    expect(events.some((e) => e.kind === "changes")).toBe(false);
    const result = events.find((e) => e.kind === "toolResult")!.result!;
    expect(result.staged).toBeUndefined();
    expect((await vault.list()).map((n) => n.path)).toContain(result.paths[0]);
  });

  it("follows how much agents may do: Autonomous writes at once, Review everything never does", async () => {
    const vault = new MemoryVault(NOTES);
    const chat = demoChat(() => vault, { pace: 0 });
    await vault.setAgentPolicy({ mode: "autonomous", until: null, projects: {} });
    const autonomous = await ask(chat, request(DEMO_PROMPT));
    expect(autonomous.some((e) => e.kind === "changes")).toBe(false);
    expect(autonomous.find((e) => e.kind === "toolResult")!.result!.staged).toBeUndefined();
    await vault.setAgentPolicy({ mode: "review", until: null, projects: {} });
    const reviewed = await ask(chat, request(DEMO_PROMPT, { writes: "direct" }));
    expect(reviewed.find((e) => e.kind === "toolResult")!.result!.staged).toBe(true);
  });

  it("streams the same words in the same pieces every time", async () => {
    const run = async () => {
      const chat = demoChat(() => new MemoryVault(NOTES), { pace: 0 });
      return (await ask(chat, request(DEMO_PROMPT))).filter((e) => e.kind === "text").map((e) => e.text);
    };
    const [a, b] = [await run(), await run()];
    expect(a.length).toBeGreaterThan(50);
    expect(a).toEqual(b);
  });

  it("answers anything else with a short canned reply that quotes a selection", async () => {
    const chat = demoChat(() => new MemoryVault(NOTES), { pace: 0 });
    const plain = await ask(chat, request("What can you do?"));
    expect(textOf(plain)).toContain(DEMO_PROMPT);
    expect(plain.some((e) => e.kind === "tool")).toBe(false);
    const selection = { kind: "selection" as const, label: "Selection", ref: [], selection: { source: { kind: "page" as const, path: "library/trip-ideas.md" }, text: "Book the ferry before the weekend.", pinned: true } };
    const quoted = await ask(chat, request("Summarise this", { context: [selection] }));
    expect(textOf(quoted)).toContain("> Book the ferry before the weekend.");
  });

  it("plans from plain steps when the vault has no notes", () => {
    expect(weekPlan([]).tasks).toEqual(["Clear the Inbox", "Draft the weekly summary", "Review the week and back up the vault"]);
  });
});

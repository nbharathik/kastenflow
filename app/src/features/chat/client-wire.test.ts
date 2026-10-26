// The chat's side of the Tauri boundary: the names and arguments of the
// commands the history, tie and selection features use, and that a selection
// goes out in the request as the backend reads it.

import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));

import { adoptFailureOf } from "./agent-types";
import { tauriChat } from "./client";
import { selectionChip } from "./selection/chip";
import { bare } from "./thread";

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
});

describe("commands for history, ties and limits", () => {
  it("calls each with the names and arguments the backend takes", async () => {
    const client = tauriChat();
    await client.newThread("chat-a");
    await client.newThread();
    await client.unarchive("chat-b");
    await client.deleteArchived(["chat-c", "chat-d"]);
    await client.limits();
    await client.setLimits({ listSize: 50, maxConcurrent: 2 });
    await client.bind("chat-e", { kind: "page", path: "library/plan.md", id: "n1" });
    await client.unbind("chat-e");
    await client.threadFor({ kind: "deck", path: "library/talk.deck" });
    await client.rebind([{ from: "a.md", to: "b.md" }]);
    await client.importBindings({ "library/talk.deck": "chat-f" }, "deck");
    expect(invoke.mock.calls).toEqual([
      ["chat_new_thread", { from: "chat-a" }],
      ["chat_new_thread", {}],
      ["chat_unarchive", { id: "chat-b" }],
      ["chat_delete_archived", { ids: ["chat-c", "chat-d"] }],
      ["chat_limits"],
      ["set_chat_limits", { limits: { listSize: 50, maxConcurrent: 2 } }],
      ["chat_bind", { thread: "chat-e", target: { kind: "page", path: "library/plan.md", id: "n1" } }],
      ["chat_unbind", { thread: "chat-e" }],
      ["chat_thread_for", { target: { kind: "deck", path: "library/talk.deck" } }],
      ["chat_rebind", { moves: [{ from: "a.md", to: "b.md" }] }],
      ["chat_import_bindings", { kind: "deck", map: { "library/talk.deck": "chat-f" } }],
    ]);
  });
});

describe("a selection in the request", () => {
  it("goes out as a chip with no ref and the text, source and whether it was kept", async () => {
    const auto = selectionChip({ source: { kind: "pdf", path: "papers/loops.pdf", id: "3" }, text: "agents call tools in a loop", title: "loops" }, false);
    const kept = selectionChip({ source: { kind: "page", path: "library/plan.md" }, text: "Pack the tent.", heading: "Intro", title: "Plan" }, true);
    const client = tauriChat();
    await client.send({ chat: "chat-1", provider: "Claude", model: "m", text: "Explain", context: [kept, auto].map(bare), date: "2026-10-22" });
    const [name, args] = invoke.mock.calls[0]!;
    expect(name).toBe("chat_send");
    expect((args as { request: { context: unknown[] } }).request.context).toEqual([
      { kind: "selection", label: "Selection · “Pack the tent.” · Plan", ref: [], selection: { source: { kind: "page", path: "library/plan.md" }, text: "Pack the tent.", heading: "Intro", pinned: true } },
      { kind: "selection", label: "Selection · “agents call tools in a loop” · loops", ref: [], selection: { source: { kind: "pdf", path: "papers/loops.pdf", id: "3" }, text: "agents call tools in a loop", pinned: false } },
    ]);
  });
});

describe("chat_load failures", () => {
  it("reads the typed adopt failure, and nothing else", () => {
    expect(adoptFailureOf({ kind: "adoptFailed", reason: "damaged", message: "The file is damaged" })).toEqual({ kind: "adoptFailed", reason: "damaged", message: "The file is damaged" });
    expect(adoptFailureOf({ kind: "adoptFailed", reason: "odd", message: "x" })?.reason).toBe("missing");
    expect(adoptFailureOf("No vault is open")).toBeNull();
    expect(adoptFailureOf(new Error("boom"))).toBeNull();
    expect(adoptFailureOf(null)).toBeNull();
  });
});

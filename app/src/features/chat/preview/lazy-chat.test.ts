import { describe, expect, it } from "vitest";

import type { ChatEvent, ChatRequest } from "../types";
import { PREVIEW_PROVIDER } from "./fake-chat";
import { lazyPreviewChat } from "./lazy-chat";

const request = (chat: string): ChatRequest => ({ chat, provider: PREVIEW_PROVIDER.name, model: "canned-replies", text: "Hello", context: [] });
const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

describe("the preview's chat that loads when it is first used", () => {
  it("is the preview's chat: one stand-in answers every call", async () => {
    const chat = lazyPreviewChat(() => null);
    expect(chat.kind).toBe("preview");
    expect(await chat.providers()).toEqual([PREVIEW_PROVIDER]);
    await chat.removeProvider(PREVIEW_PROVIDER.name);
    expect(await chat.providers()).toEqual([]);
    await expect(chat.send(request("c1"))).rejects.toThrow("No AI provider called “Preview”");
    // Without a vault open it says so, as the preview's chat does.
    const brainstorm = { board: "projects/trip/boards/hilltown.canvas", topic: "Day trips", count: 3, provider: "Preview", model: "canned-replies" };
    await expect(lazyPreviewChat(() => null).brainstorm(brainstorm)).rejects.toThrow("No vault is open");
  });

  it("gives a listener added before it loaded the events of a turn, and none once it stops listening", async () => {
    const chat = lazyPreviewChat(() => null);
    const events: ChatEvent[] = [];
    let ended!: () => void;
    const done = new Promise<void>((resolve) => (ended = resolve));
    const stopListening = chat.onEvent((event) => {
      events.push(event);
      if (events.length === 3) void chat.stop("c1");
      if (event.kind === "done") ended();
    });
    await chat.send(request("c1"));
    await done;
    expect(events.at(-1)).toMatchObject({ chat: "c1", kind: "done", stopped: true });

    stopListening();
    const heard = events.length;
    await chat.send(request("c2"));
    await pause(120);
    await chat.stop("c2");
    expect(events.length).toBe(heard);
  });

  it("gives nothing to a listener that stopped before the stand-in had loaded", async () => {
    const chat = lazyPreviewChat(() => null);
    const events: ChatEvent[] = [];
    chat.onEvent((event) => events.push(event))();
    await chat.send(request("c1"));
    await pause(120);
    await chat.stop("c1");
    expect(events).toEqual([]);
  });
});

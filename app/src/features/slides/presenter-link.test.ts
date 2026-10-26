import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const unlisten = vi.fn();
let deliver: ((event: { payload: unknown }) => void) | null = null;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
  isTauri: () => true,
}));
// Only this window's own listening is allowed: a listener on every window would hear the words meant for the other one.
vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => {
    throw new Error("A global listener hears the words meant for the other window");
  },
}));
const labelled: string[] = [];
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    label: "this",
    listen: async (name: string, handler: (event: { payload: unknown }) => void) => {
      expect(name).toBe("kasten://present");
      labelled.push("this");
      deliver = handler;
      return unlisten;
    },
  }),
}));

const { allowEmbeds, embeddedPages, openTauriPresenter, tauriLink } = await import("./presenter-link");

afterEach(() => {
  invoke.mockReset();
  unlisten.mockReset();
  deliver = null;
  labelled.length = 0;
});

describe("the link between the two windows of a talk", () => {
  it("listens on this window only", async () => {
    await tauriLink();
    expect(labelled).toEqual(["this"]);
  });

  it("hands on the messages of the other window, and nothing else", async () => {
    const link = await tauriLink();
    const heard: unknown[] = [];
    link.subscribe((message) => heard.push(message));
    deliver?.({ payload: { type: "hello", from: "other" } });
    deliver?.({ payload: { type: "state", state: { indexh: 2, indexv: 0 }, from: "other", n: 1 } });
    deliver?.({ payload: "hello" });
    deliver?.({ payload: { type: "run", code: "alert(1)" } });
    // The core's own word for a window that closed has no name on it.
    deliver?.({ payload: { type: "bye" } });
    expect(heard).toEqual([{ type: "hello" }, { type: "state", state: { indexh: 2, indexv: 0 } }, { type: "bye" }]);
  });

  it("drops the words it said itself, which come back to it when the core hands them to every listener", async () => {
    const link = await tauriLink();
    invoke.mockResolvedValue(undefined);
    const heard: unknown[] = [];
    link.subscribe((message) => heard.push(message));
    link.post({ type: "state", state: { indexh: 4, indexv: 0 } });
    const sent = invoke.mock.calls[0]?.[1] as { message: { from: string } };
    deliver?.({ payload: sent.message });
    deliver?.({ payload: { type: "state", state: { indexh: 5, indexv: 0 }, from: `${sent.message.from}-not`, n: 9 } });
    expect(heard).toEqual([{ type: "state", state: { indexh: 5, indexv: 0 } }]);
  });

  it("stops handing a message on to one that unsubscribed", async () => {
    const link = await tauriLink();
    const heard: unknown[] = [];
    const stop = link.subscribe((message) => heard.push(message));
    stop();
    deliver?.({ payload: { type: "hello" } });
    expect(heard).toEqual([]);
  });

  it("posts through the core with its name on it, and a message the core refuses is not an error", async () => {
    const link = await tauriLink();
    invoke.mockRejectedValue(new Error("not a message"));
    link.post({ type: "bye" });
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledWith("presenter_post", { message: { type: "bye", from: expect.any(String) } });
  });

  it("stops listening when it is closed", async () => {
    const link = await tauriLink();
    link.close();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});

describe("opening the presenter's window", () => {
  it("listens first, then asks the core for the window, and gives the link", async () => {
    invoke.mockResolvedValue(undefined);
    const link = await openTauriPresenter("decks/Talk.deck");
    expect(link).not.toBeNull();
    expect(deliver).not.toBeNull();
    expect(invoke).toHaveBeenCalledWith("open_presenter", { deckPath: "decks/Talk.deck" });
    expect(unlisten).not.toHaveBeenCalled();
  });

  it("hears a goodbye only from the window it holds, not a late one of an older window", async () => {
    invoke.mockResolvedValue(7);
    const link = await openTauriPresenter("decks/Talk.deck");
    const heard: unknown[] = [];
    link?.subscribe((message) => heard.push(message));
    deliver?.({ payload: { type: "bye", w: 6 } });
    expect(heard).toEqual([]);
    deliver?.({ payload: { type: "bye", w: 7 } });
    // The presenter's own goodbye carries no number from the core and is heard.
    deliver?.({ payload: { type: "bye", from: "other" } });
    expect(heard).toEqual([{ type: "bye" }, { type: "bye" }]);
  });

  it("drops a numbered goodbye that comes before the window's number is known", async () => {
    let answer: (n: number) => void = () => {};
    invoke.mockReturnValue(new Promise<number>((resolve) => (answer = resolve)));
    const opening = openTauriPresenter("decks/Talk.deck");
    await Promise.resolve();
    await Promise.resolve();
    const heard: unknown[] = [];
    // The link is made before the window is asked for; nothing subscribes yet, so check through a later subscription.
    deliver?.({ payload: { type: "bye", w: 2 } });
    answer(3);
    const link = await opening;
    link?.subscribe((message) => heard.push(message));
    deliver?.({ payload: { type: "bye", w: 2 } });
    expect(heard).toEqual([]);
  });

  it("gives null, and stops listening, when the window would not open", async () => {
    invoke.mockRejectedValue(new Error("no window"));
    expect(await openTauriPresenter("decks/Talk.deck")).toBeNull();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});

describe("the pages a deck embeds", () => {
  it("are found at any depth, once each", () => {
    const deck = {
      slides: [
        { elements: [{ type: "embed", url: "https://example.org/a" }, { type: "group", children: [{ type: "embed", url: "http://localhost:3000/" }, { type: "text" }] }] },
        { elements: [{ type: "embed", url: "https://example.org/a" }, { type: "embed" }] },
      ],
    };
    expect(embeddedPages(deck)).toEqual(["https://example.org/a", "http://localhost:3000/"]);
    expect(embeddedPages({ slides: [] })).toEqual([]);
    expect(embeddedPages(null)).toEqual([]);
  });

  it("are handed to the core to allow, and an empty list ends it", async () => {
    invoke.mockResolvedValue(undefined);
    await allowEmbeds(["https://example.org/a"]);
    await allowEmbeds([]);
    expect(invoke.mock.calls).toEqual([
      ["allow_embeds", { urls: ["https://example.org/a"] }],
      ["allow_embeds", { urls: [] }],
    ]);
  });

  it("are asked for without an error when the core refuses", async () => {
    invoke.mockRejectedValue(new Error("refused"));
    await expect(allowEmbeds(["https://example.org/a"])).resolves.toBeUndefined();
  });
});

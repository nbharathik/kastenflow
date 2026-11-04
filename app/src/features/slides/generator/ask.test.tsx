// An agent wrote code for a deck that has not been allowed to run: the person is shown the code and decides, and the app is told. The
// window also hears the app's events for as long as it is there.

import { listen } from "@tauri-apps/api/event";
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AllowDialog, { decide } from "./AllowDialog";
import { type AskRequest, useGeneratorAsk } from "./ask-state";
import { ASK_EVENT, RUN_EVENT, useRunGeneratorsForAgents } from "./listener";

const backend = vi.hoisted(() => ({
  allowGenerator: vi.fn(async (_deck: string, _hash: string) => undefined as unknown),
  answerApp: vi.fn(async (_id: string, _answer: { text: string } | { error: string }) => undefined as unknown),
}));

vi.mock("./backend", () => ({ ...backend, tauriGeneratorBackend: { openFrame: vi.fn(), closeFrame: vi.fn() } }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("../../../lib/api", async (original) => ({ ...(await original<typeof import("../../../lib/api")>()), inTauri: () => true }));

const CODE = "return kit.svg(10, 10, '');";
const HASH = "0123456789abcdef".repeat(4);
const ASK: AskRequest = { id: "ask-1", deck: "library/talk.deck", agent: "claude-code", code: CODE, codeBytes: CODE.length, hash: HASH, inputs: ["sales"] };

beforeEach(() => {
  vi.clearAllMocks();
  useGeneratorAsk.setState({ queue: [] });
});
afterEach(cleanup);

describe("deciding whether an agent's code may run", () => {
  it("shows the agent, the deck, the code and what it may read", () => {
    useGeneratorAsk.getState().push(ASK);
    render(<AllowDialog />);
    const dialog = screen.getByRole("dialog", { name: "An agent wants to run code" });
    expect(dialog.textContent).toContain("claude-code");
    expect(dialog.textContent).toContain("library/talk.deck");
    expect(dialog.textContent).toContain("no network");
    expect(dialog.textContent).toContain("sales");
    expect(screen.getByLabelText("The code").textContent).toBe(CODE);
    // Code shown in part says how much more there is.
    useGeneratorAsk.setState({ queue: [{ ...ASK, id: "ask-2", code: "abc", codeBytes: 10 }] });
    cleanup();
    render(<AllowDialog />);
    expect(screen.getByLabelText("The code").textContent).toContain("7 more characters");
  });

  it("allows the deck for good: the choice is kept, then the app is told yes, and the question goes", async () => {
    useGeneratorAsk.getState().push(ASK);
    render(<AllowDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Allow to run" }));
    await waitFor(() => expect(useGeneratorAsk.getState().queue).toEqual([]));
    // The choice is for this code in this deck: the hash the app computed travels back with it.
    expect(backend.allowGenerator).toHaveBeenCalledWith("library/talk.deck", HASH);
    expect(backend.answerApp).toHaveBeenCalledWith("ask-1", { text: "allow" });
  });

  it("shows the code's hash beside the code, and says the choice is for this code", () => {
    useGeneratorAsk.getState().push(ASK);
    render(<AllowDialog />);
    const dialog = screen.getByRole("dialog", { name: "An agent wants to run code" });
    expect(dialog.textContent).toContain(HASH.slice(0, 16));
    expect(dialog.textContent).toMatch(/for this code/i);
  });

  it("offers only to run it once when the code is in no deck: nothing is kept for it", () => {
    useGeneratorAsk.getState().push({ ...ASK, deck: "" });
    render(<AllowDialog />);
    expect(screen.queryByRole("button", { name: "Allow to run" })).toBeNull();
    expect(screen.getByRole("button", { name: "Run once" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Do not run" })).toBeTruthy();
  });

  it("runs it once without keeping anything, or does not run it", async () => {
    useGeneratorAsk.getState().push(ASK);
    const view = render(<AllowDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Run once" }));
    await waitFor(() => expect(useGeneratorAsk.getState().queue).toEqual([]));
    expect(backend.allowGenerator).not.toHaveBeenCalled();
    expect(backend.answerApp).toHaveBeenLastCalledWith("ask-1", { text: "allow" });
    view.unmount();

    useGeneratorAsk.getState().push({ ...ASK, id: "ask-3" });
    render(<AllowDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Do not run" }));
    await waitFor(() => expect(useGeneratorAsk.getState().queue).toEqual([]));
    expect(backend.answerApp).toHaveBeenLastCalledWith("ask-3", { text: "deny" });
    expect(backend.allowGenerator).not.toHaveBeenCalled();
  });

  it("keeps the code from running, and says why, when the choice could not be kept", async () => {
    backend.allowGenerator.mockRejectedValueOnce(new Error("KastenFlow has no place to keep this choice."));
    expect(await decide(ASK, "always")).toBe("KastenFlow has no place to keep this choice.");
    expect(backend.answerApp).toHaveBeenCalledWith("ask-1", { text: "deny" });
    expect(await decide(ASK, "once")).toBeNull();
  });

  it("treats leaving the question as a no, and asks one question after another", async () => {
    useGeneratorAsk.getState().push(ASK);
    useGeneratorAsk.getState().push({ ...ASK, id: "ask-2", deck: "library/other.deck" });
    useGeneratorAsk.getState().push(ASK);
    expect(useGeneratorAsk.getState().queue.map((q) => q.id)).toEqual(["ask-1", "ask-2"]);
    render(<AllowDialog />);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(backend.answerApp).toHaveBeenCalledWith("ask-1", { text: "deny" }));
    await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("library/other.deck"));
  });
});

describe("what the app asks of the window for code", () => {
  it("is heard for as long as the window is there: code to run, and the question for the person", async () => {
    const handlers = new Map<string, (event: { payload: unknown }) => void>();
    vi.mocked(listen).mockImplementation((async (name: string, handler: (event: { payload: unknown }) => void) => {
      handlers.set(name, handler);
      return () => handlers.delete(name);
    }) as never);
    const view = renderHook(() => useRunGeneratorsForAgents());
    await waitFor(() => expect(handlers.has(RUN_EVENT) && handlers.has(ASK_EVENT)).toBe(true));
    handlers.get(ASK_EVENT)!({ payload: ASK });
    expect(useGeneratorAsk.getState().queue).toEqual([ASK]);
    view.unmount();
    expect(handlers.size).toBe(0);
  });
});

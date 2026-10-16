// The model picker and the generation settings beside it: a list of what the
// provider offers that filters as you type (and still takes any name), the
// Advanced popover showing only what the model takes, what is sent with a
// message, and the ways on from a failed answer.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../actions")>()),
  openProviders: vi.fn(),
}));

import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { openProviders } from "../actions";
import type { ModelCapabilities } from "../capabilities";
import { learnedEffort } from "../prefs";
import { useChat } from "../store";
import { CLAUDE, LOCAL, resetChat, scriptedChat, type Scripted } from "../test-kit";
import type { ChatProvider } from "../types";
import { Conversation } from "./Conversation";

const PLAN: ChatProvider = { name: "ChatGPT", kind: "chatgpt", baseUrl: "", model: "gpt-6.1-sol", hasKey: true, confirmed: true };

const none: ModelCapabilities = {
  version: 1,
  route: { kind: "chatCompletions", official: false },
  model: "m",
  family: "x",
  verified: true,
  reasoningEffort: null,
  thinking: null,
  temperature: null,
  maxOutput: null,
  effortRefused: false,
};
const plan: ModelCapabilities = { ...none, route: { kind: "chatGptResponses" }, family: "gpt-6", verified: false, reasoningEffort: ["low", "medium", "high"] };
const local: ModelCapabilities = { ...none, temperature: { min: 0, max: 2 }, maxOutput: { min: 256, max: 131072 } };
const claude: ModelCapabilities = {
  ...none,
  route: { kind: "anthropicMessages" },
  thinking: { min: 1024, max: 31999, default: 8000 },
  temperature: { min: 0, max: 1 },
  maxOutput: { min: 256, max: 32000 },
};

let chat: Scripted;

async function show(providers: ChatProvider[], caps: ModelCapabilities | null) {
  chat = scriptedChat(providers);
  chat.capabilities = caps;
  resetChat(chat);
  await useWorkspace.getState().connect({ client: new MemoryVault({}) });
  await useChat.getState().loadProviders();
  const id = useChat.getState().start({ open: true });
  render(<Conversation id={id} variant="full" page={null} />);
  return { id, box: screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement };
}

const send = async (box: HTMLElement, text: string) => {
  fireEvent.change(box, { target: { value: text } });
  await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
};

const openPicker = async (label: string) => {
  await act(async () => fireEvent.click(screen.getByRole("button", { name: label })));
  return screen.getByRole("dialog", { name: "Provider and model" });
};

const openSettings = async () => {
  // Found outside `act`: waiting for it is what lets the capabilities arrive.
  const button = await screen.findByRole("button", { name: "Generation settings" });
  await act(async () => fireEvent.click(button));
  return screen.getByRole("dialog", { name: "Generation settings" });
};

beforeEach(() => {
  localStorage.clear();
  vi.mocked(openProviders).mockClear();
});
afterEach(cleanup);

describe("the model list", () => {
  it("lists what the saved provider offers, asked without a typed key", async () => {
    await show([CLAUDE, LOCAL], null);
    const menu = await openPicker("Model: Claude, model-small");
    expect((await within(menu).findAllByRole("option")).map((o) => o.textContent)).toEqual(["model-large", "model-small"]);
    expect(chat.drafts).toEqual([{ provider: { name: "Claude", kind: "anthropic", baseUrl: "https://api.anthropic.com", model: "model-small" }, key: null }]);
    // The one in use is marked.
    expect(within(menu).getByRole("option", { name: "model-small" }).getAttribute("aria-selected")).toBe("true");
  });

  it("filters as you type and picks one with a click", async () => {
    const { box } = await show([CLAUDE], null);
    const menu = await openPicker("Model: Claude, model-small");
    await within(menu).findAllByRole("option");
    fireEvent.change(within(menu).getByRole("textbox", { name: "Model" }), { target: { value: "LARGE" } });
    expect(within(menu).getAllByRole("option").map((o) => o.textContent)).toEqual(["model-large"]);
    await act(async () => fireEvent.click(within(menu).getByRole("option", { name: "model-large" })));
    // Chosen, and the menu is closed.
    expect(screen.queryByRole("dialog", { name: "Provider and model" })).toBeNull();
    expect(screen.getByRole("button", { name: "Model: Claude, model-large" })).toBeTruthy();
    await send(box, "Hello");
    expect(chat.requests[0]).toMatchObject({ provider: "Claude", model: "model-large" });
  });

  it("walks the list with the arrow keys and takes a typed name that is not in it", async () => {
    await show([CLAUDE], null);
    let menu = await openPicker("Model: Claude, model-small");
    await within(menu).findAllByRole("option");
    const field = within(menu).getByRole("textbox", { name: "Model" });
    fireEvent.keyDown(field, { key: "ArrowDown" });
    fireEvent.keyDown(field, { key: "ArrowDown" });
    fireEvent.keyDown(field, { key: "ArrowUp" });
    expect(within(menu).getAllByRole("option")[0]!.hasAttribute("data-active")).toBe(true);
    await act(async () => fireEvent.keyDown(field, { key: "Enter" }));
    expect(screen.getByRole("button", { name: "Model: Claude, model-large" })).toBeTruthy();

    // A name the list leaves out still works: Enter takes what was typed.
    menu = await openPicker("Model: Claude, model-large");
    await within(menu).findAllByRole("option");
    const typed = within(menu).getByRole("textbox", { name: "Model" });
    fireEvent.change(typed, { target: { value: "claude-private-9" } });
    expect(within(menu).queryAllByRole("option")).toHaveLength(0);
    expect(within(menu).getByText(/No listed model matches/)).toBeTruthy();
    await act(async () => fireEvent.keyDown(typed, { key: "Enter" }));
    expect(screen.getByRole("button", { name: "Model: Claude, claude-private-9" })).toBeTruthy();
  });

  it("says when the list could not be read, and typing still works", async () => {
    await show([CLAUDE], null);
    chat.failNext("The server is down");
    const menu = await openPicker("Model: Claude, model-small");
    expect(await within(menu).findByText(/The model list could not be read \(The server is down\)/)).toBeTruthy();
    expect(within(menu).queryAllByRole("option")).toHaveLength(0);
    const field = within(menu).getByRole("textbox", { name: "Model" });
    fireEvent.change(field, { target: { value: "by-hand" } });
    await act(async () => fireEvent.keyDown(field, { key: "Enter" }));
    expect(screen.getByRole("button", { name: "Model: Claude, by-hand" })).toBeTruthy();
  });
});

describe("the Advanced popover", () => {
  it("shows the ChatGPT plan an effort to try and no temperature, and sends the choice", async () => {
    const { id, box } = await show([PLAN], plan);
    const popover = await openSettings();
    expect(within(popover).getByRole("radiogroup", { name: "Reasoning effort" })).toBeTruthy();
    expect(within(popover).queryByRole("spinbutton", { name: "Temperature" })).toBeNull();
    expect(within(popover).queryByRole("spinbutton", { name: /Longest answer/ })).toBeNull();
    expect(within(popover).queryByText("Extended thinking")).toBeNull();
    expect(popover.textContent).toContain("Tried the first time you use it");
    await act(async () => fireEvent.click(within(popover).getByRole("radio", { name: "High" })));
    expect(useChat.getState().threads[id]!.settings).toEqual({ reasoningEffort: "high" });
    await send(box, "Think hard");
    expect(chat.requests[0]!.settings).toEqual({ reasoningEffort: "high" });
  });

  it("learns that a model refused its effort, and stops offering it", async () => {
    const { id, box } = await show([PLAN], plan);
    const popover = await openSettings();
    await act(async () => fireEvent.click(within(popover).getByRole("radio", { name: "Low" })));
    await send(box, "Hello");
    expect(chat.requests[0]!.settings).toEqual({ reasoningEffort: "low" });
    // The backend sent it again without, and now says so.
    chat.capabilities = { ...plan, effortRefused: true };
    act(() => chat.emit({ chat: id, turn: "turn-1", kind: "notice", text: "This model doesn't take a reasoning effort; sent without it." }));
    act(() => chat.emit({ chat: id, turn: "turn-1", kind: "done" }));
    await waitFor(() => expect(learnedEffort("ChatGPT", "gpt-6.1-sol")).toBe("refused"));
    expect(screen.getByText("This model doesn't take a reasoning effort; sent without it.")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Generation settings" })).toBeNull());
    // And it is not sent again, whatever was set.
    await send(screen.getByRole("textbox", { name: "Message" }), "Again");
    expect(chat.requests[1]!.settings).toBeUndefined();
  });

  it("remembers that an effort worked", async () => {
    const { id, box } = await show([PLAN], plan);
    const popover = await openSettings();
    await act(async () => fireEvent.click(within(popover).getByRole("radio", { name: "Medium" })));
    await send(box, "Hello");
    act(() => chat.emit({ chat: id, turn: "turn-1", kind: "done" }));
    await waitFor(() => expect(learnedEffort("ChatGPT", "gpt-6.1-sol")).toBe("works"));
  });

  it("offers a local server a temperature and a longest answer, held to their ranges, and remembers them for the model", async () => {
    const { box } = await show([LOCAL], local);
    const popover = await openSettings();
    expect(within(popover).queryByRole("radiogroup", { name: "Reasoning effort" })).toBeNull();
    const temperature = within(popover).getByRole("spinbutton", { name: "Temperature" }) as HTMLInputElement;
    fireEvent.change(temperature, { target: { value: "9" } });
    fireEvent.blur(temperature);
    expect(temperature.value).toBe("2");
    const longest = within(popover).getByRole("spinbutton", { name: "Longest answer (tokens)" }) as HTMLInputElement;
    fireEvent.change(longest, { target: { value: "1000" } });
    fireEvent.keyDown(longest, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Generation settings" }).getAttribute("title")).toContain("temperature 2");
    await send(box, "Write");
    expect(chat.requests[0]!.settings).toEqual({ temperature: 2, maxOutputTokens: 1000 });

    // A new chat with the same model starts from them.
    cleanup();
    const again = useChat.getState().start({ open: true });
    render(<Conversation id={again} variant="full" page={null} />);
    await send(screen.getByRole("textbox", { name: "Message" }), "Again");
    expect(chat.requests[1]!.settings).toEqual({ temperature: 2, maxOutputTokens: 1000 });
  });

  it("clears the settings with the defaults button", async () => {
    const { id, box } = await show([LOCAL], local);
    const popover = await openSettings();
    const temperature = within(popover).getByRole("spinbutton", { name: "Temperature" });
    fireEvent.change(temperature, { target: { value: "0.5" } });
    fireEvent.blur(temperature);
    await act(async () => fireEvent.click(within(popover).getByRole("button", { name: "Use the defaults" })));
    expect(useChat.getState().threads[id]!.settings).toEqual({});
    await send(box, "Hello");
    expect(chat.requests[0]!.settings).toBeUndefined();
  });

  it("takes the temperature away while Claude thinks, and sends the budget alone", async () => {
    const { box } = await show([CLAUDE], claude);
    const popover = await openSettings();
    const temperature = within(popover).getByRole("spinbutton", { name: "Temperature" });
    fireEvent.change(temperature, { target: { value: "0.4" } });
    fireEvent.blur(temperature);
    await act(async () => fireEvent.click(within(popover).getByRole("checkbox", { name: "Extended thinking" })));
    // Thinking on: the temperature is gone from the controls and the settings.
    expect(within(popover).queryByRole("spinbutton", { name: "Temperature" })).toBeNull();
    expect((within(popover).getByRole("spinbutton", { name: "Thinking budget (tokens)" }) as HTMLInputElement).value).toBe("8000");
    expect(popover.textContent).toContain("takes no temperature while it thinks");
    await send(box, "Plan it");
    expect(chat.requests[0]!.settings).toEqual({ thinkingBudget: 8000 });
  });

  it("is not there for a model nothing is known about", async () => {
    await show([LOCAL], null);
    await openPicker("Model: Local server, local-model");
    expect(screen.queryByRole("button", { name: "Generation settings" })).toBeNull();
  });

  it("leaves out settings the model does not take, such as ones kept from another", async () => {
    const { id, box } = await show([LOCAL], local);
    // A local server takes a temperature, not a reasoning effort.
    useChat.getState().setSettings(id, { temperature: 0.9, reasoningEffort: "high" });
    await send(box, "Hello");
    expect(chat.requests[0]!.settings).toEqual({ temperature: 0.9 });
  });

  it("sends no settings to a model the backend cannot say anything about", async () => {
    const { id, box } = await show([LOCAL], null);
    useChat.getState().setSettings(id, { temperature: 0.9 });
    await send(box, "Hello");
    expect(chat.requests[0]!.settings).toBeUndefined();
    expect(chat.capabilityAsks).toContain("Local server|local-model");
  });

  it("changing the model starts from what was last used with that one", async () => {
    const { id } = await show([CLAUDE, LOCAL], local);
    useChat.getState().setSettings(id, { temperature: 0.3 });
    expect(useChat.getState().threads[id]!.settings).toEqual({ temperature: 0.3 });
    useChat.getState().choose(id, "Local server", "other-model");
    expect(useChat.getState().threads[id]!.settings).toBeUndefined();
  });
});

describe("a failed answer", () => {
  const fail = async (kind: string | undefined, providers = [CLAUDE]) => {
    const shown = await show(providers, null);
    await send(shown.box, "Do it");
    act(() => chat.emit({ chat: shown.id, turn: "turn-1", kind: "error", error: "It went wrong", ...(kind ? { errorKind: kind as never } : {}) }));
    return shown;
  };

  it("offers Retry after a connection failure, and asks the question again in its place", async () => {
    await fail("connection");
    expect(screen.getByRole("alert").textContent).toBe("It went wrong");
    expect(screen.getByRole("button", { name: "Open Settings" })).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry" })));
    expect(chat.requests.map((r) => r.text)).toEqual(["Do it", "Do it"]);
    // The failed pair was replaced, not stood beside the new one.
    const log = screen.getByRole("log");
    expect(within(log).getAllByText("Do it")).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("offers Retry for an error of no kind and for rate limits, but not for a refusal or a long chat", async () => {
    await fail(undefined);
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    cleanup();
    await fail("rateLimited");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    cleanup();
    await fail("refused");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    cleanup();
    await fail("tooLong");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open Settings" })).toBeNull();
  });

  it("offers Choose model when the model is not there, and opens the picker", async () => {
    await fail("modelUnavailable");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Choose model" })));
    expect(screen.getByRole("dialog", { name: "Provider and model" })).toBeTruthy();
  });

  it("offers Open Settings when the key or sign-in was refused", async () => {
    await fail("permission");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(openProviders).toHaveBeenCalledWith("here");
  });

  it("offers Retry only on the newest answer", async () => {
    const shown = await fail("connection");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry" })));
    act(() => chat.emit({ chat: shown.id, turn: "turn-2", kind: "text", text: "Here you go." }));
    act(() => chat.emit({ chat: shown.id, turn: "turn-2", kind: "done" }));
    await send(screen.getByRole("textbox", { name: "Message" }), "Next");
    act(() => chat.emit({ chat: shown.id, turn: "turn-3", kind: "error", error: "Again", errorKind: "connection" }));
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
  });

  it("keeps the question when a half answer came before the failure", async () => {
    const shown = await show([CLAUDE], null);
    await send(shown.box, "Do it");
    act(() => chat.emit({ chat: shown.id, turn: "turn-1", kind: "text", text: "Half an answer" }));
    act(() => chat.emit({ chat: shown.id, turn: "turn-1", kind: "error", error: "Dropped", errorKind: "connection" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry" })));
    const log = screen.getByRole("log");
    expect(within(log).getAllByText("Do it")).toHaveLength(2);
    expect(within(log).getByText("Half an answer")).toBeTruthy();
  });
});

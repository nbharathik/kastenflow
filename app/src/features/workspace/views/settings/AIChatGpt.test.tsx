import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// What the desktop app would answer; the browser preview answers nothing.
let desktop = true;
let ended: ((end: import("../../../chat/chatgpt").ChatGptSignInEnd) => void) | null = null;
vi.mock("../../../chat/chatgpt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../chat/chatgpt")>()),
  canSignInWithChatGpt: () => desktop,
  chatgptAccount: vi.fn(async () => ({ signedIn: false, email: null, remembered: true })),
  chatgptSignInStart: vi.fn(async () => ({ url: "https://auth.openai.com/api/accounts/authorize?x=1" })),
  chatgptSignInCancel: vi.fn(async () => {}),
  chatgptSignOut: vi.fn(async () => ({ revoked: true })),
  onChatGptSignIn: (then: (end: import("../../../chat/chatgpt").ChatGptSignInEnd) => void) => {
    ended = then;
    return () => (ended = null);
  },
}));
vi.mock("../../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/api")>()),
  openUrl: vi.fn(async () => {}),
}));

import { openUrl } from "../../../../lib/api";
import * as chatgpt from "../../../chat/chatgpt";
import { CLAUDE, resetChat, scriptedChat, type Scripted } from "../../../chat/test-kit";
import { useWorkspace } from "../../store";
import { AIProviders } from "./AIProviders";

let chat: Scripted;
const toast = vi.fn();

async function show() {
  render(<AIProviders />);
  return screen.findByRole("region", { name: "AI providers" });
}

const signedIn = { signedIn: true, email: "ada@example.com", remembered: true };

beforeEach(() => {
  localStorage.clear();
  desktop = true;
  chat = scriptedChat([CLAUDE]);
  resetChat(chat);
  useWorkspace.setState({ toast });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.mocked(chatgpt.chatgptAccount).mockResolvedValue({ signedIn: false, email: null, remembered: true });
});

describe("Settings → AI providers → Continue with ChatGPT", () => {
  it("is switched off in the browser preview, saying what it needs", async () => {
    desktop = false;
    const section = await show();
    const button = within(section).getByRole("button", { name: "Continue with ChatGPT" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(within(section).getByText("Needs the desktop app")).toBeTruthy();
    expect(chatgpt.chatgptAccount).not.toHaveBeenCalled();
  });

  it("says what it costs, what is left out and where notes go", async () => {
    const section = await show();
    await within(section).findByRole("button", { name: "Continue with ChatGPT" });
    // The explanation is behind the row's ?, not in the row.
    expect(section.textContent).not.toContain("count against your ChatGPT plan");
    fireEvent.click(within(section).getByRole("button", { name: "About Use your ChatGPT plan" }));
    const text = section.textContent ?? "";
    expect(text).toContain("count against your ChatGPT plan");
    expect(text).toContain("ChatGPT → Settings → Usage");
    expect(text).toContain("Image generation and some tools are not available");
    expect(text).toContain("Your notes go to OpenAI only while this provider is the one chosen");
    // No logo asset: plain text on a button.
    expect(section.querySelector("img, svg[aria-label*='ChatGPT']")).toBeNull();
  });

  it("opens ChatGPT in the system browser, waits, and adds the provider once signed in", async () => {
    const section = await show();
    fireEvent.click(await within(section).findByRole("button", { name: "Continue with ChatGPT" }));
    expect(await within(section).findByText("Waiting for ChatGPT")).toBeTruthy();
    expect(chatgpt.chatgptSignInStart).toHaveBeenCalledWith(false);
    // The page can be opened again, in the system browser, not the app.
    fireEvent.click(within(section).getByRole("button", { name: "Open the page again" }));
    expect(openUrl).toHaveBeenCalledWith("https://auth.openai.com/api/accounts/authorize?x=1");

    vi.mocked(chatgpt.chatgptAccount).mockResolvedValue(signedIn);
    await act(async () => ended?.({ state: "signed", email: "ada@example.com", remembered: true }));
    expect(await within(section).findByText(/Signed in as ada@example\.com/)).toBeTruthy();
    expect(toast).toHaveBeenCalledWith("Signed in with ChatGPT as ada@example.com. You're using your ChatGPT plan; manage usage in ChatGPT → Settings → Usage.");
    // The provider has no key and no address; its model is the account's first.
    await waitFor(() => expect(chat.saved).toHaveLength(1));
    expect(chat.saved[0]).toEqual({ provider: { name: "ChatGPT", kind: "chatgpt", baseUrl: "", model: "model-large" }, key: null });
    expect(chat.drafts[0]?.provider.kind).toBe("chatgpt");
    expect(await within(section).findByText(/ChatGPT plan · model-large/)).toBeTruthy();
    expect(within(section).getByRole("button", { name: "Manage usage" })).toBeTruthy();
    expect(within(section).queryByRole("button", { name: "Add ChatGPT" })).toBeNull();
    expect(within(section).queryByRole("button", { name: "Confirm ChatGPT" })).toBeNull();
  });

  it("stops waiting when cancelled", async () => {
    const section = await show();
    fireEvent.click(await within(section).findByRole("button", { name: "Continue with ChatGPT" }));
    fireEvent.click(await within(section).findByRole("button", { name: "Cancel" }));
    expect(chatgpt.chatgptSignInCancel).toHaveBeenCalled();
    expect(within(section).getByRole("button", { name: "Continue with ChatGPT" })).toBeTruthy();
  });

  it("says why a sign-in did not finish, and offers a fixed port when the address may be the trouble", async () => {
    const section = await show();
    fireEvent.click(await within(section).findByRole("button", { name: "Continue with ChatGPT" }));
    await within(section).findByText("Waiting for ChatGPT");
    await act(async () => ended?.({ state: "failed", message: "ChatGPT sent the browser back with an error (server_error). Try again" }));
    expect(within(section).getByRole("alert").textContent).toContain("server_error");
    fireEvent.click(within(section).getByRole("button", { name: "Try a fixed port" }));
    await within(section).findByText("Waiting for ChatGPT");
    expect(chatgpt.chatgptSignInStart).toHaveBeenLastCalledWith(true);

    // Saying no is not a fault to retry with another port.
    await act(async () => ended?.({ state: "denied" }));
    expect(within(section).getByRole("alert").textContent).toContain("cancelled");
    expect(within(section).queryByRole("button", { name: "Try a fixed port" })).toBeNull();
    expect(within(section).getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(chat.saved).toEqual([]);
  });

  it("shows who is signed in and signs out", async () => {
    vi.mocked(chatgpt.chatgptAccount).mockResolvedValue(signedIn);
    const section = await show();
    expect(await within(section).findByText(/Signed in as ada@example\.com/)).toBeTruthy();
    fireEvent.click(within(section).getByRole("button", { name: "Manage usage" }));
    expect(openUrl).toHaveBeenCalledWith("https://chatgpt.com/settings/usage");

    vi.mocked(chatgpt.chatgptAccount).mockResolvedValue({ signedIn: false, email: null, remembered: true });
    await act(async () => fireEvent.click(within(section).getByRole("button", { name: "Sign out" })));
    expect(chatgpt.chatgptSignOut).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Signed out of ChatGPT");
    expect(await within(section).findByRole("button", { name: "Continue with ChatGPT" })).toBeTruthy();
  });

  it("says when OpenAI could not be told, and when the keychain would not keep the sign-in", async () => {
    vi.mocked(chatgpt.chatgptAccount).mockResolvedValue({ ...signedIn, remembered: false });
    vi.mocked(chatgpt.chatgptSignOut).mockResolvedValueOnce({ revoked: false });
    const section = await show();
    expect(await within(section).findByText(/lasts until KastenFlow quits/)).toBeTruthy();
    await act(async () => fireEvent.click(within(section).getByRole("button", { name: "Sign out" })));
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("remove it in ChatGPT"));
  });

  it("offers to add ChatGPT to a vault that has none while signed in", async () => {
    vi.mocked(chatgpt.chatgptAccount).mockResolvedValue(signedIn);
    const section = await show();
    await act(async () => fireEvent.click(await within(section).findByRole("button", { name: "Add ChatGPT" })));
    await waitFor(() => expect(chat.saved).toHaveLength(1));
    expect(chat.saved[0]?.provider.kind).toBe("chatgpt");
  });

  it("changes only the model of a ChatGPT provider, from the account's list", async () => {
    chat = scriptedChat([CLAUDE, { name: "ChatGPT", kind: "chatgpt", baseUrl: "", model: "model-large", hasKey: true, confirmed: true }]);
    chat.models = ["model-large", "model-small"];
    resetChat(chat);
    vi.mocked(chatgpt.chatgptAccount).mockResolvedValue(signedIn);
    const section = await show();
    expect(await within(section).findByText("ChatGPT plan · model-large · Signed in with ChatGPT")).toBeTruthy();
    fireEvent.click(within(section).getByRole("button", { name: "Change ChatGPT" }));
    const form = within(section).getByRole("form", { name: "Change ChatGPT" });
    expect(within(form).queryByLabelText("API key")).toBeNull();
    expect(within(form).queryByRole("textbox", { name: "Base URL" })).toBeNull();
    await act(async () => fireEvent.click(within(form).getByRole("button", { name: "List models" })));
    expect(chat.drafts.at(-1)).toEqual({ provider: { name: "ChatGPT", kind: "chatgpt", baseUrl: "", model: "model-large" }, key: null });
    fireEvent.click(within(form).getByRole("option", { name: "model-small" }));
    await act(async () => fireEvent.submit(form));
    expect(chat.saved.at(-1)).toEqual({ provider: { name: "ChatGPT", kind: "chatgpt", baseUrl: "", model: "model-small" }, key: null });
  });

  it("removes a ChatGPT provider without signing out, and says so", async () => {
    chat = scriptedChat([{ name: "ChatGPT", kind: "chatgpt", baseUrl: "", model: "model-large", hasKey: true, confirmed: true }]);
    resetChat(chat);
    vi.mocked(chatgpt.chatgptAccount).mockResolvedValue(signedIn);
    const section = await show();
    fireEvent.click(await within(section).findByRole("button", { name: "Remove ChatGPT" }));
    const ask = within(section).getByRole("alertdialog", { name: "Remove ChatGPT?" });
    expect(ask.textContent).toContain("You stay signed in with ChatGPT until you sign out");
    expect(ask.textContent).not.toContain("key is deleted");
    await act(async () => fireEvent.click(within(ask).getByRole("button", { name: "Remove" })));
    expect(chatgpt.chatgptSignOut).not.toHaveBeenCalled();
    expect(await within(section).findByRole("button", { name: "Add ChatGPT" })).toBeTruthy();
  });
});

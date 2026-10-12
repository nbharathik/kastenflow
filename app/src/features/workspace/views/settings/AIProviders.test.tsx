import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetChat, scriptedChat, LOCAL, type Scripted } from "../../../chat/test-kit";
import { AIProviders } from "./AIProviders";

const SECRET = "sk-ant-secret-0123456789";

let chat: Scripted;

async function show() {
  render(<AIProviders />);
  return screen.findByRole("region", { name: "AI providers" });
}

const field = (form: HTMLElement, name: string) => within(form).getByRole("textbox", { name }) as HTMLInputElement;
const keyField = (form: HTMLElement) => within(form).getByLabelText("API key") as HTMLInputElement;

beforeEach(() => {
  localStorage.clear();
  chat = scriptedChat([{ ...LOCAL, hasKey: true }]);
  resetChat(chat);
});
afterEach(cleanup);

describe("Settings → AI providers", () => {
  it("asks before notes go to an address the vault's settings name", async () => {
    chat = scriptedChat([{ ...LOCAL, hasKey: true, confirmed: false }]);
    resetChat(chat);
    const section = await show();
    expect(await within(section).findByText(/Nothing goes to http:\/\/local-server:8000\/v1 from this computer until you confirm it/)).toBeTruthy();
    await act(async () => fireEvent.click(within(section).getByRole("button", { name: "Confirm Local server" })));
    expect(section.textContent).not.toContain("until you confirm it");
    expect(within(section).queryByRole("button", { name: "Confirm Local server" })).toBeNull();
  });

  it("adds a provider, sending its key once and never showing it", async () => {
    const section = await show();
    expect(await within(section).findByText("Local server")).toBeTruthy();
    expect(section.textContent).toContain("OpenAI-compatible · local-model · Key in your system keychain");
    // The address is behind the row's ?.
    fireEvent.click(within(section).getByRole("button", { name: "About Local server" }));
    expect(within(section).getByRole("status").textContent).toBe("Address: http://local-server:8000/v1");
    fireEvent.click(within(section).getByRole("button", { name: "About Local server" }));

    fireEvent.click(within(section).getByRole("button", { name: "Add a provider" }));
    const form = within(section).getByRole("form", { name: "New AI provider" });
    expect(field(form, "Base URL").value).toBe("https://api.anthropic.com");
    expect(within(form).getByText(/No key stored for this address\. Make one at console\.anthropic\.com, under API keys\./)).toBeTruthy();
    fireEvent.change(field(form, "Name"), { target: { value: "local server" } });
    expect(within(form).getByText("Another provider has this name")).toBeTruthy();
    fireEvent.change(field(form, "Name"), { target: { value: "Claude" } });
    fireEvent.change(field(form, "Model"), { target: { value: "model-small" } });
    fireEvent.change(keyField(form), { target: { value: SECRET } });
    expect(keyField(form).type).toBe("password");
    await act(async () => fireEvent.submit(form));

    expect(chat.saved).toEqual([{ provider: { name: "Claude", kind: "anthropic", baseUrl: "https://api.anthropic.com", model: "model-small" }, key: SECRET }]);
    expect(within(section).queryByRole("form")).toBeNull();
    expect(section.textContent).toContain("Anthropic · model-small · Key in your system keychain");
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  it("keeps the stored key unless one is typed, and removes it on request", async () => {
    const section = await show();
    fireEvent.click(await within(section).findByRole("button", { name: "Change Local server" }));
    const form = within(section).getByRole("form", { name: "Change Local server" });
    expect(keyField(form).value).toBe("");
    expect(within(form).getByText(/Stored in your system keychain for this address\. Leave this empty to keep it\./)).toBeTruthy();
    expect(within(form).getByText(/only sent to the address it was saved for/)).toBeTruthy();
    expect(field(form, "Name").readOnly).toBe(true);
    fireEvent.change(field(form, "Model"), { target: { value: "local-model" } });
    await act(async () => fireEvent.submit(form));
    // An empty key field keeps the stored key: null.
    expect(chat.saved.at(-1)).toEqual({ provider: { name: "Local server", kind: "openai", baseUrl: "http://local-server:8000/v1", model: "local-model" }, key: null });

    fireEvent.click(within(section).getByRole("button", { name: "Change Local server" }));
    const again = within(section).getByRole("form", { name: "Change Local server" });
    await act(async () => fireEvent.click(within(again).getByRole("button", { name: "Remove key" })));
    // Remove key sends "".
    expect(chat.saved.at(-1)).toEqual({ provider: { name: "Local server", kind: "openai", baseUrl: "http://local-server:8000/v1", model: "local-model" }, key: "" });
    expect(within(again).getByText(/No key stored for this address\. A local server may need none\./)).toBeTruthy();
    expect(within(again).queryByRole("button", { name: "Remove key" })).toBeNull();
  });

  it("starts from a service that fills in the kind, address and name", async () => {
    const section = await show();
    fireEvent.click(await within(section).findByRole("button", { name: "Add a provider" }));
    const form = within(section).getByRole("form", { name: "New AI provider" });
    const services = within(form).getByRole("radiogroup", { name: "Service" });
    expect((within(services).getByRole("radio", { name: "Anthropic" }) as HTMLInputElement).checked).toBe(true);
    expect(field(form, "Name").value).toBe("Anthropic");
    expect(within(form).queryByRole("radiogroup", { name: "Kind" })).toBeNull();

    fireEvent.click(within(services).getByRole("radio", { name: "Ollama" }));
    expect(field(form, "Base URL").value).toBe("http://localhost:11434/v1");
    expect(field(form, "Name").value).toBe("Ollama");
    expect(within(form).getByText(/Ollama on this computer needs no key\./)).toBeTruthy();
    fireEvent.click(within(services).getByRole("radio", { name: "OpenRouter" }));
    expect(field(form, "Base URL").value).toBe("https://openrouter.ai/api/v1");
    fireEvent.change(field(form, "Model"), { target: { value: "some/model" } });
    await act(async () => fireEvent.submit(form));
    expect(chat.saved.at(-1)).toEqual({ provider: { name: "OpenRouter", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", model: "some/model" }, key: null });
  });

  it("keeps a name you typed, and an address you typed makes it Custom", async () => {
    const section = await show();
    fireEvent.click(await within(section).findByRole("button", { name: "Add a provider" }));
    const form = within(section).getByRole("form", { name: "New AI provider" });
    const services = within(form).getByRole("radiogroup", { name: "Service" });
    fireEvent.change(field(form, "Name"), { target: { value: "Work" } });
    fireEvent.click(within(services).getByRole("radio", { name: "LM Studio" }));
    expect(field(form, "Name").value).toBe("Work");
    expect(field(form, "Base URL").value).toBe("http://localhost:1234/v1");

    fireEvent.change(field(form, "Base URL"), { target: { value: "http://localhost:9000/v1" } });
    expect((within(services).getByRole("radio", { name: "Custom" }) as HTMLInputElement).checked).toBe(true);
    const kinds = within(form).getByRole("radiogroup", { name: "Kind" });
    fireEvent.click(within(kinds).getByRole("radio", { name: "Anthropic" }));
    expect(field(form, "Base URL").value).toBe("http://localhost:9000/v1");
    fireEvent.change(field(form, "Base URL"), { target: { value: "localhost:8000" } });
    fireEvent.change(field(form, "Model"), { target: { value: "local-model" } });
    expect(within(form).getByText("The base URL starts with http:// or https://")).toBeTruthy();
    expect((within(form).getByRole("button", { name: "Add provider" }) as HTMLButtonElement).disabled).toBe(true);

    // Custom from a service's own address starts empty, for your server.
    fireEvent.click(within(services).getByRole("radio", { name: "OpenAI" }));
    fireEvent.click(within(services).getByRole("radio", { name: "Custom" }));
    expect(field(form, "Base URL").value).toBe("");
    expect(field(form, "Base URL").placeholder).toBe("http://local-server:8000/v1");
  });

  it("shows the service a provider was set up from when changing it", async () => {
    chat = scriptedChat([{ ...LOCAL, name: "Ollama", baseUrl: "http://localhost:11434/v1/" }]);
    resetChat(chat);
    const section = await show();
    fireEvent.click(await within(section).findByRole("button", { name: "Change Ollama" }));
    const form = within(section).getByRole("form", { name: "Change Ollama" });
    expect((within(form).getByRole("radio", { name: "Ollama" }) as HTMLInputElement).checked).toBe(true);
    expect(document.activeElement).toBe(field(form, "Model"));
  });

  it("lists the provider's models to pick from, keeping free text", async () => {
    chat.models = ["model-large", "model-small", "other-model"];
    const section = await show();
    fireEvent.click(await within(section).findByRole("button", { name: "Add a provider" }));
    const form = within(section).getByRole("form", { name: "New AI provider" });
    fireEvent.change(keyField(form), { target: { value: SECRET } });
    await act(async () => fireEvent.click(within(form).getByRole("button", { name: "List models" })));
    // The typed key goes with this request only.
    expect(chat.drafts.at(-1)).toEqual({ provider: { name: "Anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com", model: "" }, key: SECRET });
    const list = within(form).getByRole("listbox", { name: "Models" });
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["model-large", "model-small", "other-model"]);
    expect(within(form).getByText("3 models listed: pick one, or type a name.")).toBeTruthy();

    fireEvent.change(field(form, "Model"), { target: { value: "SMALL" } });
    expect(within(form).getAllByRole("option").map((o) => o.textContent)).toEqual(["model-small"]);
    fireEvent.click(within(form).getByRole("option", { name: "model-small" }));
    expect(field(form, "Model").value).toBe("model-small");
    expect(within(form).queryByRole("listbox")).toBeNull();

    // The arrows open the list and Enter picks; Escape closes only the list.
    fireEvent.change(field(form, "Model"), { target: { value: "" } });
    fireEvent.keyDown(field(form, "Model"), { key: "Escape" });
    expect(within(section).getByRole("form")).toBeTruthy();
    expect(within(form).queryByRole("listbox")).toBeNull();
    fireEvent.keyDown(field(form, "Model"), { key: "ArrowDown" });
    within(form).getAllByRole("option")[2]!.focus();
    fireEvent.keyDown(within(form).getByRole("listbox"), { key: "Enter" });
    expect(field(form, "Model").value).toBe("other-model");
    expect(document.body.textContent).not.toContain(SECRET);

    // Another address asks again.
    fireEvent.click(within(form).getByRole("radio", { name: "OpenAI" }));
    expect(within(form).getByRole("button", { name: "List models" })).toBeTruthy();
    expect(within(form).queryByText(/models listed/)).toBeNull();
  });

  it("says why the models could not be listed, leaving the name to type", async () => {
    const section = await show();
    fireEvent.click(await within(section).findByRole("button", { name: "Add a provider" }));
    const form = within(section).getByRole("form", { name: "New AI provider" });
    fireEvent.click(within(form).getByRole("radio", { name: "Ollama" }));
    chat.failNext("Could not reach Ollama at http://localhost:11434/v1/models. Is Ollama or LM Studio running? Start it, then try again.");
    await act(async () => fireEvent.click(within(form).getByRole("button", { name: "List models" })));
    expect(within(form).getByRole("alert").textContent).toContain("Is Ollama or LM Studio running?");
    expect(within(form).queryByRole("listbox")).toBeNull();
    fireEvent.change(field(form, "Model"), { target: { value: "local-model" } });
    expect(field(form, "Model").value).toBe("local-model");
  });

  it("tests the connection before saving, with the key typed", async () => {
    const section = await show();
    fireEvent.click(await within(section).findByRole("button", { name: "Add a provider" }));
    const form = within(section).getByRole("form", { name: "New AI provider" });
    const test = within(form).getByRole("button", { name: "Test connection" }) as HTMLButtonElement;
    expect(test.disabled).toBe(true);
    fireEvent.change(field(form, "Model"), { target: { value: "model-small" } });
    fireEvent.change(keyField(form), { target: { value: SECRET } });
    await act(async () => fireEvent.click(test));
    expect(chat.drafts.at(-1)).toEqual({ provider: { name: "Anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com", model: "model-small" }, key: SECRET });
    expect(within(form).getByRole("status").textContent).toBe("Anthropic answered in 1.2 s · “OK”");
    // Nothing is saved until you add it.
    expect(chat.saved).toEqual([]);
    // A result is for what was tested: another model clears it.
    fireEvent.change(field(form, "Model"), { target: { value: "model-large" } });
    expect(within(form).queryByRole("status")).toBeNull();

    chat.failNext("Anthropic answered 401: invalid x-api-key. Check the API key in Settings.");
    await act(async () => fireEvent.click(test));
    expect(within(form).getByRole("status").textContent).toContain("Check the API key");
    // The key stays in its own field, and nowhere else on the page.
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it("removes a provider after asking", async () => {
    const section = await show();
    fireEvent.click(await within(section).findByRole("button", { name: "Remove Local server" }));
    const ask = within(section).getByRole("alertdialog", { name: "Remove Local server?" });
    fireEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
    expect(within(section).getByText("Local server")).toBeTruthy();
    fireEvent.click(within(section).getByRole("button", { name: "Remove Local server" }));
    await act(async () => fireEvent.click(within(section).getByRole("button", { name: "Remove" })));
    expect(within(section).queryByText("Local server")).toBeNull();
    expect(within(section).getByText("No providers yet")).toBeTruthy();
  });

  it("tests a provider's connection and says how it went", async () => {
    const section = await show();
    await within(section).findByText("Local server");
    await act(async () => fireEvent.click(within(section).getByRole("button", { name: "Test Local server" })));
    expect((await within(section).findByRole("status")).textContent).toBe("Local server answered in 1.2 s · “OK”");
    chat.failNext("Local server answered 404: model not found. Check the base URL and the model's name.");
    await act(async () => fireEvent.click(within(section).getByRole("button", { name: "Test Local server" })));
    expect((await within(section).findByRole("status")).textContent).toContain("Check the base URL and the model's name.");
  });
});

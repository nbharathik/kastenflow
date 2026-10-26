// Settings → AI → Chat panel: selected text, what a page switch does, how many
// chats the list keeps and how many may work at once.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reloadPanelPrefs, usePanelPrefs } from "../../../chat/panel-prefs";
import { CLAUDE, resetChat, scriptedChat, type Scripted } from "../../../chat/test-kit";
import { useWorkspace } from "../../store";
import { ChatPanelSettings } from "./ChatPanelSettings";
import { ENTRIES } from "./entries";

let chat: Scripted;
const toast = vi.fn();

beforeEach(() => {
  localStorage.clear();
  reloadPanelPrefs();
  chat = scriptedChat([CLAUDE]);
  resetChat(chat);
  useWorkspace.setState({ toast });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const number = (name: string) => screen.getByRole("spinbutton", { name }) as HTMLInputElement;
const loaded = async (name: string) => {
  await waitFor(() => expect(number(name).disabled).toBe(false));
  return number(name);
};
const typeInto = (input: HTMLInputElement, value: string) => {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

describe("Chat panel", () => {
  it("is in the index with the four settings, searchable by plain words", () => {
    const ids = ENTRIES.filter((e) => e.card === "Chat panel").map((e) => e.id);
    expect(ids).toEqual(["ai.selectedText", "ai.onSwitch", "ai.assistantLinks", "ai.listSize", "ai.maxConcurrent"]);
    const words = (id: string) => `${ENTRIES.find((e) => e.id === id)!.words ?? ""} ${ENTRIES.find((e) => e.id === id)!.help ?? ""}`.toLowerCase();
    expect(words("ai.selectedText")).toContain("selection");
    expect(words("ai.onSwitch")).toContain("tabs");
    expect(words("ai.listSize")).toContain("archive");
    expect(words("ai.maxConcurrent")).toContain("waiting");
  });

  it("starts at the usual choices", async () => {
    render(<ChatPanelSettings />);
    expect((screen.getByRole("combobox", { name: "Selected text" }) as HTMLSelectElement).value).toBe("auto");
    expect((screen.getByRole("combobox", { name: "When I switch pages" }) as HTMLSelectElement).value).toBe("keep");
    expect((await loaded("Chats in the list")).value).toBe("30");
    expect(number("Agents working at once").value).toBe("3");
    expect(screen.queryByRole("img", { name: "Changed from the usual" })).toBeNull();
  });

  it("changes selected text and the page switch, keeps them, and goes back to the usual", () => {
    render(<ChatPanelSettings />);
    fireEvent.change(screen.getByRole("combobox", { name: "Selected text" }), { target: { value: "manual" } });
    fireEvent.change(screen.getByRole("combobox", { name: "When I switch pages" }), { target: { value: "bound" } });
    expect(usePanelPrefs.getState()).toMatchObject({ selectedText: "manual", onSwitch: "bound" });
    expect(JSON.parse(localStorage.getItem("kasten.chat.panel")!)).toEqual({ selectedText: "manual", onSwitch: "bound", assistantLinks: "beside" });
    expect(screen.getAllByRole("img", { name: "Changed from the usual" })).toHaveLength(2);
    // A new window reads them from storage.
    usePanelPrefs.setState({ selectedText: "auto", onSwitch: "keep" });
    reloadPanelPrefs();
    expect(usePanelPrefs.getState()).toMatchObject({ selectedText: "manual", onSwitch: "bound" });
    fireEvent.click(screen.getByRole("button", { name: "Reset Selected text" }));
    expect(usePanelPrefs.getState().selectedText).toBe("auto");
  });

  it("opens links from the assistant beside the deck unless told otherwise, and keeps the choice", () => {
    render(<ChatPanelSettings />);
    const links = () => screen.getByRole("combobox", { name: "Links from the assistant open" }) as HTMLSelectElement;
    expect(links().value).toBe("beside");
    expect([...links().options].map((o) => o.textContent)).toEqual(["Beside the deck", "In a new tab", "In the deck’s tab"]);
    fireEvent.change(links(), { target: { value: "tab" } });
    expect(usePanelPrefs.getState().assistantLinks).toBe("tab");
    usePanelPrefs.setState({ assistantLinks: "beside" });
    reloadPanelPrefs();
    expect(usePanelPrefs.getState().assistantLinks).toBe("tab");
    fireEvent.click(screen.getByRole("button", { name: "Reset Links from the assistant open" }));
    expect(usePanelPrefs.getState().assistantLinks).toBe("beside");
    localStorage.setItem("kasten.chat.panel", JSON.stringify({ assistantLinks: "far away" }));
    reloadPanelPrefs();
    expect(usePanelPrefs.getState().assistantLinks).toBe("beside");
  });

  it("offers the three choices in plain words", () => {
    render(<ChatPanelSettings />);
    const options = (name: string) => [...(screen.getByRole("combobox", { name }) as HTMLSelectElement).options].map((o) => o.textContent);
    expect(options("Selected text")).toEqual(["Add automatically", "Only with “Add to chat”", "Never"]);
    expect(options("When I switch pages")).toEqual(["Keep this chat and follow the page", "Use that page’s chat", "Start a new chat"]);
  });

  it("ignores a stored value it does not know", () => {
    localStorage.setItem("kasten.chat.panel", JSON.stringify({ selectedText: "always", onSwitch: 4 }));
    reloadPanelPrefs();
    expect(usePanelPrefs.getState()).toMatchObject({ selectedText: "auto", onSwitch: "keep" });
    localStorage.setItem("kasten.chat.panel", "{");
    reloadPanelPrefs();
    expect(usePanelPrefs.getState().onSwitch).toBe("keep");
  });

  it("saves the list size and the agents at once, held to the ranges the backend takes", async () => {
    chat.limitValues = { listSize: 60, maxConcurrent: 2 };
    render(<ChatPanelSettings />);
    expect((await loaded("Chats in the list")).value).toBe("60");
    typeInto(number("Chats in the list"), "5000");
    await waitFor(() => expect(chat.limitValues.listSize).toBe(200));
    typeInto(number("Agents working at once"), "0");
    await waitFor(() => expect(chat.limitValues.maxConcurrent).toBe(1));
    expect(toast).toHaveBeenCalledWith("Saved");
    expect(chat.limitValues).toEqual({ listSize: 200, maxConcurrent: 1 });
  });

  it("changes nothing for an empty box or the same value", async () => {
    const asked = vi.spyOn(chat, "setLimits");
    render(<ChatPanelSettings />);
    typeInto(await loaded("Chats in the list"), "");
    typeInto(number("Chats in the list"), "30");
    await act(async () => {});
    expect(asked).not.toHaveBeenCalled();
  });

  it("says why when the backend refuses, and keeps what was there", async () => {
    render(<ChatPanelSettings />);
    const box = await loaded("Agents working at once");
    chat.setLimits = async () => {
      throw new Error("Agents working at once must be from 1 to 8");
    };
    typeInto(box, "6");
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Agents working at once must be from 1 to 8"));
    expect(chat.limitValues.maxConcurrent).toBe(3);
  });

  it("goes back to the usual limits from the dot", async () => {
    chat.limitValues = { listSize: 80, maxConcurrent: 3 };
    render(<ChatPanelSettings />);
    await loaded("Chats in the list");
    fireEvent.click(screen.getByRole("button", { name: "Reset Chats in the list" }));
    await waitFor(() => expect(chat.limitValues.listSize).toBe(30));
  });
});

// The chat's "…" menu: how writes reach the notes. Ask first is the default and
// is not announced; Apply directly and Auto are, with a small label. The agent
// mode wins over the choice.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useAgentMode } from "../../agents/store";
import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { savedOf } from "../saved-thread";
import { useChat } from "../store";
import { CLAUDE, resetChat, scriptedChat, type Scripted } from "../test-kit";
import { Conversation } from "./Conversation";

let chat: Scripted;

async function show(mode?: "review" | "autonomous") {
  const vault = new MemoryVault({});
  if (mode) await vault.setAgentPolicy({ mode, until: null, projects: {} });
  useAgentMode.setState({ view: null, box: "hour", error: null });
  useWorkspace.setState({ toasts: [] });
  await useWorkspace.getState().connect({ client: vault });
  await useAgentMode.getState().load();
  await useChat.getState().loadProviders();
  const id = useChat.getState().start({ id: "t1", open: true });
  render(<Conversation id={id} variant="full" page={null} />);
  return id;
}

const openMenu = () => act(async () => fireEvent.click(screen.getByRole("button", { name: "Chat options" })));
const choice = (name: RegExp) => screen.getByRole("menuitemcheckbox", { name });

beforeEach(() => {
  localStorage.clear();
  chat = scriptedChat([CLAUDE]);
  resetChat(chat);
});
afterEach(cleanup);

describe("the chat's … menu", () => {
  it("offers three choices, with Ask first ticked and nothing announced", async () => {
    await show();
    expect(document.querySelector(".kasten-chat-write-label")).toBeNull();
    await openMenu();
    expect(within(screen.getByRole("menu")).getAllByRole("menuitemcheckbox").map((i) => i.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
    expect(choice(/^Ask first/)).toBeTruthy();
    expect(choice(/^Apply directly/)).toBeTruthy();
    expect(choice(/^Auto/)).toBeTruthy();
  });

  it("applies directly: the next question asks for writes at once, and the label says so", async () => {
    const id = await show();
    await openMenu();
    await act(async () => fireEvent.click(choice(/^Apply directly/)));
    expect(useChat.getState().threads[id]!.direct).toBe(true);
    expect(document.querySelector(".kasten-chat-write-label")?.textContent).toBe("Applies directly");
    await useChat.getState().send(id, "Tidy the page");
    expect(chat.requests.at(-1)?.writes).toBe("direct");
  });

  it("is Auto: changes still come staged (the window applies the small ones), and the label says Auto", async () => {
    const id = await show();
    await openMenu();
    await act(async () => fireEvent.click(choice(/^Auto/)));
    expect(useChat.getState().threads[id]).toMatchObject({ auto: true, direct: false });
    expect(document.querySelector(".kasten-chat-write-label")?.textContent).toBe("Auto");
    await useChat.getState().send(id, "Tidy the page");
    expect(chat.requests.at(-1)?.writes).toBeUndefined();
  });

  it("goes back to Ask first, and the choice is kept with the thread", async () => {
    const id = await show();
    useChat.getState().setWrites(id, "auto");
    expect(savedOf(useChat.getState().threads[id]!)).toMatchObject({ auto: true, direct: false });
    useChat.getState().setWrites(id, "ask");
    expect(savedOf(useChat.getState().threads[id]!)).toMatchObject({ auto: false, direct: false });
    await act(async () => {});
    expect(document.querySelector(".kasten-chat-write-label")).toBeNull();
  });

  it("gives way to Review everything: the choice changes nothing and the menu says why", async () => {
    const id = await show("review");
    expect(document.querySelector(".kasten-chat-write-label")?.textContent).toBe("Review everything");
    await openMenu();
    await act(async () => fireEvent.click(choice(/^Apply directly/)));
    expect(useChat.getState().threads[id]!.direct).toBeFalsy();
    expect(useWorkspace.getState().toasts.some((t) => /Review everything is on/.test(t.text))).toBe(true);
  });

  it("and to Autonomous agents", async () => {
    await show("autonomous");
    expect(document.querySelector(".kasten-chat-write-label")?.textContent).toBe("Autonomous agents");
  });
});

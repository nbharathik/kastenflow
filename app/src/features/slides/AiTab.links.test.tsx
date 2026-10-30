// A link in the deck's assistant never replaces the deck's tab unless Settings say so (Links from the assistant open).

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reloadPanelPrefs, usePanelPrefs } from "../chat/panel-prefs";
import { resetChat, scriptedChat } from "../chat/test-kit";
import { useChatLinks } from "../chat/view/links";
import { useWorkspace } from "../workspace/store";
import { AiTab } from "./AiTab";

// The message list is the chat's; what matters here is the links its messages are given.
vi.mock("../chat/view/MessageList", () => ({
  MessageList: () => {
    const links = useChatLinks();
    return (
      <div>
        <button onClick={() => links.openPath("notes/plan.md", "here")}>plain click</button>
        <button onClick={() => links.openPath("notes/plan.md", "tab")}>ctrl click</button>
        <button onClick={() => links.openTitle("Plan", "here")}>plain title</button>
      </div>
    );
  },
}));

const open = vi.fn();
const title = vi.fn();

beforeEach(() => {
  localStorage.clear();
  reloadPanelPrefs();
  resetChat(scriptedChat());
  open.mockClear();
  title.mockClear();
  useWorkspace.setState({ openPath: open, openTitle: title } as never);
});
afterEach(cleanup);

const mount = async () => {
  render(<AiTab status="idle" deckPath="library/talk.deck" deckTitle="Talk" theme="Light" slideId="s1" slideNumber={1} slideCount={1} slideTitle="One" elementIds={[]} pending={0} acceptAll={() => {}} />);
  await screen.findByRole("button", { name: "plain click" });
};

describe("links from the deck's assistant", () => {
  it("open beside the deck by default, so the deck's tab stays", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "plain click" }));
    expect(open).toHaveBeenCalledWith("notes/plan.md", "right");
    fireEvent.click(screen.getByRole("button", { name: "plain title" }));
    expect(title).toHaveBeenCalledWith("Plan", "right");
  });

  it("open in a new tab when Settings say so", async () => {
    act(() => usePanelPrefs.getState().set({ assistantLinks: "tab" }));
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "plain click" }));
    expect(open).toHaveBeenCalledWith("notes/plan.md", "tab");
  });

  it("open in the deck's own tab only when Settings say so", async () => {
    act(() => usePanelPrefs.getState().set({ assistantLinks: "here" }));
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "plain click" }));
    expect(open).toHaveBeenCalledWith("notes/plan.md", "here");
  });

  it("still let Ctrl, Shift and Alt choose", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "ctrl click" }));
    expect(open).toHaveBeenCalledWith("notes/plan.md", "tab");
  });
});

// The window's Chat button says that a chat works, or how many finished or
// need you while you were elsewhere, without loading the chat.

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useUnread } from "../features/chat/unread";
import { GlobalActions } from "./GlobalActions";

beforeEach(() => useUnread.setState({ unseen: {}, viewing: {}, working: 0 }));
afterEach(cleanup);

const chat = () => screen.getByRole("button", { name: "Chat" });
const badge = () => chat().querySelector<HTMLElement>(".ui-icon-badge");

describe("the Chat button", () => {
  it("is plain when nothing happens", () => {
    render(<GlobalActions />);
    expect(badge()).toBeNull();
    expect(chat().getAttribute("aria-description")).toBeNull();
  });

  it("pulses a dot while a chat works", () => {
    render(<GlobalActions />);
    act(() => useUnread.getState().setWorking(1));
    expect(badge()!.getAttribute("data-kind")).toBe("working");
    expect(badge()!.textContent).toBe("");
    expect(chat().getAttribute("aria-description")).toBe("A chat is working");
    act(() => useUnread.getState().setWorking(3));
    expect(chat().getAttribute("aria-description")).toBe("3 chats are working");
  });

  it("counts the chats that finished or need you, ahead of the dot", () => {
    render(<GlobalActions />);
    act(() => {
      useUnread.getState().setWorking(1);
      useUnread.getState().note("a", "done");
      useUnread.getState().note("b", "needs");
    });
    expect(badge()!.getAttribute("data-kind")).toBe("count");
    expect(badge()!.textContent).toBe("2");
    expect(chat().getAttribute("aria-description")).toBe("2 chats finished or need you");
    // Looking at one takes it off the count.
    act(() => void useUnread.getState().view("a"));
    expect(badge()!.textContent).toBe("1");
    expect(chat().getAttribute("aria-description")).toBe("A chat finished or needs you");
  });

  it("keeps its name, so it is found as before", () => {
    render(<GlobalActions />);
    act(() => useUnread.getState().note("a", "failed"));
    expect(chat().getAttribute("aria-label")).toBe("Chat");
  });
});

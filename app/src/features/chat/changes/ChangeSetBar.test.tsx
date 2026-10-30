import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { useChat } from "../store";
import { CLAUDE, resetChat, scriptedChat, type Scripted } from "../test-kit";
import type { ChangesView } from "../types";
import { Conversation } from "../view/Conversation";

let chat: Scripted;

const VIEW: ChangesView = {
  id: "set-1",
  files: [
    { path: "library/welcome.md", kind: "note", title: "Welcome", new: false, before: "One\nTwo\n", after: "One\nTwo\nThree\n", diff: "", stale: false },
    { path: "library/trip.md", kind: "note", title: "Trip plan", new: true, before: null, after: "Day one.\n", diff: "", stale: false },
  ],
  pictures: [{ path: "assets/figure.png", name: "figure.png", bytes: 2048 }],
  steps: [
    { summary: "Add to “Welcome”", paths: ["library/welcome.md"] },
    { summary: "Create “Trip plan”", paths: ["library/trip.md"] },
  ],
};

/** A thread whose first answer is over and that has `count` changes staged (none for null). */
async function show(count: number | null = 3) {
  await useWorkspace.getState().connect({ client: new MemoryVault({}) });
  await useChat.getState().loadProviders();
  const id = useChat.getState().start({ open: true });
  await useChat.getState().send(id, "Plan my trip");
  chat.emit({ chat: id, turn: "turn-1", kind: "done" });
  if (count !== null) useChat.getState().setChanges(id, { id: "set-1", count, paths: [] });
  render(<Conversation id={id} variant="full" page={null} />);
  return id;
}

beforeEach(() => {
  localStorage.clear();
  chat = scriptedChat([CLAUDE]);
  chat.view = VIEW;
  resetChat(chat);
});
afterEach(cleanup);

describe("the staged changes bar", () => {
  it("is not there when nothing is staged", async () => {
    await show(null);
    expect(screen.queryByRole("region", { name: "This chat's staged changes" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
  });

  it("counts the changes and offers Review, Apply and Discard", async () => {
    await show(3);
    const bar = screen.getByRole("region", { name: "This chat's staged changes" });
    expect(within(bar).getByRole("status").textContent).toBe("3 changes to review");
    for (const name of ["Review", "Apply", "Discard"]) expect(within(bar).getByRole("button", { name })).toBeTruthy();
  });

  it("opens the files before and after, the pictures and the steps", async () => {
    await show(3);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Review" })));
    const list = await screen.findByRole("region", { name: "Staged changes" });
    expect(await within(list).findByRole("article", { name: "Changed note Welcome" })).toBeTruthy();
    expect(within(list).getByRole("article", { name: "New note Trip plan" })).toBeTruthy();
    // The diff of the first: the line the chat added.
    const diff = within(list).getByRole("table", { name: "Changes to Welcome" });
    expect(diff.textContent).toContain("Three");
    expect(within(list).getByRole("region", { name: "Pictures" }).textContent).toContain("assets/figure.png");
    expect(within(list).getByText(/What the chat did \(2\)/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide" })).toBeTruthy();
  });

  it("applies the changes and leaves the chat's undo in their place", async () => {
    const id = await show(3);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Apply" })));
    expect(chat.applied).toEqual([id]);
    expect(screen.queryByRole("region", { name: "This chat's staged changes" })).toBeNull();
    expect(screen.getByRole("region", { name: "This chat's changes" }).textContent).toContain("This chat changed your notes.");
  });

  it("asks before it discards, and a no keeps them", async () => {
    const id = await show(2);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Discard" })));
    const ask = screen.getByRole("alertdialog", { name: "Discard 2 changes?" });
    fireEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
    expect(chat.discarded).toEqual([]);
    expect(screen.getByRole("status").textContent).toBe("2 changes to review");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Discard" })));
    await act(async () => fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Discard changes" })));
    expect(chat.discarded).toEqual([id]);
    expect(screen.queryByRole("region", { name: "This chat's staged changes" })).toBeNull();
  });

  it("says so when the vault moved on, opens the files and offers Recalculate", async () => {
    await show(3);
    chat.applyResult = { status: "stale", files: ["library/welcome.md"] };
    chat.view = { ...VIEW, files: [{ ...VIEW.files[0]!, stale: true }, VIEW.files[1]!] };
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Apply" })));
    expect(await screen.findByText(/nothing was written/)).toBeTruthy();
    expect(await screen.findByText(/in a way that cannot be put together with it: Welcome/)).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Recalculate" })));
    expect(chat.recalcs).toHaveLength(1);
  });
});

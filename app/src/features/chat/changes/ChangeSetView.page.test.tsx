// A staged page layout (an edit_page call), looked at as the page's own text before and after: the callout the chat
// added is a plain line of the diff, and the step reads in words.

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { useChat } from "../store";
import { CLAUDE, resetChat, scriptedChat, type Scripted } from "../test-kit";
import type { ChangesView, FileChange } from "../types";
import { ChangeSetView } from "./ChangeSetView";

const BEFORE = "---\ntitle: Launch\n---\nThe launch is on track.\n\n## Tasks\n\n- [ ] Book the room\n";
const AFTER = "---\ntitle: Launch\n---\n> [!tip] In short\n> The launch is on track.\n\n## Tasks\n\n- [ ] Book the room\n";
const page: FileChange = { path: "library/launch.md", kind: "note", title: "Launch", new: false, before: BEFORE, after: AFTER, diff: "", stale: false };

let chat: Scripted;

async function show(files: FileChange[], steps: string[]) {
  chat.view = { id: "set-1", files, pictures: [], steps: steps.map((summary) => ({ summary })) } as unknown as ChangesView;
  await useWorkspace.getState().connect({ client: new MemoryVault({}) });
  await useChat.getState().loadProviders();
  const id = useChat.getState().start({ open: true });
  useChat.getState().setChanges(id, { id: "set-1", count: files.length, paths: files.map((f) => f.path) });
  render(<ChangeSetView thread={useChat.getState().threads[id]!} />);
  return screen.findByRole("article");
}

beforeEach(() => {
  localStorage.clear();
  chat = scriptedChat([CLAUDE]);
  resetChat(chat);
});
afterEach(cleanup);

describe("a staged page layout", () => {
  it("shows the page's diff, with the lines the layout added, and the step in words", async () => {
    const article = await show([page], ["Edit “Launch” (1 change)"]);
    expect(article.getAttribute("aria-label")).toBe("Changed note Launch");
    const diff = within(article).getByRole("table", { name: "Changes to Launch" });
    expect(within(diff).getByText(/\[!tip\] In short/)).toBeTruthy();
    // The paragraph is written again inside the callout, with the same words.
    expect(within(diff).getByText(/> The launch is on track\./)).toBeTruthy();
    expect(screen.getByText("What the chat did (1)")).toBeTruthy();
    expect(screen.getByText("Edit “Launch” (1 change)")).toBeTruthy();
  });
});

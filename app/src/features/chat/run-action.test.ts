import { beforeEach, describe, expect, it } from "vitest";

import { useShell } from "../../lib/store";
import { useWorkspace } from "../workspace/store";
import { drafts } from "./message-drafts";
import { BUILT_IN_ACTIONS } from "./preview/actions";
import { runInChat } from "./run-action";
import { useChat } from "./store";
import { resetChat, scriptedChat, type Scripted } from "./test-kit";

// Highlights alone: the text of pages is read from the PDF itself, which needs a vault.
const PDF = { kind: "pdf" as const, label: "A primer · 1 highlight", ref: ["sources/primer.pdf", "highlights:h1"] };
const explain = BUILT_IN_ACTIONS.find((a) => a.slug === "explain")!;
let chat: Scripted;

beforeEach(() => {
  localStorage.clear();
  chat = scriptedChat();
  resetChat(chat);
  useShell.setState({ chatOpen: false });
  drafts.clear();
});

describe("running an AI action in the chat", () => {
  it("starts a chat about the chips, in the dock, and asks what the action says", async () => {
    expect(await runInChat("explain", [PDF])).toBe(true);
    expect(useShell.getState().chatOpen).toBe(true);
    expect(chat.requests).toHaveLength(1);
    expect(chat.requests[0]).toMatchObject({ text: explain.instruction, context: [{ kind: "pdf", label: PDF.label, ref: PDF.ref }] });
    const thread = useChat.getState().threads[useChat.getState().active!]!;
    // About that and nothing else: it does not take up the page in front.
    expect(thread.follow).toBe(false);
    expect(thread.context.map((c) => c.origin)).toEqual(["added"]);
  });

  it("says when there is no such action, and starts nothing", async () => {
    expect(await runInChat("gone", [PDF])).toBe(false);
    expect(chat.requests).toEqual([]);
    expect(useShell.getState().chatOpen).toBe(false);
    expect(useChat.getState().order).toEqual([]);
    expect(useWorkspace.getState().toasts.at(-1)?.text ?? "").toContain("no AI action called “gone”");
  });

  it("leaves the action's words in the box when there is no provider to ask", async () => {
    resetChat(scriptedChat([]));
    expect(await runInChat("explain", [PDF])).toBe(true);
    const id = useChat.getState().active!;
    expect(drafts.get(id)).toBe(explain.instruction);
  });
});

// AI in a page, with a scripted provider: the panel opens below the text
// it is about, the answer is only a preview until taken, taking it is one
// change one undo takes back, and Discard, Escape and Stop leave the page
// as it was. The slash menu opens it too.

import { parserCtx, serializerCtx } from "@milkdown/kit/core";
import { undo } from "@milkdown/kit/prose/history";
import { TextSelection } from "@milkdown/kit/prose/state";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useShell } from "../../../../lib/store";
import { findText, useTestEditor } from "../../../../test/editor";
import { drafts } from "../../../chat/message-drafts";
import { useChat } from "../../../chat/store";
import { LOCAL, resetChat, scriptedChat, type Scripted } from "../../../chat/test-kit";
import type { WriteAction } from "../../../chat/types";
import { BLOCK_CHOICES } from "../menus/catalog";
import { choiceCommand } from "../menus/slash";
import { closeAi, onAiOpen, openAi, type AiOpen } from "./ai";
import { AiPanel } from "./AiPanel";

const editor = useTestEditor();
const BODY = "Pack the tent. Check the poles.\n\nThe tent goes last.\n";
let chat: Scripted;

/** The panel as the page editor draws it: in the page, below the text. */
function Panel() {
  const [open, setOpen] = useState<AiOpen | null>(null);
  useEffect(() => onAiOpen(editor.view, setOpen), []);
  if (!open) return null;
  const done = () => {
    closeAi(editor.view);
    setOpen(null);
  };
  return createPortal(
    <AiPanel key={open.opened} view={editor.view} open={open} title="Trip" parse={(markdown) => editor.ctx.get(parserCtx)(markdown)} serialize={(doc) => editor.ctx.get(serializerCtx)(doc)} onClose={done} />,
    open.host,
  );
}

function select(text: string) {
  const from = findText(editor.doc, text);
  const { view } = editor;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, from + text.length)));
}

async function opened(action: WriteAction, name: string) {
  await act(async () => void openAi(editor.view, action));
  return screen.findByRole("dialog", { name });
}

beforeEach(() => {
  localStorage.clear();
  chat = scriptedChat([LOCAL]);
  resetChat(chat);
  editor.open(BODY);
  render(<Panel />);
});
afterEach(() => {
  cleanup();
  closeAi(editor.view);
});

describe("AI in a page", () => {
  it("asks about the selection and replaces it in one change that undo takes back", async () => {
    select("Check the poles.");
    const panel = await opened("ask", "Ask AI");
    // It sits in the page, just below the text it is about.
    expect(editor.view.dom.contains(panel)).toBe(true);
    expect(editor.view.dom.querySelector(".kasten-ai-range")?.textContent).toBe("Check the poles.");
    await act(async () => fireEvent.click(within(panel).getByRole("button", { name: "Make it shorter" })));
    await within(panel).findByRole("button", { name: "Replace selection" });
    expect(within(panel).getByLabelText("AI's answer").textContent).toBe("A clearer sentence.");
    expect(within(panel).getByText("Local server · local-model")).toBeTruthy();
    // Only a preview until taken.
    expect(editor.save()).toBe(BODY);
    expect(chat.writes).toEqual([
      {
        id: expect.any(String),
        provider: "Local server",
        model: "local-model",
        action: "ask",
        instruction: "Make it shorter",
        title: "Trip",
        selection: "Check the poles.",
        before: "Pack the tent. ",
        after: "\n\nThe tent goes last.",
      },
    ]);

    await act(async () => fireEvent.click(within(panel).getByRole("button", { name: "Replace selection" })));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(editor.view.dom.querySelector(".kasten-ai-range")).toBeNull();
    expect(editor.save()).toBe("Pack the tent. A clearer sentence.\n\nThe tent goes last.\n");
    undo(editor.view.state, editor.view.dispatch);
    expect(editor.save()).toBe(BODY);
  });

  it("takes what you type, and inserts below when asked", async () => {
    select("Check the poles.");
    const panel = await opened("ask", "Ask AI");
    const input = within(panel).getByRole("textbox", { name: "Ask AI" });
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.change(input, { target: { value: "Say it as a list" } });
    await act(async () => fireEvent.submit(input.closest("form")!));
    await act(async () => fireEvent.click(await within(panel).findByRole("button", { name: "Insert below" })));
    expect(chat.writes.at(-1)!.instruction).toBe("Say it as a list");
    expect(editor.save()).toBe("Pack the tent. Check the poles.\n\nA clearer sentence.\n\nThe tent goes last.\n");
  });

  it("continues from the caret, and Escape or Discard leave the page as it was", async () => {
    editor.caret("The tent goes last.", true);
    let panel = await opened("continue", "Continue writing");
    await within(panel).findByRole("button", { name: "Insert" });
    expect(chat.writes.at(-1)).toMatchObject({ action: "continue", instruction: "", selection: "", before: "Pack the tent. Check the poles.\n\nThe tent goes last." });
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(editor.save()).toBe(BODY);

    panel = await opened("summarize", "Summarize page");
    await within(panel).findByRole("button", { name: "Insert" });
    expect(chat.writes.at(-1)).toMatchObject({ action: "summarize", selection: "Pack the tent. Check the poles.\n\nThe tent goes last." });
    fireEvent.click(within(panel).getByRole("button", { name: "Discard" }));
    expect(editor.save()).toBe(BODY);
  });

  it("stops an answer and keeps what came, and says why one failed", async () => {
    chat.holdNext();
    editor.caret("The tent goes last.", true);
    const panel = await opened("continue", "Continue writing");
    await act(async () => fireEvent.click(await within(panel).findByRole("button", { name: "Stop" })));
    await within(panel).findByText("Stopped: take what was written, or try again.");
    expect(within(panel).getByLabelText("AI's answer").textContent).toBe("A clearer");

    chat.failNext("Local server answered 404: model not found. Check the base URL and the model's name.");
    await act(async () => fireEvent.click(within(panel).getByRole("button", { name: "Try again" })));
    expect((await within(panel).findByRole("alert")).textContent).toContain("Check the base URL");
    expect(within(panel).queryByRole("button", { name: "Insert" })).toBeNull();
    await act(async () => fireEvent.click(within(panel).getByRole("button", { name: "Try again" })));
    await within(panel).findByRole("button", { name: "Insert" });
    expect(editor.save()).toBe(BODY);
  });

  it("offers to set up a provider when there is none", async () => {
    chat = scriptedChat([]);
    resetChat(chat);
    select("Check the poles.");
    const panel = await opened("ask", "Ask AI");
    expect(await within(panel).findByRole("button", { name: "Set up AI" })).toBeTruthy();
    expect(chat.writes).toEqual([]);
  });

  it("opens from the slash menu's AI choices", async () => {
    editor.caret("The tent goes last.", true);
    const choice = BLOCK_CHOICES.find((c) => c.key === "summarize-ai")!;
    await act(async () => void editor.run(choiceCommand(choice, editor.ctx)));
    expect(await screen.findByRole("dialog", { name: "Summarize page" })).toBeTruthy();
    expect(BLOCK_CHOICES.filter((c) => c.section === "AI").map((c) => c.label)).toEqual(["Ask AI…", "Continue writing", "Summarize page"]);
  });
});

describe("Explain", () => {
  const button = (panel: HTMLElement, name: string) => within(panel).queryByRole("button", { name });

  it("answers about the selection and leaves the page exactly as it was, with nothing to put in it", async () => {
    chat.answer = "It means the poles must be checked before packing.";
    select("Check the poles.");
    const panel = await opened("explain", "Explain");
    await within(panel).findByRole("button", { name: "Copy" });
    expect(within(panel).getByLabelText("AI's answer").textContent).toBe("It means the poles must be checked before packing.");
    expect(chat.writes).toEqual([
      {
        id: expect.any(String),
        provider: "Local server",
        model: "local-model",
        action: "explain",
        instruction: "",
        title: "Trip",
        selection: "Check the poles.",
        before: "Pack the tent. ",
        after: "\n\nThe tent goes last.",
        scope: "nearby",
      },
    ]);
    // Nothing to replace or insert; the ways on are to copy it, carry on in the chat, or drop it.
    for (const name of ["Replace selection", "Insert below", "Insert"]) expect(button(panel, name), name).toBeNull();
    expect(button(panel, "Continue in chat")).toBeTruthy();
    expect(button(panel, "Discard")).toBeTruthy();
    // The shortcut that takes an answer does nothing for one that is only read.
    fireEvent.keyDown(panel, { key: "Enter", ctrlKey: true });
    expect(editor.save()).toBe(BODY);
    fireEvent.click(within(panel).getByRole("button", { name: "Discard" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(editor.save()).toBe(BODY);
  });

  it("reads the nearby text or the whole page, and asks again when that changes", async () => {
    const long = `${"Early words. ".repeat(400)}\n\nThe claim in question.\n\n${"Late words. ".repeat(400)}\n`;
    editor.open(long);
    const kept = editor.save();
    select("The claim in question.");
    const panel = await opened("explain", "Explain");
    await within(panel).findByRole("button", { name: "Copy" });
    const nearby = chat.writes.at(-1)!;
    expect(nearby.scope).toBe("nearby");
    expect(nearby.before.length).toBe(2_000);
    expect(within(panel).getByRole("button", { name: "Nearby text" }).getAttribute("aria-pressed")).toBe("true");

    await act(async () => fireEvent.click(within(panel).getByRole("button", { name: "Whole page" })));
    await within(panel).findByRole("button", { name: "Copy" });
    const whole = chat.writes.at(-1)!;
    expect(chat.writes).toHaveLength(2);
    expect(whole.scope).toBe("page");
    // All the text on each side; the backend cuts it to fit.
    expect(whole.before.length).toBeGreaterThan(4_000);
    expect(whole.after.length).toBeGreaterThan(4_000);
    expect(whole.selection).toBe("The claim in question.");
    expect(within(panel).getByRole("button", { name: "Whole page" }).getAttribute("aria-pressed")).toBe("true");
    // The one already chosen asks nothing more.
    await act(async () => fireEvent.click(within(panel).getByRole("button", { name: "Whole page" })));
    expect(chat.writes).toHaveLength(2);
    expect(editor.save()).toBe(kept);
  });

  it("needs a selection", async () => {
    editor.caret("The tent goes last.", true);
    let ok = true;
    await act(async () => void (ok = openAi(editor.view, "explain")));
    expect(ok).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(chat.writes).toEqual([]);
  });

  it("copies the answer", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    chat.answer = "A short explanation.";
    select("Check the poles.");
    const panel = await opened("explain", "Explain");
    await act(async () => fireEvent.click(await within(panel).findByRole("button", { name: "Copy" })));
    expect(writeText).toHaveBeenCalledWith("A short explanation.");
  });

  it("carries on in a new chat with the passage and the answer ready to build on", async () => {
    chat.answer = "A short explanation.";
    useShell.setState({ chatOpen: false });
    select("Check the poles.");
    const panel = await opened("explain", "Explain");
    await act(async () => fireEvent.click(await within(panel).findByRole("button", { name: "Continue in chat" })));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useShell.getState().chatOpen).toBe(true);
    const id = useChat.getState().active!;
    const draft = drafts.get(id)!;
    expect(draft).toContain("About this passage in “Trip”:");
    expect(draft).toContain("> Check the poles.");
    expect(draft).toContain("You said:\n\nA short explanation.");
    expect(draft.endsWith("My question: ")).toBe(true);
    expect(editor.save()).toBe(BODY);
  });

  it("stops, and says why it failed, like the other panels", async () => {
    chat.failNext("Local server answered 404: model not found. Check the base URL and the model's name.");
    select("Check the poles.");
    const panel = await opened("explain", "Explain");
    expect((await within(panel).findByRole("alert")).textContent).toContain("Check the base URL");
    expect(button(panel, "Copy")).toBeNull();
    await act(async () => fireEvent.click(within(panel).getByRole("button", { name: "Try again" })));
    await within(panel).findByRole("button", { name: "Copy" });
    expect(chat.writes).toHaveLength(2);
  });
});

describe("AI actions in the panel", () => {
  it("lists the ones the editor can run here, and runs one with only what it asks for", async () => {
    select("Check the poles.");
    const panel = await opened("ask", "Ask AI");
    const row = await within(panel).findByRole("group", { name: "AI actions" });
    // Compare sources works from the chat and the reader; Draft project update needs a project.
    expect(within(row).getAllByRole("button").map((b) => b.textContent)).toEqual(["Explain", "Outline", "Extract action items"]);

    await act(async () => fireEvent.click(within(row).getByRole("button", { name: "Outline" })));
    expect(screen.getByRole("dialog", { name: "Outline" })).toBeTruthy();
    await within(panel).findByRole("button", { name: "Replace selection" });
    const run = chat.runs.at(-1)!;
    expect(run).toMatchObject({ action: "outline", provider: "Local server", model: "local-model", title: "Trip", selection: "Check the poles." });
    expect(run.page).toBe("Pack the tent. Check the poles.\n\nThe tent goes last.");
    // Outline asks for the selection and the page, not the text around it, a project or a day.
    expect(Object.keys(run).sort()).toEqual(["action", "id", "model", "page", "provider", "selection", "title"]);

    // It writes, so it is taken like Ask AI's answer: one change.
    await act(async () => fireEvent.click(within(panel).getByRole("button", { name: "Insert below" })));
    expect(editor.save()).toBe("Pack the tent. Check the poles.\n\nA clearer sentence.\n\nThe tent goes last.\n");
  });

  it("explains through its own request, with the toggles for the text it reads", async () => {
    select("Check the poles.");
    const panel = await opened("ask", "Ask AI");
    const row = await within(panel).findByRole("group", { name: "AI actions" });
    await act(async () => fireEvent.click(within(row).getByRole("button", { name: "Explain" })));
    expect(screen.getByRole("dialog", { name: "Explain" })).toBeTruthy();
    await within(panel).findByRole("button", { name: "Copy" });
    expect(chat.writes.at(-1)).toMatchObject({ action: "explain", scope: "nearby" });
    expect(chat.runs).toEqual([]);
    expect(within(panel).getByRole("button", { name: "Whole page" })).toBeTruthy();
  });

  it("is read only when the action writes nothing, and offers what the vault added", async () => {
    chat.catalog = {
      actions: [
        { slug: "critique", title: "Critique", icon: "no-such-icon", needs: ["selection"], optional: [], writes: "none", where: ["editor"], version: 1, instruction: "Say what is weak.", builtIn: false, path: "templates/ai/critique.md" },
        { slug: "sources", title: "Sources", icon: "layers", needs: ["sources"], optional: [], writes: "none", where: ["editor"], version: 1, instruction: "x", builtIn: false, path: null },
        { slug: "chat-only", title: "Chat only", icon: "chat", needs: [], optional: [], writes: "none", where: ["chat"], version: 1, instruction: "x", builtIn: false, path: null },
      ],
      problems: [{ slug: "broken", path: "templates/ai/broken.md", message: "The file needs a title" }],
    };
    select("Check the poles.");
    const panel = await opened("ask", "Ask AI");
    const row = await within(panel).findByRole("group", { name: "AI actions" });
    expect(within(row).getAllByRole("button").map((b) => b.textContent)).toEqual(["Critique"]);
    expect((await within(panel).findByRole("status")).textContent).toContain("templates/ai/broken.md: The file needs a title");
    await act(async () => fireEvent.click(within(row).getByRole("button", { name: "Critique" })));
    await within(panel).findByRole("button", { name: "Copy" });
    for (const name of ["Replace selection", "Insert below", "Insert"]) expect(within(panel).queryByRole("button", { name })).toBeNull();
    expect(chat.runs.at(-1)).toMatchObject({ action: "critique", selection: "Check the poles." });
    expect(editor.save()).toBe(BODY);
  });

  it("runs an action at once when opened for it, and says when there is no such action", async () => {
    editor.caret("The tent goes last.", true);
    const panel = await (async () => {
      await act(async () => void openAi(editor.view, "ask", "extract-action-items"));
      return screen.findByRole("dialog", { name: "Extract action items" });
    })();
    await within(panel).findByRole("button", { name: "Insert" });
    expect(chat.runs.at(-1)).toMatchObject({ action: "extract-action-items", page: "Pack the tent. Check the poles.\n\nThe tent goes last." });
    fireEvent.keyDown(panel, { key: "Escape" });

    await act(async () => void openAi(editor.view, "ask", "gone"));
    const missing = await screen.findByRole("dialog", { name: "AI action" });
    expect((await within(missing).findByRole("alert")).textContent).toContain("no such AI action");
  });
});

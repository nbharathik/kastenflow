// The brainstorm on a board's bar: the form asks the chat backend, the board
// shows the new section, and a toast offers the session for review. Without
// a provider the form says where to add one; a failure is shown where it
// can be seen.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { previewChat } from "../../chat/preview/fake-chat";
import { useChat } from "../../chat/store";
import { scriptedChat, type Scripted } from "../../chat/test-kit";
import type { Brainstormed, BrainstormRequest } from "../../chat/types";
import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { derive } from "../../workspace/store-layout";
import { initialLayout } from "../../workspace/tabs";
import { BoardCanvas } from "../canvas/BoardCanvas";
import { mockReactFlow } from "../canvas/test/flow-mocks";
import { forgetTrails } from "../canvas/trail";
import { useBoards } from "../store";
import { useBrainstorms } from "./run";

const BOARD = "projects/trip/boards/hilltown.canvas";
const SEED = {
  "projects/trip/_project.md": "---\ntitle: Trip\ntype: project\n---\n",
  [BOARD]: JSON.stringify({ nodes: [{ id: "a", type: "text", text: "Book the guesthouse", x: 0, y: 0, width: 260, height: 120 }], edges: [], "x-kasten": { title: "Hilltown" } }),
};

let vault: MemoryVault;

beforeAll(mockReactFlow);

beforeEach(async () => {
  localStorage.clear();
  forgetTrails();
  vault = new MemoryVault(SEED);
  useWorkspace.setState({ client: vault, ready: true, notes: await vault.list(), ...derive(initialLayout()), stack: [], stackOpen: false, recent: [], toasts: [] });
  useBrainstorms.setState({ running: {}, errors: {}, forms: {} });
  useChat.setState({ threads: {}, order: [], active: null });
  await useBoards.getState().load();
});
afterEach(cleanup);

async function openForm() {
  const view = render(<BoardCanvas path={BOARD} />);
  await view.findByLabelText(/^Whiteboard:/);
  await waitFor(() => expect(view.container.querySelectorAll(".react-flow__node")).toHaveLength(1));
  // The board's "More" menu holds it.
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Brainstorm with AI/ }));
  return { view, form: await screen.findByRole("dialog", { name: "Brainstorm on this board" }) };
}

describe("brainstorm on a board", () => {
  it("places ideas in a new section and offers the session for review", async () => {
    useChat.getState().connect(previewChat(() => vault, { pace: 0 }));
    const { view, form } = await openForm();
    fireEvent.change(await within(form).findByLabelText("Ideas about"), { target: { value: "Day trips" } });
    fireEvent.click(within(form).getByRole("radio", { name: "4" }));
    expect(within(form).getByText(/places canned ideas/)).toBeTruthy();
    await act(async () => fireEvent.click(within(form).getByRole("button", { name: "Brainstorm" })));

    // Four cards and their section, drawn on the board; the form closes.
    await waitFor(() => expect(view.container.querySelectorAll(".react-flow__node")).toHaveLength(6));
    expect(within(view.container).getByText("Day trips")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Brainstorm on this board" })).toBeNull();
    const [session] = await vault.sessions();
    expect(session).toMatchObject({ client: "kasten-brainstorm", commits: 10 });

    const toast = useWorkspace.getState().toasts.at(-1)!;
    expect(toast.text).toBe("Placed 4 ideas on the board. Undo them all from History.");
    act(() => toast.action!.run());
    expect(useWorkspace.getState().place).toEqual({ view: "history" });
  });

  it("asks the chosen provider for the chosen number of ideas, and remembers the model", async () => {
    const chat = scriptedChat();
    useChat.getState().connect(chat);
    const { form } = await openForm();
    fireEvent.click(await within(form).findByRole("radio", { name: "12" }));
    await act(async () => fireEvent.click(within(form).getByRole("button", { name: "Brainstorm" })));
    expect(chat.brainstorms).toEqual([{ board: BOARD, topic: "", count: 12, provider: "Claude", model: "model-small" }]);
    expect(JSON.parse(localStorage.getItem("kasten.chat.model")!)).toEqual({ provider: "Claude", model: "model-small" });
  });

  it("says where to add a provider when there is none", async () => {
    useChat.getState().connect(scriptedChat([]));
    const { form } = await openForm();
    fireEvent.click(await within(form).findByRole("button", { name: "Set up in Settings → AI providers" }));
    expect(useWorkspace.getState().place).toEqual({ view: "settings" });
  });

  it("shows it is thinking, and why it failed: in the form, or as a toast once closed", async () => {
    let finish!: (outcome: Error | Brainstormed) => void;
    const chat: Scripted = scriptedChat();
    chat.brainstorm = (request: BrainstormRequest) => {
      chat.brainstorms.push(request);
      return new Promise((resolve, reject) => (finish = (outcome) => (outcome instanceof Error ? reject(outcome) : resolve(outcome))));
    };
    useChat.getState().connect(chat);
    const { form } = await openForm();
    await act(async () => fireEvent.click(await within(form).findByRole("button", { name: "Brainstorm" })));
    const tool = screen.getByRole("button", { name: "More" });
    expect(tool.dataset.busy).toBe("true");
    expect(within(form).getByRole("button", { name: /Thinking/ })).toHaveProperty("disabled", true);
    await act(async () => finish(new Error("The model is overloaded")));
    expect(within(form).getByRole("alert").textContent).toBe("The model is overloaded");
    expect(tool.dataset.busy).toBeUndefined();
    expect(useWorkspace.getState().toasts).toEqual([]);

    // Again, with the form closed before the answer comes.
    await act(async () => fireEvent.click(within(form).getByRole("button", { name: "Brainstorm" })));
    fireEvent.click(tool);
    expect(screen.queryByRole("dialog", { name: "Brainstorm on this board" })).toBeNull();
    await act(async () => finish(new Error("The model is overloaded")));
    expect(useWorkspace.getState().toasts.at(-1)!.text).toBe("The brainstorm did not finish: The model is overloaded");
  });
});

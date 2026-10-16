// "Draw with AI" where a person starts a diagram: the Diagrams view, and Insert → Diagram… in a deck.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useShell } from "../../../lib/store";
import { drafts } from "../../chat/message-drafts";
import { BUILT_IN_ACTIONS } from "../../chat/preview/actions";
import { useChat } from "../../chat/store";
import { resetChat, scriptedChat, type Scripted } from "../../chat/test-kit";
import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import DiagramHost from "../DiagramHost";
import { DiagramsHome } from "../DiagramsHome";
import { setEditorBackend, useDiagramEditor, type EditorInfo } from "../editor";
import { useDiagramHost } from "../host-store";
import { pickDiagramPicture } from "../slides";
import { useDiagrams } from "../store";

const MISSING: EditorInfo = { version: "32.2.0", bytes: 48_235_802, url: "https://example.test/draw.war", installed: false, busy: false };
let chat: Scripted;

beforeEach(async () => {
  localStorage.clear();
  chat = scriptedChat();
  resetChat(chat);
  drafts.clear();
  useShell.setState({ chatOpen: false });
  useDiagrams.setState({ list: [], loaded: false, templateFor: null });
  useDiagramHost.setState({ modal: null, picker: null, pickFor: null, queue: [], seen: [], editing: [] });
  setEditorBackend({ status: async () => MISSING, install: async () => "installed", cancel: async () => {}, remove: async () => {} });
  useDiagramEditor.setState({ info: MISSING });
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:picture-${++n}`);
  URL.revokeObjectURL = vi.fn();
  await useWorkspace.getState().connect({ client: new MemoryVault({}) });
});
afterEach(() => {
  cleanup();
  setEditorBackend(null);
});

describe("Draw with AI in the Diagrams view", () => {
  it("opens a chat with nothing attached and the start of a sentence, whether or not there are diagrams", async () => {
    render(<DiagramsHome />);
    fireEvent.click(await screen.findByRole("button", { name: "Draw with AI" }));
    const thread = useChat.getState().threads[useChat.getState().active!]!;
    expect(thread.context).toEqual([]);
    expect(drafts.get(thread.id)).toBe("Draw a diagram of ");
    expect(useShell.getState().chatOpen).toBe(true);
    expect(chat.requests).toEqual([]);
  });
});

describe("Draw with AI in Insert → Diagram…", () => {
  it("closes the picker with no diagram, and asks the chat to draw one of the deck", async () => {
    render(<DiagramHost />);
    const asked = pickDiagramPicture(useWorkspace.getState().client!, "library/talk.deck");
    const dialog = await screen.findByRole("dialog", { name: "Choose a diagram" });
    expect(useDiagramHost.getState().pickFor).toBe("library/talk.deck");
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Draw with AI" })));
    // Nothing was chosen, so nothing is put on the slide.
    expect(await asked).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Choose a diagram" })).toBeNull();
    expect(useDiagramHost.getState().pickFor).toBeNull();
    await waitFor(() => expect(chat.requests).toHaveLength(1));
    expect(chat.requests[0]).toMatchObject({ text: BUILT_IN_ACTIONS.find((a) => a.slug === "draw-diagram")!.instruction, context: [{ kind: "deck", label: "talk", ref: ["library/talk.deck"] }] });
    expect(useShell.getState().chatOpen).toBe(true);
  });

  it("is ready for what to draw when the picker was not opened from a deck", async () => {
    render(<DiagramHost />);
    const asked = useDiagramHost.getState().pick();
    const dialog = await screen.findByRole("dialog", { name: "Choose a diagram" });
    expect(useDiagramHost.getState().pickFor).toBeNull();
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Draw with AI" })));
    expect(await asked).toBeNull();
    expect(chat.requests).toEqual([]);
    expect(drafts.get(useChat.getState().active!)).toBe("Draw a diagram of ");
  });

  it("forgets the deck when the picker is closed or another ask replaces it", async () => {
    render(<DiagramHost />);
    const first = pickDiagramPicture(useWorkspace.getState().client!, "library/a.deck");
    await screen.findByRole("dialog", { name: "Choose a diagram" });
    const second = pickDiagramPicture(useWorkspace.getState().client!, "library/b.deck");
    expect(await first).toBeNull();
    expect(useDiagramHost.getState().pickFor).toBe("library/b.deck");
    await act(async () => fireEvent.click(within(await screen.findByRole("dialog", { name: "Choose a diagram" })).getByRole("button", { name: "Cancel" })));
    expect(await second).toBeNull();
    expect(useDiagramHost.getState().pickFor).toBeNull();
  });
});

// The diagram editor's header, with the AI tools: Draw with AI, Check diagram and Tidy, each named; and the open editor taking in a
// change that was applied from the chat.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useShell } from "../../../lib/store";
import { drafts } from "../../chat/message-drafts";
import { BUILT_IN_ACTIONS } from "../../chat/preview/actions";
import { useChat } from "../../chat/store";
import { resetChat, scriptedChat, type Scripted } from "../../chat/test-kit";
import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { DiagramEditor } from "../DiagramEditor";
import { setEditorBackend, useDiagramEditor, type EditorInfo } from "../editor";
import { useDiagramHost } from "../host-store";
import { LAYOUT_PRESETS } from "../protocol";
import { diagramFilesChanged, useDiagrams } from "../store";

const INSTALLED: EditorInfo = { version: "32.2.0", bytes: 48_235_802, url: "https://example.test/draw.war", installed: true, busy: false };
const MISSING: EditorInfo = { ...INSTALLED, installed: false };
const withBox = (xml: string, label: string) => xml.replace("</root>", `<mxCell id="2" value="${label}" vertex="1" parent="1"><mxGeometry x="10" y="10" width="80" height="40" as="geometry"/></mxCell></root>`);

let vault: MemoryVault;
let path: string;
let chat: Scripted;

async function setup(info: EditorInfo) {
  vault = new MemoryVault({});
  path = await vault.createDiagram("Flow", null);
  setEditorBackend({ status: async () => info, install: async () => "installed", cancel: async () => {}, remove: async () => {} });
  useDiagramEditor.setState({ info });
  await useWorkspace.getState().connect({ client: vault });
}

async function mount() {
  const view = render(<DiagramEditor path={path} />);
  const frame = await waitFor(() => {
    const found = view.container.querySelector("iframe");
    if (!found) throw new Error("no frame yet");
    return found;
  });
  const sent: string[] = [];
  vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(((message: unknown) => void sent.push(String(message))) as Window["postMessage"]);
  // The frame's session starts listening in an effect that has to have run before the editor can be spoken for.
  await act(async () => {});
  return { ...view, win: frame.contentWindow!, sent, actions: () => sent.map((m) => JSON.parse(m) as { action: string; xml?: string; layouts?: unknown }) };
}

function say(data: unknown, source: unknown) {
  const event = new MessageEvent("message", { data: JSON.stringify(data), origin: window.location.origin });
  Object.defineProperty(event, "source", { value: source });
  act(() => void window.dispatchEvent(event));
}

const toasts = () => useWorkspace.getState().toasts.map((t) => t.text);

beforeEach(() => {
  localStorage.clear();
  useDiagramHost.setState({ modal: null, queue: [], seen: [], editing: [] });
  useDiagrams.setState({ list: [], loaded: false, templateFor: null });
  useWorkspace.setState({ toasts: [] });
  useShell.setState({ chatOpen: false });
  drafts.clear();
  chat = scriptedChat();
  resetChat(chat);
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:picture-${++n}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  setEditorBackend(null);
  vi.restoreAllMocks();
});

describe("the header's AI tools", () => {
  it("are three buttons with names, beside the export menu", async () => {
    await setup(INSTALLED);
    const { win } = await mount();
    say({ event: "init" }, win);
    say({ event: "load" }, win);
    for (const name of ["Draw with AI", "Check diagram", "Tidy", "Export or copy Flow"]) expect(await screen.findByRole("button", { name }), name).toBeTruthy();
  });

  it("keep Draw with AI and Check diagram when the editor is not installed, and have no Tidy, which is the editor's", async () => {
    await setup(MISSING);
    render(<DiagramEditor path={path} />);
    await screen.findByRole("button", { name: "Draw with AI" });
    expect(screen.getByRole("button", { name: "Check diagram" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Tidy" })).toBeNull();
  });

  it("are not offered for a diagram that cannot be opened", async () => {
    await setup(INSTALLED);
    render(<DiagramEditor path="library/Gone.drawio" />);
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Draw with AI" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Check diagram" })).toBeNull();
  });

  it("offer Tidy once the editor has loaded the diagram, not while it starts", async () => {
    await setup(INSTALLED);
    const { win } = await mount();
    expect(screen.queryByRole("button", { name: "Tidy" })).toBeNull();
    say({ event: "init" }, win);
    expect(screen.queryByRole("button", { name: "Tidy" })).toBeNull();
    say({ event: "load" }, win);
    expect(await screen.findByRole("button", { name: "Tidy" })).toBeTruthy();
  });

  it("start a chat about this diagram when Draw with AI is pressed, with the sentence for the person to finish", async () => {
    await setup(MISSING);
    render(<DiagramEditor path={path} />);
    fireEvent.click(await screen.findByRole("button", { name: "Draw with AI" }));
    const thread = useChat.getState().threads[useChat.getState().active!]!;
    expect(thread.context).toMatchObject([{ kind: "diagram", label: "Flow", ref: [path] }]);
    expect(drafts.get(thread.id)).toBe("Change this diagram: ");
    expect(useShell.getState().chatOpen).toBe(true);
    expect(chat.requests).toEqual([]);
  });

  it("ask the chat to check the diagram when Check diagram is pressed", async () => {
    await setup(MISSING);
    render(<DiagramEditor path={path} />);
    fireEvent.click(await screen.findByRole("button", { name: "Check diagram" }));
    await waitFor(() => expect(chat.requests).toHaveLength(1));
    expect(chat.requests[0]).toMatchObject({ text: BUILT_IN_ACTIONS.find((a) => a.slug === "check-diagram")!.instruction, context: [{ kind: "diagram", label: "Flow", ref: [path] }] });
  });

  it("list the editor's six layouts under Tidy, and ask the editor for the one chosen", async () => {
    await setup(INSTALLED);
    const { win, actions } = await mount();
    say({ event: "init" }, win);
    say({ event: "load" }, win);
    fireEvent.click(await screen.findByRole("button", { name: "Tidy" }));
    const menu = await screen.findByRole("menu");
    // A tree is laid out from a root the editor finds, so those three say they want nothing selected.
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(LAYOUT_PRESETS.map((p) => `${p.label}${p.hint ?? ""}`));
    expect(LAYOUT_PRESETS.filter((p) => p.hint).map((p) => p.id)).toEqual(["verticalTree", "horizontalTree", "radialTree"]);
    await act(async () => fireEvent.click(within(menu).getByRole("menuitem", { name: "Flow, left to right" })));
    await waitFor(() => expect(actions().some((a) => a.action === "layout")).toBe(true));
    expect(actions().find((a) => a.action === "layout")).toEqual({ action: "layout", layouts: [{ layout: "mxHierarchicalLayout", config: { orientation: "west" } }] });
  });

  it("write what is waiting before the layout is asked for", async () => {
    await setup(INSTALLED);
    const { win, actions } = await mount();
    say({ event: "init" }, win);
    say({ event: "load" }, win);
    const read = await vault.diagram(path);
    say({ event: "autosave", xml: withBox(read.xml, "Mine") }, win);
    fireEvent.click(await screen.findByRole("button", { name: "Tidy" }));
    await act(async () => fireEvent.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: "Organic" })));
    await waitFor(() => expect(actions().some((a) => a.action === "layout")).toBe(true));
    expect((await vault.diagram(path)).xml).toContain('value="Mine"');
  });
});

describe("a change applied while the editor is open", () => {
  it("is loaded into the editor when nothing is unsaved, and the person is told", async () => {
    await setup(INSTALLED);
    const { win, actions } = await mount();
    say({ event: "init" }, win);
    say({ event: "load" }, win);
    const read = await vault.diagram(path);
    const changed = withBox(read.xml, "Cache");
    await vault.saveDiagram(path, changed, null, read.hash);
    act(() => diagramFilesChanged([path]));
    await waitFor(() => expect(actions().filter((a) => a.action === "load")).toHaveLength(2));
    expect(actions().filter((a) => a.action === "load").at(-1)).toMatchObject({ xml: changed, autosave: 1 });
    expect(toasts()).toContain("“Flow” changed, and the editor now shows it.");
  });

  it("keeps what the person has drawn and says the next save goes to a copy, once for that version", async () => {
    await setup(INSTALLED);
    const { win, actions } = await mount();
    say({ event: "init" }, win);
    say({ event: "load" }, win);
    const read = await vault.diagram(path);
    say({ event: "autosave", xml: withBox(read.xml, "Mine") }, win);
    await vault.saveDiagram(path, withBox(read.xml, "Theirs"), null, read.hash);
    act(() => diagramFilesChanged([path]));
    await waitFor(() => expect(toasts()).toContain("“Flow” changed elsewhere. Your unsaved edits are kept, and saving puts them in a copy beside it."));
    expect(actions().filter((a) => a.action === "load")).toHaveLength(1);
    act(() => diagramFilesChanged([path]));
    await act(async () => void (await new Promise((done) => setTimeout(done, 30))));
    expect(toasts().filter((t) => t.includes("changed elsewhere"))).toHaveLength(1);
  });

  it("is not a reason to load anything when the change is to another diagram", async () => {
    await setup(INSTALLED);
    const other = await vault.createDiagram("Other", null);
    const { win, actions } = await mount();
    say({ event: "init" }, win);
    say({ event: "load" }, win);
    const read = await vault.diagram(other);
    await vault.saveDiagram(other, withBox(read.xml, "Cache"), null, read.hash);
    act(() => diagramFilesChanged([other]));
    await act(async () => void (await new Promise((done) => setTimeout(done, 30))));
    expect(actions().filter((a) => a.action === "load")).toHaveLength(1);
    expect(toasts()).toEqual([]);
  });
});

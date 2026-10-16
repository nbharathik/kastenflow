// Attachments on the message box: a long paste, a picture or a file from the
// clipboard, files dropped on the box or picked from + Context. They show as
// chips in the box's row, can be looked at, go with the message, and are
// refused in a sentence when they cannot be used.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { refuseStrayDrop } from "../../../shell/file-drops";
import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import type { ModelCapabilities } from "../capabilities";
import { attachEnv, useAttachments } from "../attach-store";
import { pickFiles } from "../pick-files";
import { useChat } from "../store";
import { CLAUDE, resetChat, scriptedChat, type Scripted } from "../test-kit";
import { Conversation } from "./Conversation";

vi.mock("../pick-files", async (original) => ({ ...(await original<typeof import("../pick-files")>()), pickFiles: vi.fn() }));
const imported = vi.hoisted(() => vi.fn());
vi.mock("../../sources/import", () => ({ carriesPdf: () => true, importPdfs: imported, isPdfFile: (f: File) => /\.pdf$/i.test(f.name) }));

let chat: Scripted;

async function show() {
  await useWorkspace.getState().connect({ client: new MemoryVault({}) });
  await useChat.getState().loadProviders();
  const id = useChat.getState().start({ open: true });
  render(<Conversation id={id} variant="full" page={null} />);
  return { id, box: screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement, form: screen.getByRole("form", { name: "Write a message" }) };
}

/** What a paste carries. */
const clip = ({ text = "", html = "", files = [] as File[] }) => ({
  files,
  types: [...(files.length ? ["Files"] : []), ...(text ? ["text/plain"] : []), ...(html ? ["text/html"] : [])],
  getData: (type: string) => (type === "text/plain" ? text : type === "text/html" ? html : ""),
});
/** What a drag carries. */
const drag = (files: File[]) => ({ files, types: ["Files"], dropEffect: "none" });
const png = (name = "shot.png") => new File([new Uint8Array(40)], name, { type: "image/png" });
const type = (box: HTMLElement, value: string) => fireEvent.change(box, { target: { value } });
const row = () => screen.getByRole("group", { name: "Context" });
const attached = (id: string) => useAttachments.getState().byThread[id] ?? [];

const seeing = (over: Partial<ModelCapabilities>): ModelCapabilities => ({
  version: 2,
  route: { kind: "anthropicMessages" },
  model: "model-small",
  family: "test",
  verified: true,
  reasoningEffort: null,
  thinking: null,
  temperature: null,
  maxOutput: null,
  effortRefused: false,
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  imported.mockClear();
  vi.mocked(pickFiles).mockReset();
  chat = scriptedChat([CLAUDE]);
  resetChat(chat);
  useAttachments.setState({ byThread: {} });
  attachEnv.deps = {
    decodeImage: async () => ({ width: 100, height: 100, encode: async () => new Uint8Array(10) }),
    readPdf: async () => ({ text: "--- Page 1 ---\nHello", first: 1, last: 1, total: 1, cut: false }),
    now: () => new Date(2026, 9, 12, 9, 0, 0),
  };
});
afterEach(cleanup);

describe("a long paste", () => {
  it("becomes a chip, and goes back into the box as text on one press", async () => {
    const { id, box } = await show();
    const long = "A line of text\n".repeat(60);
    // The paste is taken: the box is not given 900 characters.
    expect(fireEvent.paste(box, { clipboardData: clip({ text: long }) })).toBe(false);
    await waitFor(() => expect(attached(id)[0]?.state).toBe("ready"));
    expect(box.value).toBe("");
    expect(within(row()).getByText("Pasted text · 900 chars")).toBeTruthy();
    expect(chat.attached[0]).toMatchObject({ name: "Pasted text", kind: "text" });
    // One press puts it in the box instead, and the chip is gone.
    fireEvent.click(within(row()).getByRole("button", { name: "Insert as text instead" }));
    expect(box.value).toBe(long);
    expect(attached(id)).toEqual([]);
    expect(chat.dropped).toEqual(["att-1"]);
  });

  it("is left to the box when it is short", async () => {
    const { id, box } = await show();
    expect(fireEvent.paste(box, { clipboardData: clip({ text: "just a few words" }) })).toBe(true);
    expect(attached(id)).toEqual([]);
  });

  it("is left to the box when five attachments wait already", async () => {
    const { id, box } = await show();
    await act(async () => useAttachments.getState().add(id, Array.from({ length: 5 }, (_, i) => new File(["x"], `n${i}.txt`, { type: "text/plain" }))));
    expect(fireEvent.paste(box, { clipboardData: clip({ text: "word ".repeat(600) }) })).toBe(true);
  });
});

describe("a picture or file from the clipboard", () => {
  it("is attached, with a chip", async () => {
    const { id, box } = await show();
    // A browser calls every pasted picture "image.png": it is named after when it was pasted.
    expect(fireEvent.paste(box, { clipboardData: clip({ files: [png("image.png")] }) })).toBe(false);
    await waitFor(() => expect(attached(id)[0]?.state).toBe("ready"));
    expect(chat.attached[0]).toMatchObject({ kind: "image" });
    expect(within(row()).getByRole("button", { name: "Look at Pasted image 2026-10-12 090000.png" })).toBeTruthy();
  });

  it("does not take the picture that comes with text copied from a page", async () => {
    const { id, box } = await show();
    expect(fireEvent.paste(box, { clipboardData: clip({ text: "Hello", html: "<p>Hello</p><img src='x.png'>", files: [png()] }) })).toBe(true);
    expect(attached(id)).toEqual([]);
  });
});

describe("files dropped on the box", () => {
  it("light the box, are attached, and never reach the window's import of PDFs", async () => {
    window.addEventListener("dragover", refuseStrayDrop);
    window.addEventListener("drop", refuseStrayDrop);
    try {
      const { id, form } = await show();
      const pdf = new File([new Uint8Array(20)], "paper.pdf", { type: "application/pdf" });
      // Cancelled, so the window's guard leaves them alone.
      expect(fireEvent.dragEnter(form, { dataTransfer: drag([pdf]) })).toBe(false);
      expect(fireEvent.dragOver(form, { dataTransfer: drag([pdf]) })).toBe(false);
      expect(form.hasAttribute("data-dragging")).toBe(true);
      fireEvent.dragLeave(form, { relatedTarget: document.body });
      expect(form.hasAttribute("data-dragging")).toBe(false);
      fireEvent.dragOver(form, { dataTransfer: drag([pdf]) });
      expect(fireEvent.drop(form, { dataTransfer: drag([pdf, new File(["# Notes"], "notes.md", { type: "text/markdown" })]) })).toBe(false);
      expect(form.hasAttribute("data-dragging")).toBe(false);
      await waitFor(() => expect(attached(id).filter((a) => a.state === "ready")).toHaveLength(2));
      expect(attached(id).map((a) => a.name)).toEqual(["paper.pdf (page 1)", "notes.md"]);
      expect(imported).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("dragover", refuseStrayDrop);
      window.removeEventListener("drop", refuseStrayDrop);
    }
  });

  it("are not attached, though the drop is still taken, when there is no provider to use them", async () => {
    resetChat(scriptedChat([]));
    const { id, form } = await show();
    expect(fireEvent.drop(form, { dataTransfer: drag([png()]) })).toBe(false);
    expect(attached(id)).toEqual([]);
  });

  it("leave a drag of text alone", async () => {
    const { form } = await show();
    expect(fireEvent.dragOver(form, { dataTransfer: { types: ["text/plain"], files: [] } })).toBe(true);
    expect(form.hasAttribute("data-dragging")).toBe(false);
  });
});

describe("+ Context", () => {
  it("offers Attach a file…, which opens the system's picker", async () => {
    const { id } = await show();
    fireEvent.click(screen.getByRole("button", { name: "+ Context" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Attach a file/ }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(pickFiles).toHaveBeenCalledOnce();
    const chosen = vi.mocked(pickFiles).mock.calls[0]![0];
    await act(async () => chosen([new File(["a,b"], "table.csv", { type: "text/csv" })]));
    await waitFor(() => expect(attached(id)[0]?.state).toBe("ready"));
    expect(within(row()).getByText("table.csv · 3 B")).toBeTruthy();
  });
});

describe("what waits to go", () => {
  async function waiting() {
    const shown = await show();
    await act(async () => useAttachments.getState().add(shown.id, [new File(["# Notes\nSome text"], "notes.md", { type: "text/markdown" })]));
    return shown;
  }

  it("goes with the message, which then shows it; the row is clear for the next", async () => {
    const { id, box } = await waiting();
    type(box, "Summarise this");
    await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
    expect(chat.requests[0]!.attachments).toEqual([{ id: "att-1", name: "notes.md", kind: "text" }]);
    expect(attached(id)).toEqual([]);
    const sent = within(screen.getByRole("log")).getByRole("group", { name: "Attachments" });
    expect(within(sent).getByRole("button", { name: "Look at notes.md" })).toBeTruthy();
  });

  it("is the message's even when its answer fails: the question keeps it, to ask again", async () => {
    const { id, box } = await waiting();
    type(box, "Summarise this");
    chat.failNext("The Claude API did not answer");
    await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
    expect(attached(id)).toEqual([]);
    expect(within(screen.getByRole("log")).getByRole("group", { name: "Attachments" })).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry" })));
    expect(chat.requests[0]!.attachments).toEqual([{ id: "att-1", name: "notes.md", kind: "text" }]);
  });

  it("is waited for while it is read: nothing is sent in between", async () => {
    const { id, box } = await show();
    let finish: () => void = () => {};
    const gate = new Promise<void>((done) => (finish = done));
    const attach = chat.attach.bind(chat);
    vi.spyOn(chat, "attach").mockImplementation(async (name, kind, bytes) => {
      await gate;
      return attach(name, kind, bytes);
    });
    act(() => void useAttachments.getState().add(id, [new File(["x"], "slow.txt", { type: "text/plain" })]));
    type(box, "Look at this");
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
    expect(chat.requests).toHaveLength(0);
    await act(async () => finish());
    await waitFor(() => expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("is removed from the chip, and what was kept for it is let go of", async () => {
    const { id } = await waiting();
    fireEvent.click(within(row()).getByRole("button", { name: "Remove notes.md" }));
    expect(attached(id)).toEqual([]);
    expect(chat.dropped).toEqual(["att-1"]);
  });
});

describe("a file that cannot be used", () => {
  it("stays as a chip that says why, until it is dismissed", async () => {
    const { id } = await show();
    await act(async () => useAttachments.getState().add(id, [new File([new Uint8Array([0x50, 0x4b, 0, 1])], "bundle.zip", { type: "application/zip" })]));
    const chip = within(row()).getByRole("status");
    expect(chip.textContent).toMatch(/bundle\.zip/);
    expect(chip.textContent).toMatch(/PNG, JPEG, GIF or WebP/);
    fireEvent.click(within(chip).getByRole("button", { name: "Dismiss: bundle.zip" }));
    expect(within(row()).queryByRole("status")).toBeNull();
  });
});

describe("a chip too narrow for its sentence", () => {
  it("opens the whole of it", async () => {
    const { id } = await show();
    await act(async () => useAttachments.getState().add(id, [new File([new Uint8Array([0x50, 0x4b, 0, 1])], "bundle.zip", { type: "application/zip" })]));
    fireEvent.click(within(within(row()).getByRole("status")).getByRole("button", { name: /isn't a kind of file/ }));
    const popover = await screen.findByRole("dialog", { name: "Attachment: bundle.zip" });
    expect(popover.textContent).toContain("Attach text, a PDF or a picture (PNG, JPEG, GIF or WebP).");
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Attachment: bundle.zip" })).toBeNull();
  });
});

describe("looking at an attachment", () => {
  it("opens it in a popover that Escape closes", async () => {
    const { id } = await show();
    await act(async () => useAttachments.getState().add(id, [new File(["First line\nSecond line"], "notes.md", { type: "text/markdown" })]));
    fireEvent.click(within(row()).getByRole("button", { name: "Look at notes.md" }));
    const popover = await screen.findByRole("dialog", { name: "Attachment: notes.md" });
    await within(popover).findByText(/First line/);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Attachment: notes.md" })).toBeNull();
  });

  it("shows a long paste as it was pasted", async () => {
    const { id, box } = await show();
    fireEvent.paste(box, { clipboardData: clip({ text: "Pasted words\n".repeat(60) }) });
    await waitFor(() => expect(attached(id)[0]?.state).toBe("ready"));
    fireEvent.click(within(row()).getByRole("button", { name: "Look at Pasted text" }));
    const popover = await screen.findByRole("dialog", { name: "Attachment: Pasted text" });
    expect(popover.textContent).toContain("Pasted words");
    expect(within(popover).getByRole("button", { name: "Insert as text instead" })).toBeTruthy();
  });
});

describe("a picture for a model that may not see it", () => {
  it("says so on the chip, and never drops it quietly", async () => {
    chat.capabilities = seeing({ vision: false, visionKnown: true });
    const { id } = await show();
    await act(async () => useAttachments.getState().add(id, [png()]));
    await waitFor(() => expect(row().querySelector("[data-warn]")).toBeTruthy());
    expect(row().querySelector("[data-warn]")!.getAttribute("title")).toContain("This model can't read pictures.");
    // Looking at it says it in words, and offers no way to send it anyway: it is known not to see.
    fireEvent.click(within(row()).getByRole("button", { name: "Look at shot.png" }));
    const popover = await screen.findByRole("dialog", { name: "Attachment: shot.png" });
    expect(within(popover).getByText("This model can't read pictures.")).toBeTruthy();
    expect(within(popover).queryByRole("checkbox")).toBeNull();
  });

  it("can be sent anyway to a model that is not known to refuse them", async () => {
    chat.capabilities = seeing({ vision: false, visionKnown: false });
    const { id, box } = await show();
    await act(async () => useAttachments.getState().add(id, [png()]));
    await waitFor(() => expect(row().querySelector("[data-warn]")).toBeTruthy());
    fireEvent.click(within(row()).getByRole("button", { name: "Look at shot.png" }));
    const popover = await screen.findByRole("dialog", { name: "Attachment: shot.png" });
    expect(within(popover).getByText("This model may not read pictures.")).toBeTruthy();
    fireEvent.click(within(popover).getByRole("checkbox", { name: "Send pictures to this model anyway" }));
    expect(useChat.getState().threads[id]!.allowImages).toBe(true);
    // The warning is answered: the chip is quiet.
    await waitFor(() => expect(row().querySelector("[data-warn]")).toBeNull());
    fireEvent.keyDown(document.body, { key: "Escape" });
    type(box, "What is this?");
    await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
    expect(chat.requests[0]!.settings).toEqual({ allowImages: true });
  });

  it("says nothing for a model that reads them", async () => {
    chat.capabilities = seeing({ vision: true, visionKnown: true });
    const { id } = await show();
    await act(async () => useAttachments.getState().add(id, [png()]));
    await waitFor(() => expect(attached(id)[0]?.state).toBe("ready"));
    expect(row().querySelector("[data-warn]")).toBeNull();
  });
});

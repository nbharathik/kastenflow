import { beforeEach, describe, expect, it } from "vitest";

import type { AttachDeps, ImageSource } from "./attachments";
import { MAX_ATTACHMENTS } from "./attachments";
import { attachEnv, useAttachments } from "./attach-store";
import { useChat } from "./store";
import { CLAUDE, resetChat, scriptedChat, type Scripted } from "./test-kit";

let chat: Scripted;
let id: string;
const store = () => useAttachments.getState();
const items = () => store().byThread[id] ?? [];
const file = (text: string, name: string, type = "text/plain") => new File([text], name, { type });

const picture = (width: number, height: number): ImageSource => ({ width, height, encode: async () => new Uint8Array(10) });

function fakeDeps(over: Partial<AttachDeps> = {}): AttachDeps {
  return {
    decodeImage: async () => picture(100, 100),
    readPdf: async () => ({ text: "--- Page 1 ---\nHello", first: 1, last: 1, total: 1, cut: false }),
    now: () => new Date(2026, 9, 12, 9, 0, 0),
    ...over,
  };
}

beforeEach(() => {
  localStorage.clear();
  chat = scriptedChat([CLAUDE]);
  resetChat(chat);
  useAttachments.setState({ byThread: {} });
  attachEnv.deps = fakeDeps();
  id = useChat.getState().start({ open: true });
});

describe("attaching files", () => {
  it("keeps a text file with the backend and shows it as a chip when it is ready", async () => {
    const adding = store().add(id, [file("a,b\n1,2\n", "numbers.csv", "text/csv")]);
    expect(items()).toMatchObject([{ name: "numbers.csv", state: "busy" }]);
    await adding;
    expect(items()).toMatchObject([{ name: "numbers.csv", state: "ready", kind: "text", id: "att-1", label: "numbers.csv · 8 B" }]);
    expect(chat.attached.map((a) => [a.name, a.kind])).toEqual([["numbers.csv", "text"]]);
  });

  it("keeps a long paste as text it can give back", async () => {
    const text = "word ".repeat(600);
    expect(await store().addText(id, text)).toBe(true);
    expect(items()[0]).toMatchObject({ name: "Pasted text", state: "ready", label: "Pasted text · 3,000 chars", pasted: text });
    // "Insert as text instead": the chip goes, the backend is told, and the text comes back.
    const key = items()[0]!.key;
    expect(store().asText(id, key)).toBe(text);
    expect(items()).toEqual([]);
    expect(chat.dropped).toEqual(["att-1"]);
  });

  it("does not take a short paste", async () => {
    expect(await store().addText(id, "just a few words")).toBe(false);
    expect(items()).toEqual([]);
  });

  it("turns a refused file into a chip that says why, and can be dismissed", async () => {
    await store().add(id, [new File([new Uint8Array([0x50, 0x4b, 0, 1])], "bundle.zip", { type: "application/zip" })]);
    expect(items()).toMatchObject([{ name: "bundle.zip", state: "error" }]);
    expect(items()[0]!.error).toMatch(/bundle\.zip/);
    expect(chat.attached).toEqual([]);
    store().remove(id, items()[0]!.key);
    expect(items()).toEqual([]);
    // Nothing was kept, so nothing is dropped.
    expect(chat.dropped).toEqual([]);
  });

  it("says why when the backend refuses what the window accepted", async () => {
    chat.failNext("This model can't read pictures");
    await store().add(id, [file("hi", "a.txt")]);
    expect(items()).toMatchObject([{ state: "error", error: "This model can't read pictures" }]);
  });

  it("takes at most five a message, and says so for the rest", async () => {
    const many = Array.from({ length: MAX_ATTACHMENTS + 2 }, (_, i) => file(`text ${i}`, `n${i}.txt`));
    await store().add(id, many);
    const ready = items().filter((a) => a.state === "ready");
    expect(ready).toHaveLength(MAX_ATTACHMENTS);
    expect(items().filter((a) => a.state === "error")).toMatchObject([{ error: expect.stringMatching(/at most 5/i) }]);
    // Full: another file is refused at once.
    await store().add(id, [file("one more", "extra.txt")]);
    expect(items().filter((a) => a.state === "ready")).toHaveLength(MAX_ATTACHMENTS);
    expect(chat.attached).toHaveLength(MAX_ATTACHMENTS);
  });

  it("scales a picture and keeps what it made", async () => {
    attachEnv.deps = fakeDeps({ decodeImage: async () => picture(4000, 3000) });
    await store().add(id, [new File([new Uint8Array(100)], "big.jpg", { type: "image/jpeg" })]);
    expect(items()[0]).toMatchObject({ state: "ready", kind: "image", width: 2048, height: 1536, note: expect.stringContaining("Scaled down") });
    expect(chat.attached[0]).toMatchObject({ name: "big.jpg", kind: "image" });
  });

  it("reads a PDF in the window and keeps its text, named for the pages", async () => {
    await store().add(id, [new File([new Uint8Array(30)], "paper.pdf", { type: "application/pdf" })]);
    expect(items()[0]).toMatchObject({ state: "ready", kind: "text", name: "paper.pdf (page 1)" });
    expect(new TextDecoder().decode(chat.attached[0]!.bytes)).toContain("Hello");
  });

  it("lets go of an attachment removed before it is sent", async () => {
    await store().add(id, [file("hi", "a.txt")]);
    store().remove(id, items()[0]!.key);
    expect(chat.dropped).toEqual(["att-1"]);
  });

  it("hands the ready ones to a message and clears the row, a failed chip with it", async () => {
    await store().add(id, [file("hi", "a.txt"), new File([new Uint8Array([0, 1])], "x.zip", { type: "application/zip" })]);
    expect(store().busy(id)).toBe(false);
    const taken = store().take(id);
    expect(taken.map((a) => a.id)).toEqual(["att-1"]);
    expect(items()).toEqual([]);
    // Taken, so a removal later does not drop what a message holds.
    expect(chat.dropped).toEqual([]);
  });

  it("says it is busy while a file is being read", async () => {
    const adding = store().add(id, [file("hi", "a.txt")]);
    expect(store().busy(id)).toBe(true);
    await adding;
    expect(store().busy(id)).toBe(false);
  });
});

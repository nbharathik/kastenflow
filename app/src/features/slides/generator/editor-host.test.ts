// The editor's part of code pictures in Kasten: the inputs a picture declares are read from the vault, the code runs in the sandbox, and
// the picture comes back as bytes. The sandbox, the vault and the app's commands are stand-ins.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FrameHost } from "./sandbox";
import { generatorHost, readInputs, runForEditor, wordsOfPage } from "./editor-host";

const commands = vi.hoisted(() => ({
  textAsset: vi.fn(async (path: string) => `csv of ${path}`),
  generatorAllowed: vi.fn(async (_deck: string, _hash: string) => false),
  allowGenerator: vi.fn(async (_deck: string, _hash: string) => undefined),
  libraryList: vi.fn(async () => [] as { path: string; id: string; label: string; language: string; output: string; problem: string | null }[]),
  libraryRead: vi.fn(async (_path: string) => ({ text: "{}" })),
  librarySave: vi.fn(async (_text: string) => ({ path: "templates/generators/x.generator", replaced: false })),
}));

vi.mock("./backend", () => ({
  ...commands,
  answerApp: vi.fn(),
  tauriGeneratorBackend: { openFrame: vi.fn(), closeFrame: vi.fn() },
}));

const client = { read: vi.fn(async (path: string) => ({ meta: {} as never, hash: "h", text: `---\ntitle: ${path}\n---\nJan: 3\nFeb: 5\n` })) };

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"></svg>';

/** A sandbox that draws `svg` for any code, or fails with `error`. */
function sandbox(answer: { svg: string } | { error: string; line?: number }): FrameHost {
  return {
    async open(onMessage) {
      queueMicrotask(() => onMessage({ type: "ready" }));
      return {
        post(message) {
          const id = (message as { id: string }).id;
          queueMicrotask(() => onMessage("svg" in answer ? { type: "result", id, svg: answer.svg, logs: ["rows: 2"], warnings: ["w"] } : { type: "error", id, message: answer.error, line: answer.line ?? null, column: null }));
        },
        close() {},
      };
    },
  };
}

const request = (extra: Partial<Parameters<typeof runForEditor>[1]> = {}): Parameters<typeof runForEditor>[1] => ({
  language: "js",
  code: "return 1;",
  inputs: [],
  output: "svg",
  theme: { accent1: "#2563eb" },
  ...extra,
});

const png = (width: number, height: number): Uint8Array => {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
};

beforeEach(() => vi.clearAllMocks());

describe("what a picture may read", () => {
  it("is the text itself, a text file of the vault's assets, or the words of a page", async () => {
    const inputs = await readInputs(client, [
      { name: "sales", kind: "data", value: "a,b\n1,2\n" },
      { name: "csv", kind: "asset", value: "assets/sales.csv" },
      { name: "notes", kind: "note", value: "library/notes.md" },
    ]);
    expect(inputs).toEqual([
      { name: "sales", text: "a,b\n1,2\n" },
      { name: "csv", text: "csv of assets/sales.csv" },
      { name: "notes", text: "Jan: 3\nFeb: 5\n" },
    ]);
    expect(commands.textAsset).toHaveBeenCalledWith("assets/sales.csv");
    expect(client.read).toHaveBeenCalledWith("library/notes.md");
  });

  it("says which input could not be read and why, and refuses one that is too big", async () => {
    commands.textAsset.mockRejectedValueOnce("`assets/gone.csv` is not a path in the vault.");
    await expect(readInputs(client, [{ name: "csv", kind: "asset", value: "assets/gone.csv" }])).rejects.toThrow("The input csv could not be read: `assets/gone.csv` is not a path in the vault.");
    await expect(readInputs(client, [{ name: "big", kind: "data", value: "x".repeat(1024 * 1024 + 1) }])).rejects.toThrow("The input big is larger than 1 MB.");
  });

  it("is a page without the header between the --- lines", () => {
    expect(wordsOfPage("---\ntitle: x\n---\nbody\n")).toBe("body\n");
    expect(wordsOfPage("﻿---\r\ntitle: x\r\n---\r\nbody")).toBe("body");
    expect(wordsOfPage("no header\n---\nnot a header\n")).toBe("no header\n---\nnot a header\n");
  });
});

describe("running a picture's code for the editor", () => {
  it("answers with the SVG as bytes, its size, what it read and what it said", async () => {
    const result = await runForEditor(client, request({ inputs: [{ name: "sales", kind: "data", value: "a" }] }), sandbox({ svg: SVG }));
    expect(result).toMatchObject({ ok: true, kind: "svg", width: 320, height: 180, inputs: [{ name: "sales", text: "a" }], warnings: ["w"], logs: ["rows: 2"] });
    if (!result.ok) throw new Error("did not run");
    expect(new TextDecoder().decode(result.bytes)).toBe(SVG);
    expect(result.at).toBeGreaterThan(1_700_000_000_000);
  });

  it("answers with a PNG when one is asked for, and refuses one that is too big or cannot be drawn", async () => {
    const result = await runForEditor(client, request({ output: "png" }), sandbox({ svg: SVG }), async () => png(640, 360));
    expect(result).toMatchObject({ ok: true, kind: "png", width: 640, height: 360 });
    const heavy = await runForEditor(client, request({ output: "png" }), sandbox({ svg: SVG }), async () => {
      const big = new Uint8Array(2 * 1024 * 1024 + 1);
      big.set(png(10, 10));
      return big;
    });
    expect(heavy).toMatchObject({ ok: false, error: { message: expect.stringContaining("too big") } });
    const notPng = await runForEditor(client, request({ output: "png" }), sandbox({ svg: SVG }), async () => new Uint8Array(40));
    expect(notPng.ok).toBe(false);
    const tainted = await runForEditor(client, request({ output: "png" }), sandbox({ svg: SVG }), async () => Promise.reject(new Error("tainted canvas")));
    expect(tainted).toEqual({ ok: false, error: { message: "tainted canvas" } });
  });

  it("answers with the error and its line, or with why an input could not be read, without running anything", async () => {
    expect(await runForEditor(client, request(), sandbox({ error: "ReferenceError: x is not defined", line: 4 }))).toEqual({ ok: false, error: { message: "ReferenceError: x is not defined", line: 4 } });
    const open = vi.fn();
    const never: FrameHost = { open };
    commands.textAsset.mockRejectedValueOnce(new Error("nothing there"));
    const unread = await runForEditor(client, request({ inputs: [{ name: "csv", kind: "asset", value: "assets/x.csv" }] }), never);
    expect(unread).toEqual({ ok: false, error: { message: "The input csv could not be read: nothing there" } });
    expect(open).not.toHaveBeenCalled();
    const sizeless = await runForEditor(client, request(), sandbox({ svg: "<svg></svg>" }));
    expect(sizeless).toMatchObject({ ok: false, error: { message: expect.stringContaining("no usable size") } });
  });
});

describe("the host members", () => {
  it("keep the allow by deck and the hash of the code, and list the library without its broken entries", async () => {
    const host = generatorHost(client, "library/talk.deck");
    // The SHA-256 of "abc", which the app's own hash of the same code (see the app's tests) is the same as.
    const abc = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    await host.generatorTrust!.allowed("abc");
    await host.generatorTrust!.allow("abc");
    expect(commands.generatorAllowed).toHaveBeenCalledWith("library/talk.deck", abc);
    expect(commands.allowGenerator).toHaveBeenCalledWith("library/talk.deck", abc);
    commands.libraryList.mockResolvedValueOnce([
      { path: "templates/generators/a.generator", id: "G-a", label: "Bars", language: "js", output: "svg", problem: null },
      { path: "templates/generators/b.generator", id: "", label: "Broken", language: "", output: "", problem: "Not a KastenFlow code picture" },
      { path: "templates/generators/c.generator", id: "G-c", label: "Photo", language: "js", output: "png", problem: null },
    ]);
    expect(await host.generatorLibrary!.list()).toEqual([
      { path: "templates/generators/a.generator", id: "G-a", label: "Bars", output: "svg" },
      { path: "templates/generators/c.generator", id: "G-c", label: "Photo", output: "png" },
    ]);
    expect(await host.generatorLibrary!.read("templates/generators/a.generator")).toBe("{}");
    expect(await host.generatorLibrary!.save("text")).toEqual({ path: "templates/generators/x.generator", replaced: false });
  });
});

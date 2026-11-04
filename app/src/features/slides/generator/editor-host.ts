// The Slides editor's part of code pictures inside Kasten: running a picture's code in the window's sandbox (reading the inputs
// the picture declared from the vault, as a read-only person's request), who may run an agent's code for a deck, and the library
// of code pictures kept for every deck. The package never runs code or reads a file; it asks for these.

import type { GeneratorRequest, GeneratorResult, SlidesHost } from "@kasten-slides/react";

import type { VaultClient } from "../../../lib/vault/types";
import { allowGenerator, generatorAllowed, libraryList, libraryRead, librarySave, textAsset } from "./backend";
import { domFrameHost } from "./frame";
import { type FrameHost, runCode } from "./sandbox";
import { pngSize, svgSize } from "./svg";
import { MAX_SVG_CHARS } from "./types";

/** How long a person's code may run before the frame is ended. */
export const RUN_MS = 10_000;
/** The most text one input may hold, as the app checks it too. */
const MOST_INPUT_CHARS = 1024 * 1024;
/** A picture drawn as a PNG: twice the size, no side over this, no file over this many bytes. */
const PNG_SIDE = 4000;
const PNG_BYTES = 2 * 1024 * 1024;

type Members = Pick<SlidesHost, "runGenerator" | "generatorTrust" | "generatorLibrary">;

/** What a page of the vault reads as: its words, without the header between the `---` lines. */
export function wordsOfPage(text: string): string {
  const bare = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return bare.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "");
}

/** The text of each input the picture declared, in order. Rejects with a sentence when one cannot be read. */
export async function readInputs(client: Pick<VaultClient, "read">, inputs: GeneratorRequest["inputs"]): Promise<{ name: string; text: string }[]> {
  const out: { name: string; text: string }[] = [];
  for (const input of inputs) {
    let text: string;
    try {
      text = input.kind === "data" ? input.value : input.kind === "asset" ? await textAsset(input.value) : wordsOfPage((await client.read(input.value)).text);
    } catch (err) {
      throw new Error(`The input ${input.name} could not be read: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
    if (text.length > MOST_INPUT_CHARS) throw new Error(`The input ${input.name} is larger than 1 MB.`);
    out.push({ name: input.name, text });
  }
  return out;
}

/** Runs a picture's code for the editor and answers with the picture; never rejects. */
export async function runForEditor(
  client: Pick<VaultClient, "read">,
  request: GeneratorRequest,
  host: FrameHost = domFrameHost(),
  draw?: (svg: string) => Promise<Uint8Array>,
): Promise<GeneratorResult> {
  let inputs: { name: string; text: string }[];
  try {
    inputs = await readInputs(client, request.inputs);
  } catch (err) {
    return { ok: false, error: { message: err instanceof Error ? err.message : String(err) } };
  }
  const outcome = await runCode({ code: request.code, inputs: Object.fromEntries(inputs.map((i) => [i.name, i.text])), theme: request.theme, timeoutMs: RUN_MS }, host);
  if (!outcome.ok) return outcome;
  const size = svgSize(outcome.svg);
  if (!size) return { ok: false, error: { message: "The SVG has no usable size: give <svg> a width and a height, or a viewBox (kit.svg does)." } };
  if (outcome.svg.length > MAX_SVG_CHARS) return { ok: false, error: { message: "The picture is larger than 1 MB." } };
  const common = { inputs, warnings: outcome.warnings, logs: outcome.logs, at: Date.now() };
  if (request.output === "svg") {
    return { ok: true, kind: "svg", bytes: new TextEncoder().encode(outcome.svg), width: Math.round(size.width), height: Math.round(size.height), ...common };
  }
  try {
    const drawn = await (draw ?? ((svg: string) => import("../../diagrams/picture").then((m) => m.pngOfSvg(svg, 2, PNG_SIDE, "transparent"))))(outcome.svg);
    const png = pngSize(drawn);
    if (!png || drawn.length > PNG_BYTES) return { ok: false, error: { message: "The picture is too big to keep as a PNG: draw it smaller, or make it an SVG." } };
    return { ok: true, kind: "png", bytes: drawn, width: png.width, height: png.height, ...common };
  } catch (err) {
    return { ok: false, error: { message: err instanceof Error ? err.message : "The picture could not be drawn as a PNG." } };
  }
}

/** The SHA-256 of the code, in hex: what the app keeps a person's "Allow to run" for (the same as the app's own hash of it). */
export async function codeHash(code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The host members for code pictures, for the deck at `deckPath`. */
export function generatorHost(client: Pick<VaultClient, "read">, deckPath: string): Members {
  return {
    runGenerator: (request) => runForEditor(client, request),
    generatorTrust: {
      allowed: async (code) => generatorAllowed(deckPath, await codeHash(code)),
      allow: async (code) => allowGenerator(deckPath, await codeHash(code)),
    },
    generatorLibrary: {
      list: async () =>
        (await libraryList())
          .filter((entry) => !entry.problem)
          .map((entry) => ({ path: entry.path, id: entry.id, label: entry.label, output: entry.output === "png" ? ("png" as const) : ("svg" as const) })),
      read: async (path) => (await libraryRead(path)).text,
      save: (text) => librarySave(text),
    },
  };
}

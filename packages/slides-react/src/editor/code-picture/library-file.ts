// The file a code picture is kept in for every deck: a small JSON text the host stores (Kasten: a `.generator` file in the
// vault's templates). The host keeps the text as it is given; this makes and reads it.

import type { GeneratorInput } from "@kasten-slides/wasm";

import { LANGUAGE, type Program } from "./types.ts";

/** What the file says it is. */
export const FORMAT = "kasten-generator";
export const FORMAT_VERSION = 1;

/** A new id: letters, digits, `-` and `_`, as the host requires. */
export function newId(): string {
  return `G-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** The text of a library file for `program`, called `label`. */
export function libraryText(id: string, label: string, program: Program): string {
  const file = {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    id,
    label: label.trim(),
    generator: { language: program.language, code: program.code, inputs: program.inputs, output: program.output },
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** A library file read: its id, name and program; undefined when the text is not one. */
export function parseLibraryText(text: string): { id: string; label: string; program: Program } | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const file = value as Record<string, unknown>;
  const generator = file["generator"];
  if (file["format"] !== FORMAT || typeof file["id"] !== "string" || typeof file["label"] !== "string" || !generator || typeof generator !== "object") return undefined;
  const g = generator as Record<string, unknown>;
  if (g["language"] !== LANGUAGE || typeof g["code"] !== "string") return undefined;
  const inputs: GeneratorInput[] = [];
  for (const raw of Array.isArray(g["inputs"]) ? g["inputs"] : []) {
    const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : undefined;
    const name = input?.["name"];
    const value = input?.["value"];
    const kind = input?.["kind"];
    if (typeof name === "string" && typeof value === "string" && (kind === "asset" || kind === "note" || kind === "data")) inputs.push({ name, kind, value });
  }
  return { id: file["id"], label: file["label"], program: { language: LANGUAGE, code: g["code"], inputs, output: g["output"] === "png" ? "png" : "svg" } };
}

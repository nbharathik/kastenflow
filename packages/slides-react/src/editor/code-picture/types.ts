// What a host is asked to run for a code picture, and what it answers. The Slides package never runs the
// code itself and never reads the host's files: the host runs it where it is safe to (Kasten: a sandboxed
// frame with no network and no vault), reads the inputs the picture declared (a file of the image store, a
// page, or the text itself), and hands back the picture. The package keeps the code inside the picture.

import type { GeneratorInput, GeneratorOutput, PictureGenerator } from "@kasten-slides/wasm";

/** The language there is for now. */
export const LANGUAGE = "js";

/** What the host runs. */
export interface GeneratorRequest {
  language: typeof LANGUAGE;
  code: string;
  /** What the code may read, as the picture declared it; the host reads each one. */
  inputs: GeneratorInput[];
  output: GeneratorOutput;
  /** The deck's colours by token (`text1`, `bg1`, `accent1` …) as `#rrggbb`, for the drawing kit. */
  theme: Record<string, string>;
}

/** Where in the code something went wrong. */
export interface CodeError {
  message: string;
  /** From 1, in the code as written. */
  line?: number;
  column?: number;
}

/** What an input held when the code ran, as text. */
export interface InputText {
  name: string;
  text: string;
}

export type GeneratorResult =
  | {
      ok: true;
      /** What `bytes` are: the SVG as text (UTF-8), or a PNG. */
      kind: GeneratorOutput;
      bytes: Uint8Array;
      width: number;
      height: number;
      /** A PNG of an SVG, when the host could draw one. */
      preview?: Uint8Array;
      /** What the inputs held, to tell later whether they changed. */
      inputs: InputText[];
      warnings: string[];
      logs: string[];
      /** When it ran, in milliseconds since 1970. */
      at: number;
    }
  | { ok: false; error: CodeError };

/** Whether this very code, which an agent wrote, may run in this deck: a person's "Allow to run", kept by the host for the code (by its hash). Changed code asks again. */
export interface GeneratorTrust {
  allowed(code: string): Promise<boolean>;
  allow(code: string): Promise<void>;
}

/** A code picture kept for every deck. */
export interface GeneratorLibraryEntry {
  /** Where the host keeps it. */
  path: string;
  id: string;
  label: string;
  output: GeneratorOutput;
}

/** The code pictures the host keeps for every deck. A host without them leaves this out and the editor offers no library. */
export interface GeneratorLibraryHost {
  list(): Promise<GeneratorLibraryEntry[]>;
  /** One entry's file, as text. */
  read(path: string): Promise<string>;
  /** Keeps a file; resolves to where, and whether it replaced an entry of the same id. */
  save(text: string): Promise<{ path: string; replaced: boolean }>;
}

/** The program of a picture without its bookkeeping: what a template holds and what the panel edits. */
export type Program = Pick<PictureGenerator, "language" | "code" | "inputs" | "output">;

/** A way to begin: a program with a name. */
export interface Template {
  id: string;
  label: string;
  description: string;
  program: Program;
}

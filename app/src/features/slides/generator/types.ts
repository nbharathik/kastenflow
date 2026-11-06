// Running the code of a code picture in the window: the shapes of what the sandbox is given and answers with. The sandbox is a
// frame of the `smart` scheme with scripts and nothing else (see `frame.ts`); it gets the code and the text of the inputs in one
// message and answers with one, so these shapes are all that crosses the wall, and the window checks every field it reads.

/** The id the app knows a generator frame by, and the folder its runner is served from. */
export const GENERATOR_ID = "generator";

/** What the sandbox runs. */
export interface RunRequest {
  code: string;
  /** The text of each input, by the name the code reads it with. */
  inputs: Record<string, string>;
  /** The deck's colours by token, for the drawing kit. */
  theme: Record<string, string>;
  /** How long the code may run before the frame is ended, in milliseconds. */
  timeoutMs: number;
}

/** Where in the code something went wrong. */
export interface CodeError {
  message: string;
  line?: number;
  column?: number;
}

export type RunOutcome = { ok: true; svg: string; logs: string[]; warnings: string[] } | { ok: false; error: CodeError };

/** What a frame says to the window. Anything else it posts is ignored. */
export type FrameMessage =
  | { type: "ready" }
  | { type: "result"; id: string; svg: string; logs: string[]; warnings: string[] }
  | { type: "error"; id: string; message: string; line: number | null; column: number | null };

/** The longest SVG the window takes from a frame, in characters. */
export const MAX_SVG_CHARS = 1024 * 1024;
/** The most lines of logs and warnings, and the longest of each. */
export const MOST_LINES = 50;
export const LINE_CHARS = 300;

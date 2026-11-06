// An agent asked the app to run the code of a code picture. The app hands this window the code and the text of what it may read
// (it read the inputs from the vault, as the agent could); the window runs it in the sandbox and answers with text: the SVG the
// code drew (and a look at it as a PNG), or the PNG, or the error with the line of the code. The app checks what comes back before
// anyone uses it. Nothing here touches the vault.

import { base64Of, drawWithin } from "../../diagrams/draw-png";
import { answerApp } from "./backend";
import { domFrameHost } from "./frame";
import { type FrameHost, runCode } from "./sandbox";
import type { CodeError } from "./types";

/** What the app asks the window to run. */
export interface RunJob {
  id: string;
  /** The deck the picture is for (a vault path), or empty. */
  deck: string | null;
  /** The agent's client when an agent asked; null when the person's own code is run. */
  agent: string | null;
  output: "svg" | "png";
  timeoutMs: number;
  code: string;
  inputs: { name: string; text: string }[];
  theme: Record<string, string>;
  maxSvg: number;
  maxPng: number;
  maxSide: number;
}

/** What draws a PNG from an SVG, and where the answer goes; a test gives its own. */
export interface AnswerDeps {
  host: FrameHost;
  draw(svg: string, scale: number, maxSide: number, background: string): Promise<Uint8Array>;
  answer(id: string, answer: { text: string } | { error: string }): Promise<unknown>;
}

const realDeps: AnswerDeps = {
  get host() {
    return domFrameHost();
  },
  draw: async (svg, scale, maxSide, background) => (await import("../../diagrams/picture")).pngOfSvg(svg, scale, maxSide, background),
  answer: answerApp,
};

/** A look at a picture for the agent is small. */
const PREVIEW_BYTES = 1024 * 1024;
const PREVIEW_SIDE = 800;

/** An error of the code in the words an agent reads: the line first. */
export function errorWords(error: CodeError): string {
  return error.line ? `Line ${error.line}: ${error.message}` : error.message;
}

/** Runs one job and tells the app what came of it. Never throws: the app is told why instead. */
export async function answerRunJob(job: RunJob, deps: AnswerDeps = realDeps): Promise<void> {
  try {
    const inputs = Object.fromEntries(job.inputs.map((input) => [input.name, input.text]));
    const outcome = await runCode({ code: job.code, inputs, theme: job.theme, timeoutMs: job.timeoutMs }, deps.host);
    if (!outcome.ok) {
      await deps.answer(job.id, { error: errorWords(outcome.error) });
      return;
    }
    const told = { warnings: outcome.warnings, logs: outcome.logs };
    const drawJob = (scale: number, maxSide: number, maxBytes: number) => ({ id: job.id, svg: outcome.svg, background: "transparent", scale, maxSide, maxBytes });
    if (job.output === "png") {
      const png = await drawWithin(drawJob(2, job.maxSide, job.maxPng), deps.draw);
      await deps.answer(job.id, { text: JSON.stringify({ output: "png", png_base64: base64Of(png), ...told }) });
      return;
    }
    // A look at the drawing for the agent; a picture the canvas cannot draw is still a picture.
    const preview = await drawWithin(drawJob(1, PREVIEW_SIDE, PREVIEW_BYTES), deps.draw).then(base64Of, () => undefined);
    await deps.answer(job.id, { text: JSON.stringify({ output: "svg", svg: outcome.svg, ...(preview ? { preview_png_base64: preview } : {}), ...told }) });
  } catch (err) {
    const why = err instanceof Error ? err.message : "This window could not run the code";
    // If even telling fails the request times out on the app's side.
    await deps.answer(job.id, { error: why }).catch(() => {});
  }
}

// Running the program of a code picture and putting the picture it draws in the place of the old one. The
// host runs the code (the package never does); this keeps the new picture in the host's image store, notes
// the run in the picture's `generator` block and swaps it in with one operation, so one undo brings the old
// picture back. The old picture stays in the store: nothing is deleted.

import type { Element, PatchElements, PictureGenerator } from "@kasten-slides/wasm";

import { fitted, image } from "../factory.ts";
import type { SlidesHost } from "../host.ts";
import type { Patch } from "../session/elements.ts";
import { findElement } from "../session/scope.ts";
import type { EditorSession } from "../session/session.ts";
import { GENERATOR_KEY, codePictures, fileNameFor, generatorOf, inputsHash, problemOf, refit, runHash, themeOf } from "./model.ts";
import type { CodeError, GeneratorRequest, GeneratorResult, Program } from "./types.ts";

/** How a run came out. */
export type RunReport =
  | { status: "done"; id: string; path: string; unchanged: boolean; warnings: string[]; logs: string[] }
  | { status: "error"; error: CodeError }
  /** Code an agent wrote, for a deck whose code a person has not allowed yet. */
  | { status: "needs-allow" }
  | { status: "unavailable"; why: string };

type Ran = Extract<GeneratorResult, { ok: true }>;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** What the host is asked to run for a program. */
export function requestFor(session: EditorSession, program: Program): GeneratorRequest {
  return { language: "js", code: program.code, inputs: program.inputs, output: program.output, theme: themeOf(session.deck) };
}

/** A run of the host's, never rejecting: a refusal is an error of the code's, in words. */
async function runIn(host: SlidesHost, request: GeneratorRequest): Promise<GeneratorResult> {
  if (!host.runGenerator) return { ok: false, error: { message: "This host cannot run code." } };
  try {
    return await host.runGenerator(request);
  } catch (err) {
    return { ok: false, error: { message: message(err) } };
  }
}

/** What a run drew, kept in the host's image store, with the block the picture keeps of it. */
interface Kept {
  path: string;
  block: PictureGenerator;
  hash: string;
  result: Ran;
}

/** Runs the program and keeps what it drew; the error when it did not. */
async function drawAndKeep(session: EditorSession, program: Program): Promise<Kept | { error: CodeError }> {
  const problem = problemOf(program);
  if (problem) return { error: { message: problem } };
  const request = requestFor(session, program);
  const result = await runIn(session.host, request);
  if (!result.ok) return { error: result.error };
  const hash = runHash(program.code, inputsHash(result.inputs, request.theme), program.output);
  const block: PictureGenerator = { language: program.language, code: program.code, inputs: program.inputs, output: program.output, lastRun: { hash, at: result.at } };
  try {
    const path = await session.host.addImage(fileNameFor(hash, program.output), result.bytes, { source: "file" });
    return { path, block, hash, result };
  } catch (err) {
    return { error: { message: message(err) } };
  }
}

/** The program a picture is run with: its own, or the one the person edited in the panel. */
function programOf(stored: PictureGenerator, change?: Program): Program {
  return change ?? { language: stored.language, code: stored.code, inputs: stored.inputs, output: stored.output };
}

/**
 * The merge patch that swaps in a run's picture: the file, the block (`madeBy` goes when the person changed the code: it is theirs
 * now), and a box that fits the new picture when its proportions differ from the old one's.
 */
function swapPatch(kept: Kept, now: Element, edited: boolean): Patch {
  const block = { ...(kept.block as unknown as Patch), ...(edited ? { madeBy: null } : {}) };
  const patch: Patch = { src: kept.path, [GENERATOR_KEY]: block };
  if (now.x != null && now.y != null && now.w != null && now.h != null) {
    const box = refit({ x: now.x, y: now.y, w: now.w, h: now.h }, kept.result.width, kept.result.height);
    if (box) Object.assign(patch, box);
  }
  return patch;
}

/**
 * Runs the code picture `id` on the slide `slideId` and swaps in the picture it draws, in one step of undo.
 * `change` is the program as the person edited it in the panel; without it the picture's own program runs.
 * Code an agent wrote waits for the person's "Allow to run" unless this deck's code was allowed.
 */
export async function runPicture(session: EditorSession, slideId: string, id: string, change?: Program): Promise<RunReport> {
  const { host } = session;
  if (!host.runGenerator) return { status: "unavailable", why: "This host cannot run code." };
  const slide = session.deck.slides.find((s) => s.id === slideId);
  const element = slide ? findElement(slide.elements, id) : undefined;
  const stored = generatorOf(element);
  if (!stored || element?.type !== "image") return { status: "unavailable", why: "That picture has no code any more." };
  const edited = change !== undefined && change.code !== stored.code;
  // An agent's code runs when a person has allowed it for the deck; the person's own edit of it is theirs.
  if (stored.madeBy && !edited && host.generatorTrust && !(await host.generatorTrust.allowed(stored.code))) return { status: "needs-allow" };
  const kept = await drawAndKeep(session, programOf(stored, change));
  if ("error" in kept) return { status: "error", error: kept.error };
  const after = session.deck.slides.find((s) => s.id === slideId);
  const now = after ? findElement(after.elements, id) : undefined;
  if (now?.type !== "image") return { status: "unavailable", why: "The picture was removed while the code ran." };
  const { warnings, logs } = kept.result;
  if (change === undefined && now.src === kept.path && generatorOf(now)?.lastRun?.hash === kept.hash) {
    return { status: "done", id, path: kept.path, unchanged: true, warnings, logs };
  }
  // The patch goes to the slide the picture is on, which may not be the one shown.
  const patches = [{ id, patch: swapPatch(kept, now, edited) }];
  session.run(() => session.core.apply("patch_elements", { slide: slideId, patches }));
  return { status: "done", id, path: kept.path, unchanged: false, warnings, logs };
}

/** A new code picture from a program: it is run, and put on the shown slide only if it ran. */
export async function insertCodePicture(session: EditorSession, program: Program, alt: string): Promise<{ id: string } | { error: CodeError }> {
  const kept = await drawAndKeep(session, program);
  if ("error" in kept) return kept;
  const box = fitted({ w: kept.result.width, h: kept.result.height }, session.deck.size);
  const element = Object.assign(image(kept.path, box, alt), { [GENERATOR_KEY]: kept.block });
  const [id] = session.elements.insert([element]);
  return id ? { id } : { error: { message: "The picture could not be put on the slide." } };
}

/** What running every code picture of a deck came to. */
export interface RunAllReport {
  updated: number;
  unchanged: number;
  /** Pictures an agent wrote that wait for the person to allow the code. */
  waiting: number;
  failed: { slideId: string; id: string; error: CodeError }[];
}

/**
 * Runs every code picture of the deck, one after another (the host runs one at a time), and swaps in the pictures that came out
 * different as one step of undo, whichever slides they are on. A picture whose code fails, or waits for "Allow to run", is left
 * as it is and counted.
 */
export async function runAll(session: EditorSession): Promise<RunAllReport> {
  const report: RunAllReport = { updated: 0, unchanged: 0, waiting: 0, failed: [] };
  const operations: ["patch_elements", PatchElements][] = [];
  const trust = session.host.generatorTrust;
  for (const found of codePictures(session.deck)) {
    // Each picture's own code is asked about: an allow is for the code the person saw.
    if (found.generator.madeBy && trust && !(await trust.allowed(found.generator.code))) {
      report.waiting += 1;
      continue;
    }
    const kept = await drawAndKeep(session, programOf(found.generator));
    if ("error" in kept) {
      report.failed.push({ slideId: found.slideId, id: found.id, error: kept.error });
      continue;
    }
    const slide = session.deck.slides.find((s) => s.id === found.slideId);
    const now = slide ? findElement(slide.elements, found.id) : undefined;
    if (now?.type !== "image") continue;
    if (now.src === kept.path && found.generator.lastRun?.hash === kept.hash) {
      report.unchanged += 1;
      continue;
    }
    operations.push(["patch_elements", { slide: found.slideId, patches: [{ id: found.id, patch: swapPatch(kept, now, false) }] }]);
    report.updated += 1;
  }
  if (operations.length > 0) session.run(() => session.core.applyBatch(operations));
  return report;
}

/** The words that tell a person how a run of the whole deck came out. */
export function runAllWords(report: RunAllReport): string {
  const parts: string[] = [];
  if (report.updated > 0) parts.push(`${report.updated} updated`);
  if (report.unchanged > 0) parts.push(`${report.unchanged} unchanged`);
  if (report.waiting > 0) parts.push(`${report.waiting} waiting for you to allow the code (Edit code, then Allow to run)`);
  const first = report.failed[0];
  if (first) parts.push(`${report.failed.length} failed: ${first.error.message}${first.error.line ? ` (line ${first.error.line})` : ""}`);
  return parts.length === 0 ? "This deck has no code pictures." : `Code pictures: ${parts.join(", ")}.`;
}

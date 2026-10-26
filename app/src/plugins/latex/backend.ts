// How the window asks the app about LaTeX documents: the Tauri commands, in
// one place, so a test (or the browser preview, which has nobody to ask)
// swaps them. Builds are asked for with `build` and told by `onBuild` events.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { inTauri } from "../../lib/api";
import type { BuildError, BuildEvent, BuildRequest, DocFile, EnginesView, LatexDoc, LatexTemplate, SendRequest, Sent, SourceFile, SourceSaved, SyncHit, SyncSpot } from "./types";

export interface LatexBackend {
  docs(): Promise<LatexDoc[]>;
  files(folder: string): Promise<DocFile[]>;
  source(path: string): Promise<SourceFile>;
  saveSource(path: string, baseHash: string, text: string): Promise<SourceSaved>;
  create(title: string, project?: string, template?: LatexTemplate): Promise<LatexDoc>;
  /** Converts a page or selected Markdown to LaTeX and makes a document of it, or adds it to one. */
  send(request: SendRequest): Promise<Sent>;
  setEngine(folder: string, engine: string): Promise<void>;
  /** Asks for a build; answers its number, or rejects with a `BuildError`. */
  build(request: BuildRequest): Promise<number>;
  cancel(folder: string): Promise<void>;
  readPdf(folder: string): Promise<Uint8Array>;
  /** Keeps the last built PDF in the vault; answers its path. */
  exportPdf(folder: string): Promise<string>;
  engines(folder: string): Promise<EnginesView>;
  syncForward(folder: string, file: string, line: number): Promise<SyncHit[]>;
  syncInverse(folder: string, page: number, x: number, y: number): Promise<SyncSpot>;
  /** Tells every step of every build; answers a way to stop listening. */
  onBuild(handler: (event: BuildEvent) => void): Promise<() => void>;
}

const desktop: LatexBackend = {
  docs: () => invoke<LatexDoc[]>("latex_docs"),
  files: (folder) => invoke<DocFile[]>("latex_files", { folder }),
  source: (path) => invoke<SourceFile>("latex_source", { path }),
  saveSource: (path, baseHash, text) => invoke<SourceSaved>("latex_save_source", { path, baseHash, text }),
  create: (title, project, template) => invoke<LatexDoc>("latex_create", { title, project: project ?? null, template: template ?? null }),
  send: (request) => invoke<Sent>("latex_send", { request }),
  setEngine: (folder, engine) => invoke<void>("latex_set_engine", { folder, engine }),
  build: (request) => invoke<number>("latex_build", { request }),
  cancel: (folder) => invoke<void>("latex_cancel", { folder }),
  readPdf: async (folder) => new Uint8Array(await invoke<ArrayBuffer>("latex_read_pdf", { folder })),
  exportPdf: (folder) => invoke<string>("latex_export_pdf", { folder }),
  engines: (folder) => invoke<EnginesView>("latex_engines", { folder }),
  syncForward: (folder, file, line) => invoke<SyncHit[]>("latex_sync_forward", { folder, file, line }),
  syncInverse: (folder, page, x, y) => invoke<SyncSpot>("latex_sync_inverse", { folder, page, x, y }),
  onBuild: (handler) => listen<BuildEvent>("latex-build", (event) => handler(event.payload)),
};

let override: LatexBackend | null = null;

/** Replaces how LaTeX is asked for (tests); null goes back to the app's own. */
export function setLatexBackend(next: LatexBackend | null): void {
  override = next;
}

/** The backend to use, or null in the browser preview. */
export const latexBackend = (): LatexBackend | null => override ?? (inTauri() ? desktop : null);

/** A sentence for whatever a command rejected with (a string, an `Error`, or a `BuildError`). */
export function sentence(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err && typeof err.message === "string") return err.message;
  return "Something went wrong. Try again in a moment.";
}

/** The `BuildError` a rejected `build` carries, when it is one. */
export function buildErrorOf(err: unknown): BuildError | null {
  if (err && typeof err === "object" && "kind" in err && "message" in err && typeof err.message === "string") return err as BuildError;
  return null;
}

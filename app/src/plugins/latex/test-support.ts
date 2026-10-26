// A fake LaTeX backend for the tests: files in memory, saves that answer like
// the app does, builds that are only requests, and a way to send build events.

import { vi } from "vitest";

import type { LatexBackend } from "./backend";
import type { BuildEvent, BuildRequest, DocFile, EnginesView, LatexDoc, SendRequest, Sent, SourceSaved } from "./types";

export const FOLDER = "projects/p/latex/paper";
export const MAIN = `${FOLDER}/main.tex`;
export const INTRO = `${FOLDER}/sections/intro.tex`;

export const DOC: LatexDoc = { folder: FOLDER, main: "main.tex", mainPath: MAIN, title: "paper", engine: "tectonic", bibliography: "local", locked: false, hasConfig: false };

export const event = (over: Partial<BuildEvent>): BuildEvent => ({ doc: FOLDER, seq: 1, state: "queued", ms: 0, diagnostics: [], pdf: false, ...over });

const WITH_ENGINE: EnginesView = { engines: [{ id: "tectonic", label: "Tectonic", available: true }], chosen: "tectonic", error: null };

export function fakeBackend(initial: Record<string, string> = {}) {
  const disk: Record<string, string> = { [MAIN]: "\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n", [INTRO]: "Intro.\n", ...initial };
  let version = 0;
  const listeners = new Set<(e: BuildEvent) => void>();
  const state = { seq: 0, hasPdf: false, saveAnswer: null as ((path: string, base: string, text: string) => SourceSaved | Promise<SourceSaved>) | null, engines: WITH_ENGINE };
  const hashOf = (path: string) => `h${path.length}-${version}`;

  const backend = {
    docs: vi.fn(() => Promise.resolve([DOC])),
    files: vi.fn((): Promise<DocFile[]> => Promise.resolve(Object.keys(disk).map((path) => ({ path, editable: path.endsWith(".tex"), size: disk[path]!.length })))),
    source: vi.fn((path: string) => Promise.resolve({ path, text: disk[path] ?? "", hash: hashOf(path) })),
    saveSource: vi.fn((path: string, base: string, text: string): Promise<SourceSaved> => {
      if (state.saveAnswer) return Promise.resolve(state.saveAnswer(path, base, text));
      disk[path] = text;
      version++;
      return Promise.resolve({ status: "written", file: { path, text, hash: hashOf(path) } });
    }),
    create: vi.fn((_title?: string, _project?: string, _template?: string) => Promise.resolve(DOC)),
    send: vi.fn((request: SendRequest): Promise<Sent> => Promise.resolve({ doc: DOC, path: request.appendTo ?? MAIN, appended: request.appendTo !== undefined, cites: [], todos: 0 })),
    setEngine: vi.fn(() => Promise.resolve()),
    build: vi.fn((_request: BuildRequest) => Promise.resolve(++state.seq)),
    cancel: vi.fn(() => Promise.resolve()),
    // A PDF exists once a build has made one (an earlier visit's PDF: set `state.hasPdf` first).
    readPdf: vi.fn(() => (state.hasPdf ? Promise.resolve(new Uint8Array([37, 80, 68, 70])) : Promise.reject("There is no PDF yet: build the document first"))),
    exportPdf: vi.fn(() => Promise.resolve(`${FOLDER}/main.pdf`)),
    engines: vi.fn(() => Promise.resolve(state.engines)),
    syncForward: vi.fn(() => Promise.resolve([{ page: 1, x: 72, y: 100, width: 100, height: 10, depth: 2 }])),
    syncInverse: vi.fn(() => Promise.resolve({ file: "main.tex", line: 3 })),
    onBuild: vi.fn((handler: (e: BuildEvent) => void) => {
      listeners.add(handler);
      return Promise.resolve(() => listeners.delete(handler));
    }),
  } satisfies LatexBackend;

  const send = (e: BuildEvent) => {
    if (e.pdf) state.hasPdf = true;
    listeners.forEach((l) => l(e));
  };
  return { backend: backend as LatexBackend & typeof backend, disk, state, send, listeners };
}

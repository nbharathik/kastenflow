// The LaTeX backend of the demo: one document in memory, saves that answer as
// the app does, and a "build" of about 0.6 s that makes a real PDF of the
// source as it stands (demo/typeset.ts), so typing changes the page on the
// right. The real editor, outline and PDF preview draw all of it.

import type { DemoClock } from "../../../demo/clock";
import type { LatexBackend } from "../backend";
import type { BuildEvent, BuildRequest, DocFile, EnginesView, LatexDoc, LatexTemplate, SendRequest, Sent, SourceFile, SourceSaved } from "../types";
import { blankSource, DEMO_FOLDER, DEMO_SOURCE, DEMO_TITLE } from "./source";
import { build } from "./typeset";

/** How long a build takes. */
export const BUILD_MS = 600;

const ENGINES: EnginesView = { engines: [{ id: "tectonic", label: "Tectonic", available: true }], chosen: "tectonic", error: null };

const hashOf = (text: string): string => {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return `${text.length.toString(36)}-${h.toString(36)}`;
};

const slug = (title: string): string => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "document";

export class LatexDemo implements LatexBackend {
  private docsList: LatexDoc[] = [];
  private disk = new Map<string, string>();
  private pdfs = new Map<string, Uint8Array>();
  private listeners = new Set<(event: BuildEvent) => void>();
  private seq = 0;
  private pending: (() => void)[] = [];
  /** Builds finished, for the tests. */
  built = 0;

  constructor(private readonly clock: DemoClock) {
    this.reset();
  }

  /** The document the demo starts with, its PDF already built. */
  reset(): void {
    this.pending.splice(0).forEach((stop) => stop());
    this.docsList = [];
    this.disk.clear();
    this.pdfs.clear();
    this.seq = 0;
    this.built = 0;
    this.add(DEMO_FOLDER, DEMO_TITLE, DEMO_SOURCE);
  }

  private add(folder: string, title: string, source: string): LatexDoc {
    const doc: LatexDoc = { folder, main: "main.tex", mainPath: `${folder}/main.tex`, title, engine: "tectonic", bibliography: "local", locked: false, hasConfig: false };
    this.docsList.push(doc);
    this.disk.set(doc.mainPath, source);
    this.pdfs.set(folder, build(source));
    return doc;
  }

  private file(path: string): SourceFile {
    const text = this.disk.get(path) ?? "";
    return { path, text, hash: hashOf(text) };
  }

  private emit(event: BuildEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  async docs(): Promise<LatexDoc[]> {
    return this.docsList.map((d) => ({ ...d }));
  }

  async files(folder: string): Promise<DocFile[]> {
    return [...this.disk.entries()].filter(([path]) => path.startsWith(`${folder}/`)).map(([path, text]) => ({ path, editable: path.endsWith(".tex"), size: text.length }));
  }

  async source(path: string): Promise<SourceFile> {
    if (!this.disk.has(path)) throw new Error(`There is no file at ${path}`);
    return this.file(path);
  }

  async saveSource(path: string, _baseHash: string, text: string): Promise<SourceSaved> {
    const same = this.disk.get(path) === text;
    this.disk.set(path, text);
    return { status: same ? "unchanged" : "written", file: this.file(path) };
  }

  async create(title: string, _project?: string, template?: LatexTemplate): Promise<LatexDoc> {
    const name = title.trim() || "Untitled";
    let folder = `latex/${slug(name)}`;
    for (let n = 2; this.docsList.some((d) => d.folder === folder); n++) folder = `latex/${slug(name)}-${n}`;
    void template;
    return { ...this.add(folder, name, blankSource(name)) };
  }

  async send(request: SendRequest): Promise<Sent> {
    const title = request.title?.trim() || "From a page";
    const doc = await this.create(title);
    return { doc, path: doc.mainPath, appended: false, cites: [], todos: 0 };
  }

  async setEngine(): Promise<void> {}

  /** Asks for a build; its events follow, the PDF is made when it ends. */
  async build(request: BuildRequest): Promise<number> {
    const doc = this.docsList.find((d) => d.folder === request.folder);
    if (!doc) throw { kind: "internal", message: "That document is not here any more" };
    this.pending.splice(0).forEach((stop) => stop());
    const seq = ++this.seq;
    const buffer = request.buffers.find((b) => b.path === doc.mainPath);
    const source = buffer?.text ?? this.disk.get(doc.mainPath) ?? "";
    const base: Pick<BuildEvent, "doc" | "seq" | "diagnostics" | "pdf"> = { doc: doc.folder, seq, diagnostics: [], pdf: false };
    this.emit({ ...base, state: "queued", ms: 0 });
    this.pending.push(
      this.clock.after(40, () => this.emit({ ...base, state: "running", ms: 0 })),
      this.clock.after(BUILD_MS, () => {
        this.pdfs.set(doc.folder, build(source));
        this.built++;
        this.emit({ ...base, state: "done", ms: BUILD_MS, pdf: true });
      }),
    );
    return seq;
  }

  async cancel(folder: string): Promise<void> {
    this.pending.splice(0).forEach((stop) => stop());
    this.emit({ doc: folder, seq: this.seq, state: "cancelled", ms: 0, diagnostics: [], pdf: false });
  }

  async readPdf(folder: string): Promise<Uint8Array> {
    const pdf = this.pdfs.get(folder);
    if (!pdf) throw new Error("There is no PDF yet: build the document first");
    return pdf.slice();
  }

  async exportPdf(folder: string): Promise<string> {
    return `${folder}/main.pdf`;
  }

  async engines(_folder?: string): Promise<EnginesView> {
    return ENGINES;
  }

  async syncForward(): Promise<[]> {
    return [];
  }

  async syncInverse(): Promise<{ file: string; line: number }> {
    return { file: "main.tex", line: 1 };
  }

  async onBuild(handler: (event: BuildEvent) => void): Promise<() => void> {
    this.listeners.add(handler);
    return () => void this.listeners.delete(handler);
  }
}

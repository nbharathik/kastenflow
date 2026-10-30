// What the LaTeX commands in the app answer (src-tauri/src/plugins/latex and
// kasten-core's `latex` module), as the window reads them.

/** A document: a folder with a root `.tex`. */
export interface LatexDoc {
  folder: string;
  /** The root file, relative to the folder. */
  main: string;
  mainPath: string;
  title: string;
  engine: string;
  bibliography: string;
  locked: boolean;
  hasConfig: boolean;
}

/** The starting points for a new document. */
export type LatexTemplate = "article" | "report" | "beamer";

/** What to send to LaTeX (a page of the vault, or Markdown that was selected) and where. */
export interface SendRequest {
  page?: string;
  text?: string;
  /** The root file of a document to add it to; without it a new document is made. */
  appendTo?: string;
  title?: string;
  template?: LatexTemplate;
  project?: string;
}

/** What sending did. */
export interface Sent {
  doc: LatexDoc;
  /** The root file the text went into. */
  path: string;
  appended: boolean;
  cites: string[];
  /** How many things were left as plain text (each has a `% TODO` comment). */
  todos: number;
}

/** A file in the document's folder. */
export interface DocFile {
  path: string;
  /** The editor can open it as text. */
  editable: boolean;
  size: number;
}

/** A source file's text and the hash a save is written against. */
export interface SourceFile {
  path: string;
  text: string;
  hash: string;
}

export type SourceSaved =
  | { status: "written"; file: SourceFile }
  | { status: "unchanged"; file: SourceFile }
  /** Other lines changed on disk meanwhile: both sets of edits were merged and written. */
  | { status: "merged"; file: SourceFile }
  /** The same lines changed: the editor's text went to `copy`, the file was left alone. */
  | { status: "conflict"; copy: string; file: SourceFile };

export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
  /** Relative to the document's folder, when TeX named a file. */
  file: string | null;
  line: number | null;
  severity: Severity;
  message: string;
  /** What TeX printed where an error stopped (`l.12 \sectoin`), for an error that has it. */
  context?: string | null;
}

/** Why a build could not run, in a sentence, with what to do about it. */
export interface BuildError {
  kind: string;
  message: string;
  /** `install-tectonic` or `install-tex`, when one of them is the fix. */
  next?: "install-tectonic" | "install-tex";
}

export type BuildPhase = "queued" | "running" | "done" | "failed" | "cancelled";

/** One step of a build (the `latex-build` event). */
export interface BuildEvent {
  doc: string;
  seq: number;
  state: BuildPhase;
  ms: number;
  diagnostics: Diagnostic[];
  /** This build made a PDF (`readPdf` gives it). */
  pdf: boolean;
  error?: BuildError;
  /** What a long build is doing ("Downloading TeX packages…"). */
  note?: string;
}

/** An unsaved file that goes with a build request. */
export interface Buffer {
  path: string;
  text: string;
}

export interface BuildRequest {
  folder: string;
  buffers: Buffer[];
}

export interface EngineInfo {
  id: string;
  label: string;
  available: boolean;
}

export interface EnginesView {
  engines: EngineInfo[];
  chosen: string | null;
  error: BuildError | null;
}

/** A box on a page of the PDF, in points from the page's top left. */
export interface SyncHit {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
}

export interface SyncSpot {
  file: string;
  line: number;
}

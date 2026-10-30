// One open LaTeX document: its files, the text being edited in each, saving,
// building and what the build said. It has no React in it (the view reads
// `snapshot()` through `useSyncExternalStore`), so everything it decides is
// tested with a fake backend and fake timers.
//
// Saving: each opened file has an `Autosaver` (500 ms after the last key, with
// the base hash). Building: a build is asked for with the text of every file
// that has not reached the disk yet, so it never waits for a save. Auto-build:
// a build is asked for a moment after typing stops (the delay is a setting).

import { said } from "../../lib/said";
import { Autosaver } from "./autosave";
import { buildErrorOf, type LatexBackend, sentence } from "./backend";
import { type BuildState, IDLE, reduce } from "./build-state";
import { useDiagnostics } from "./diagnostics";
import { useLatexPrefs } from "./prefs";
import type { BuildError, BuildEvent, DocFile, LatexDoc, SyncHit } from "./types";

export interface Snapshot {
  doc: LatexDoc;
  files: DocFile[];
  /** The file shown in the editor. */
  open: string | null;
  /** Files whose text has not reached the disk. */
  dirty: string[];
  saveProblem: string | null;
  conflict: { path: string; copy: string } | null;
  /** A thing worth saying once ("Changes made elsewhere were merged in"). */
  notice: { n: number; text: string } | null;
  /** Why the document cannot be opened at all. */
  loadProblem: string | null;
  loading: boolean;
  build: BuildState;
  /** A build was asked for and no event has come back yet. */
  requesting: boolean;
  /** The build could not run because there is no engine: the card with the next steps. */
  noEngine: BuildError | null;
}

export class Session {
  private readonly savers = new Map<string, Autosaver>();
  private files: DocFile[] = [];
  private open: string | null = null;
  private saveProblem: string | null = null;
  private conflict: Snapshot["conflict"] = null;
  private notice: Snapshot["notice"] = null;
  private loadProblem: string | null = null;
  private loading = true;
  private build: BuildState = IDLE;
  private requesting = false;
  private noEngine: BuildError | null = null;
  private autoTimer: ReturnType<typeof setTimeout> | null = null;
  private stop: (() => void) | null = null;
  private gone = false;
  private snap: Snapshot;
  private readonly listeners = new Set<() => void>();
  private readonly opening = new Map<string, Promise<void>>();
  /** The editor shows a different text for `path` now (after a merge, or the disk's file was chosen). */
  onReplace: (path: string, text: string) => void = () => {};

  constructor(
    private readonly backend: LatexBackend,
    readonly doc: LatexDoc,
  ) {
    this.snap = this.make();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): Snapshot => this.snap;

  /** The files, the root file open, builds listened to; the first build starts when auto-build is on. */
  async start(file?: string): Promise<void> {
    void this.backend
      .onBuild((event) => this.heard(event))
      .then((stop) => {
        if (this.gone) stop();
        else this.stop = stop;
      })
      // The same backend answers `files` just below, whose failure is reported; this one has nothing more to add.
      .catch(() => {});
    try {
      this.files = await this.backend.files(this.doc.folder);
      // The file the tab names (a section file opened from a link), else the root.
      const wanted = this.files.find((f) => f.path === file && f.editable) ? file! : this.doc.mainPath;
      await this.openFile(wanted);
    } catch (err) {
      this.loadProblem = sentence(err);
    }
    this.loading = false;
    this.emit();
    // Which engine would build it, so the card is there before the first build fails.
    try {
      const engines = await this.backend.engines(this.doc.folder);
      if (engines.error?.kind === "no-engine") this.noEngine = engines.error;
    } catch {
      // The build will say.
    }
    this.emit();
    if (!this.noEngine && !this.loadProblem && useLatexPrefs.getState().autoBuild) void this.buildNow();
  }

  /** The text of an opened file (what the editor starts from). */
  textOf(path: string): string {
    return this.savers.get(path)?.current ?? "";
  }

  async openFile(path: string): Promise<void> {
    if (!this.savers.has(path)) {
      let loading = this.opening.get(path);
      if (!loading) {
        loading = this.load(path).finally(() => this.opening.delete(path));
        this.opening.set(path, loading);
      }
      await loading;
    }
    if (this.gone || !this.savers.has(path)) return;
    this.open = path;
    this.emit();
  }

  /** Reads a file and starts keeping it saved. */
  private async load(path: string): Promise<void> {
    const file = await this.backend.source(path);
    if (this.gone) return;
    this.savers.set(
      path,
      new Autosaver({
        file,
        save: (p, base, text) => this.backend.saveSource(p, base, text),
        events: {
          saved: () => this.emit(),
          merged: (text) => {
            this.notice = { n: (this.notice?.n ?? 0) + 1, text: "Changes made elsewhere were merged into this file." };
            this.onReplace(path, text);
            this.emit();
          },
          conflict: ({ copy }) => {
            this.conflict = { path, copy };
            this.emit();
            // The copy is a new file in the folder.
            void this.refreshFiles();
          },
          failed: (message) => {
            this.saveProblem = message;
            this.emit();
          },
        },
      }),
    );
  }

  /** The editor's text changed. Only a change the screen shows (the first key since the last save) draws again: typing stays cheap. */
  edit(path: string, text: string): void {
    const saver = this.savers.get(path);
    if (!saver) return;
    const was = saver.dirty;
    saver.edit(text);
    const cleared = this.saveProblem !== null;
    this.saveProblem = null;
    if (saver.dirty !== was || cleared) this.emit();
    this.scheduleAuto();
  }

  /** Saves every file that has not reached the disk. */
  async saveAll(): Promise<void> {
    this.saveProblem = null;
    await Promise.all([...this.savers.values()].map((s) => s.flush()));
    this.emit();
  }

  /** Ctrl+S: save, and build with what is in the editor. */
  saveAndBuild(): void {
    void this.saveAll();
    void this.buildNow();
  }

  /** Asks for a build now, with the text of the files that are not saved yet. */
  async buildNow(): Promise<void> {
    if (this.gone) return;
    this.clearAuto();
    const buffers = [...this.savers.values()].filter((s) => s.dirty).map((s) => ({ path: s.path, text: s.current }));
    this.requesting = true;
    this.noEngine = null;
    this.emit();
    try {
      await this.backend.build({ folder: this.doc.folder, buffers });
    } catch (err) {
      this.requesting = false;
      const error = buildErrorOf(err) ?? { kind: "internal", message: sentence(err) };
      if (error.kind === "no-engine") this.noEngine = error;
      else this.build = { ...this.build, phase: "failed", diagnostics: [], error, note: null };
    }
    this.emit();
  }

  /** Stops the build that runs or waits. */
  cancel(): void {
    void this.backend.cancel(this.doc.folder).catch(said("Could not stop the build"));
  }

  /** Uses the person's own TeX installation (or any engine) for this document, then builds. */
  async useEngine(engine: string): Promise<void> {
    try {
      await this.backend.setEngine(this.doc.folder, engine);
    } catch (err) {
      this.noEngine = { kind: "internal", message: sentence(err), next: this.noEngine?.next };
      this.emit();
      return;
    }
    await this.buildNow();
  }

  /** Where line `line` of `path` is in the PDF; the first box, or null. */
  async whereInPdf(path: string, line: number): Promise<SyncHit | null> {
    const hits = await this.backend.syncForward(this.doc.folder, path, line);
    return hits[0] ?? null;
  }

  /** After a conflict: save the editor's text over the file on disk. */
  async keepMine(): Promise<void> {
    const conflict = this.conflict;
    if (!conflict) return;
    this.conflict = null;
    this.emit();
    await this.savers.get(conflict.path)?.keepMine();
    this.emit();
  }

  /** After a conflict: take the file on disk (the editor shows it). */
  useDisk(): void {
    const conflict = this.conflict;
    if (!conflict) return;
    const text = this.savers.get(conflict.path)?.useDisk();
    this.conflict = null;
    if (text !== undefined) this.onReplace(conflict.path, text);
    this.emit();
  }

  /** Reads the folder's files again (a new file appeared). */
  async refreshFiles(): Promise<void> {
    try {
      this.files = await this.backend.files(this.doc.folder);
    } catch {
      return;
    }
    if (!this.gone) this.emit();
  }

  /** Closing the document: what was typed and not yet saved is saved first, nothing else goes on. */
  dispose(): void {
    this.gone = true;
    this.clearAuto();
    this.stop?.();
    this.stop = null;
    for (const saver of this.savers.values()) void saver.flush().finally(() => saver.dispose());
    useDiagnostics.getState().clear(this.doc.folder);
    this.listeners.clear();
  }

  private scheduleAuto(): void {
    this.clearAuto();
    const { autoBuild, delayMs } = useLatexPrefs.getState();
    if (!autoBuild || this.noEngine || this.gone) return;
    this.autoTimer = setTimeout(() => {
      this.autoTimer = null;
      void this.buildNow();
    }, delayMs);
  }

  private clearAuto(): void {
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.autoTimer = null;
  }

  private heard(event: BuildEvent): void {
    if (this.gone || event.doc !== this.doc.folder) return;
    const next = reduce(this.build, event, this.doc.folder);
    if (next === this.build) return;
    this.build = next;
    this.requesting = false;
    if (event.state === "done" || event.state === "failed") useDiagnostics.getState().set(this.doc.folder, event.diagnostics);
    this.emit();
  }

  private make(): Snapshot {
    return {
      doc: this.doc,
      files: this.files,
      open: this.open,
      dirty: [...this.savers.values()].filter((s) => s.dirty).map((s) => s.path),
      saveProblem: this.saveProblem,
      conflict: this.conflict,
      notice: this.notice,
      loadProblem: this.loadProblem,
      loading: this.loading,
      build: this.build,
      requesting: this.requesting,
      noEngine: this.noEngine,
    };
  }

  private emit(): void {
    this.snap = this.make();
    this.listeners.forEach((l) => l());
  }
}

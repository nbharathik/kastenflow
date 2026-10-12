// One open diagram's conversation with the editor in its frame: answers
// `configure` and `init`, keeps the source saved as it changes (the XML first,
// 800 ms after the last change; the picture, with the diagram inside it, once
// it has been still for 2 s, when the diagram is closed, when the tab is left
// and when the app closes), and says how it stands. Draw.io keeps its own
// Ctrl+Z history inside the frame; Kasten's undo for the file is History.
//
// It knows nothing of React or the frame: the component hands it the editor's
// messages and the way to post one, so it is tested against a stub.

import type { VaultClient } from "../../lib/vault/types";
import { prettyXml } from "./pretty-xml";
import { bytesOfDataUri, configure, exportPicture, exportPng, load, showTemplates, textOfDataUri, type EditorAction, type EditorEvent } from "./protocol";

export type DiagramStore = Pick<VaultClient, "saveDiagram" | "saveDiagramPreview" | "diagram">;

/** How a diagram's open editor stands, for the line beside it. */
export type EditorStatus =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "unsaved" }
  | { kind: "saving" }
  | { kind: "saved" }
  /** The file changed elsewhere while it was open: what is drawn now goes to this copy, and the copy is what is being edited. */
  | { kind: "copy"; path: string }
  | { kind: "error"; message: string };

/** What an export answered. */
export interface Exported {
  data: string;
  xml: string | null;
}

export interface SessionOptions {
  path: string;
  /** The source as it was read, and the hash a save brings back. */
  xml: string;
  hash: string;
  dark: boolean;
  client: DiagramStore;
  /** Sends a message to the editor. */
  post(action: EditorAction): void;
  onStatus?(status: EditorStatus): void;
  /** The file the session writes is another now (after a conflict). */
  onMoved?(path: string): void;
  /** A link in the diagram was clicked. */
  onLink?(href: string): void;
  /** `render`: the diagram is only drawn again for its picture, which is saved and the session is done. `png`: it is only drawn once as a
   * PNG (`scale` times its size) for `onPng`, and nothing is saved. */
  mode?: "edit" | "render" | "png";
  /** Render mode: whether the picture was kept. A PNG: whether it was drawn. */
  onDone?(ok: boolean): void;
  /** Png mode: the PNG, or null when the editor did not draw one. */
  onPng?(bytes: Uint8Array | null): void;
  /** Png mode: how many times its size the PNG is drawn (2). */
  scale?: number;
  /** How long after the last change the source is saved (800 ms). */
  saveAfterMs?: number;
  /** How long after the last change the picture is drawn and saved (2 s). */
  pictureAfterMs?: number;
  /** How long an export is waited for (10 s; closing waits 1.5 s). */
  exportWaitMs?: number;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class DrawioSession {
  /** The file being edited: the one it was opened on, or the copy a conflict made. */
  path: string;
  /** The hash of what is on disk as this session last wrote or read it. */
  hash: string;
  /** The source as it was last saved or read. */
  saved: string;
  /** The latest source the editor sent, saved or not. */
  latest: string;
  ready = false;

  private readonly o: Required<Pick<SessionOptions, "saveAfterMs" | "pictureAfterMs" | "exportWaitMs">> & SessionOptions;
  private pending: string | null = null;
  private pictureStale = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private pictureTimer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private exports: Promise<unknown> = Promise.resolve();
  private waiting: ((answer: Exported | null) => void) | null = null;
  private done = false;
  /** Templates loaded whose plain copy has not been taken yet. */
  private templates = 0;

  constructor(options: SessionOptions) {
    this.o = { saveAfterMs: 800, pictureAfterMs: 2000, exportWaitMs: 10_000, ...options };
    this.path = options.path;
    this.hash = options.hash;
    this.saved = options.xml;
    this.latest = options.xml;
  }

  private get editing(): boolean {
    return (this.o.mode ?? "edit") === "edit";
  }

  private status(status: EditorStatus): void {
    this.o.onStatus?.(status);
  }

  /** One message from the editor. */
  handle(event: EditorEvent | null): void {
    if (!event || this.done) return;
    switch (event.event) {
      case "configure":
        this.o.post(configure());
        break;
      case "init":
        this.o.post(load(this.latest, this.o.dark, { autosave: this.editing }));
        this.status({ kind: "loading" });
        break;
      case "load":
        this.ready = true;
        this.status({ kind: "ready" });
        if (this.o.mode === "png") void this.drawPng();
        else if (!this.editing) void this.drawAgain();
        // A template just loaded: the diagram is saved from the editor's own plain copy of it.
        else if (this.templates > 0) {
          this.templates -= 1;
          void this.adoptEditorCopy();
        }
        break;
      case "autosave":
        if (this.editing) this.changed(event.xml);
        break;
      case "save":
        // The editor was asked to save (its own shortcut): do it now.
        if (this.editing) {
          this.changed(event.xml);
          void this.flush();
        }
        break;
      case "export":
        this.waiting?.({ data: event.data ?? "", xml: event.xml });
        this.waiting = null;
        break;
      case "openLink":
        this.o.onLink?.(event.href);
        break;
      case "template":
        // A template was picked in the editor's own dialog: it becomes the diagram. The editor sends it compressed (a blank one as
        // a bare model), so it is loaded, and what is saved is the plain copy the editor then gives of what it loaded.
        if (this.editing && event.xml) {
          this.templates += 1;
          this.o.post(load(event.xml, this.o.dark));
        }
        break;
      default:
        break;
    }
  }

  /** Asks the editor to show its template dialog (a new diagram from a template). */
  showTemplates(): void {
    this.o.post(showTemplates());
  }

  /** The editor's own plain XML of the diagram it holds, saved as a change. */
  private async adoptEditorCopy(): Promise<void> {
    const answer = await this.ask({ action: "export", format: "xml" });
    if (answer?.xml && !this.done) this.changed(answer.xml);
  }

  /** The frame is going away: nothing can be exported from it, so closing writes the source alone. */
  closing(): void {
    this.ready = false;
  }

  private changed(xml: string): void {
    this.latest = xml;
    if (xml === this.saved && this.pending === null) return;
    this.pending = xml;
    this.pictureStale = true;
    this.status({ kind: "unsaved" });
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.pictureTimer) clearTimeout(this.pictureTimer);
    this.saveTimer = setTimeout(() => void this.run(() => this.saveSource()), this.o.saveAfterMs);
    this.pictureTimer = setTimeout(() => void this.makePicture(), this.o.pictureAfterMs);
  }

  /** Runs one save after those before it, so each brings back the hash the last one left. */
  private run(step: () => Promise<void>): Promise<void> {
    const next = this.chain.then(step, step);
    this.chain = next.catch(() => {});
    return next;
  }

  private async saveSource(): Promise<void> {
    const xml = this.pending;
    this.pending = null;
    if (xml === null || xml === this.saved) return;
    this.status({ kind: "saving" });
    try {
      await this.took(await this.o.client.saveDiagram(this.path, prettyXml(xml), null, this.hash), xml);
    } catch (err) {
      // Kept to try again with the next change, or when the diagram is left.
      this.pending ??= xml;
      this.status({ kind: "error", message: message(err) });
    }
  }

  private async savePicture(xml: string, svg: string): Promise<void> {
    if (this.pending === xml) this.pending = null;
    this.status({ kind: "saving" });
    try {
      await this.took(await this.o.client.saveDiagram(this.path, prettyXml(xml), svg, this.hash), xml);
      if (this.latest === xml) this.pictureStale = false;
    } catch (err) {
      this.status({ kind: "error", message: message(err) });
    }
  }

  /** What a save answered: the hash to bring back next, or the copy a conflict made, which is edited from now on. */
  private async took(result: Awaited<ReturnType<DiagramStore["saveDiagram"]>>, xml: string): Promise<void> {
    if (result.status === "conflict") {
      const copy = await this.o.client.diagram(result.copy);
      this.path = result.copy;
      this.hash = copy.hash;
      this.saved = copy.xml;
      this.o.onMoved?.(result.copy);
      this.status({ kind: "copy", path: result.copy });
      return;
    }
    this.hash = result.diagram.hash;
    this.saved = xml;
    this.status(this.pending === null && this.latest === xml ? { kind: "saved" } : { kind: "unsaved" });
  }

  /** Asks the editor for an export and waits for its answer; null when none comes in time. One at a time. */
  ask(action: EditorAction, waitMs = this.o.exportWaitMs): Promise<Exported | null> {
    const run = () =>
      new Promise<Exported | null>((resolve) => {
        const timer = setTimeout(() => {
          this.waiting = null;
          resolve(null);
        }, waitMs);
        this.waiting = (answer) => {
          clearTimeout(timer);
          resolve(answer);
        };
        this.o.post(action);
      });
    const next = this.exports.then(run, run);
    this.exports = next.catch(() => {});
    return next;
  }

  /** Draws the picture and keeps it with the source. */
  private async makePicture(waitMs = this.o.exportWaitMs): Promise<void> {
    if (this.pictureTimer) clearTimeout(this.pictureTimer);
    this.pictureTimer = null;
    if (!this.ready || this.done) return;
    // The source kept with the picture is the one the editor sent as the diagram changed, never the export's own copy of it: the
    // editor writes that one compressed, whatever it was told, and the picture's source is a file people read.
    const drawn = this.latest;
    const answer = await this.ask(exportPicture(), waitMs);
    const svg = answer ? textOfDataUri(answer.data) : null;
    if (!answer || svg === null) return;
    // A change made while it was drawn is not in it: the next change's picture (already waiting) is the one to keep.
    if (this.latest !== drawn) return;
    await this.run(() => this.savePicture(drawn, svg));
  }

  /** Render mode: the picture for the source as it is, kept only for that source. */
  private async drawAgain(): Promise<void> {
    const answer = await this.ask(exportPicture());
    const svg = answer ? textOfDataUri(answer.data) : null;
    let ok = false;
    if (svg !== null) {
      try {
        await this.o.client.saveDiagramPreview(this.path, svg, this.hash);
        ok = true;
      } catch {
        // The source changed meanwhile, or the picture was refused: another turn will do it.
      }
    }
    this.finish(ok);
  }

  /** Png mode: the diagram as the editor draws it into a PNG, which no picture saved beside the source can be (a canvas will not take
   * the labels the editor writes into an SVG). */
  private async drawPng(): Promise<void> {
    const answer = await this.ask(exportPng(this.o.scale ?? 2));
    const bytes = answer ? bytesOfDataUri(answer.data) : null;
    this.o.onPng?.(bytes);
    this.finish(bytes !== null);
  }

  private finish(ok: boolean): void {
    if (this.done) return;
    this.done = true;
    this.o.onDone?.(ok);
  }

  /** Writes what is waiting now, and the picture when it is out of date: when the diagram is closed or left, or the app closes. */
  async flush(): Promise<void> {
    if (!this.editing || this.done) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (this.pending !== null) await this.run(() => this.saveSource());
    if (this.pictureStale && this.ready) await this.makePicture(1500);
    await this.chain;
  }

  /** Stops the timers and ignores the editor from now on. Flush first to keep what is waiting. */
  dispose(): void {
    this.done = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.pictureTimer) clearTimeout(this.pictureTimer);
    this.saveTimer = this.pictureTimer = null;
    this.waiting?.(null);
    this.waiting = null;
  }
}

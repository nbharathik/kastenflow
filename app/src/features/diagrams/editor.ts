// The diagram editor is an optional download, not part of the installer:
// whether it is installed, how an install is going, and where its page is
// served from (the `diagrams` scheme in the desktop app; a stand-in page the
// dev server serves, in the browser preview).

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";

import { inTauri } from "../../lib/api";

/** What the app says about the editor (src-tauri/src/diagrams/commands.rs `Status`). */
export interface EditorInfo {
  version: string;
  bytes: number;
  url: string;
  installed: boolean;
  busy: boolean;
}

/** How far an install is (the `diagram-editor-progress` event). */
export interface InstallProgress {
  phase: "downloading" | "verifying" | "extracting";
  done: number;
  total: number;
}

/** The credit the editor is given, wherever it is named. Its name and logo are never used as the feature's. */
export const EDITOR_CREDIT = "Diagram editor: draw.io (diagrams.net), Apache-2.0";

/** The editor the browser preview shows (no desktop app to ask): the real one when the dev server has it in `app/public/drawio/`
 * (unpacked by hand from the pinned release; never part of a build), else the stand-in page in `app/diagrams-stub/`. */
const PREVIEW: EditorInfo = { version: "stub", bytes: 0, url: "", installed: true, busy: false };

/** The dev server's editor serves the browser preview; a production build of the page has none. */
export const previewHasEditor = () => !inTauri() && import.meta.env.DEV;

/** Which editor the preview found: set by `refresh`. */
let previewKind: "real" | "stub" = "stub";
/** The look at the dev server that is under way. */
let served: Promise<boolean> | null = null;

/** Whether the dev server has the real editor's files. A server that has none answers a path like this with 404 (not with the app's own page). */
async function realEditorServed(): Promise<boolean> {
  try {
    const answer = await fetch("/drawio/js/app.min.js", { method: "HEAD" });
    return answer.ok && /javascript/i.test(answer.headers.get("content-type") ?? "");
  } catch {
    return false;
  }
}

/** How an install is told: the desktop app's commands, or a stand-in in tests. */
export interface EditorBackend {
  status(): Promise<EditorInfo>;
  install(onProgress: (progress: InstallProgress) => void): Promise<"installed" | "cancelled">;
  cancel(): Promise<void>;
  remove(): Promise<void>;
}

const desktop: EditorBackend = {
  status: () => invoke<EditorInfo>("diagram_editor_status"),
  async install(onProgress) {
    const stop = await listen<InstallProgress>("diagram-editor-progress", (event) => onProgress(event.payload));
    try {
      return (await invoke<string>("diagram_editor_install")) === "cancelled" ? "cancelled" : "installed";
    } finally {
      stop();
    }
  },
  cancel: () => invoke<void>("diagram_editor_cancel"),
  remove: () => invoke<void>("diagram_editor_remove"),
};

let backend: EditorBackend | null = null;

/** Replaces how the editor is asked for (tests); null goes back to the app's own. */
export function setEditorBackend(next: EditorBackend | null): void {
  backend = next;
}

/** The page the browser preview's demo shows in place of the editor; null outside the demo. */
let demoPage: string | null = null;

export function setDemoEditorPage(page: string | null): void {
  demoPage = page;
}

interface EditorState {
  info: EditorInfo | null;
  progress: InstallProgress | null;
  /** Why the last install did not finish. */
  error: string | null;
  installing: boolean;
  refresh(): Promise<void>;
  install(): Promise<void>;
  cancel(): Promise<void>;
  remove(): Promise<void>;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export const useDiagramEditor = create<EditorState>((set, get) => ({
  info: null,
  progress: null,
  error: null,
  installing: false,
  async refresh() {
    const use = backend ?? (inTauri() ? desktop : null);
    if (!use) {
      if (!previewHasEditor()) return void set({ info: { ...PREVIEW, installed: false } });
      // Several views ask at once when a window opens: one look at the server serves them all.
      served ??= realEditorServed().finally(() => void (served = null));
      previewKind = (await served) ? "real" : "stub";
      set({ info: { ...PREVIEW, version: previewKind === "real" ? "dev" : "stub" } });
      return;
    }
    try {
      set({ info: await use.status() });
    } catch (err) {
      set({ error: message(err) });
    }
  },
  async install() {
    const use = backend ?? (inTauri() ? desktop : null);
    if (!use || get().installing) return;
    set({ installing: true, error: null, progress: { phase: "downloading", done: 0, total: get().info?.bytes ?? 0 } });
    try {
      await use.install((progress) => set({ progress }));
    } catch (err) {
      set({ error: message(err) });
    } finally {
      set({ installing: false, progress: null });
      await get().refresh();
    }
  },
  async cancel() {
    const use = backend ?? (inTauri() ? desktop : null);
    // Cancelling an install already being left behind.
    await use?.cancel().catch(() => {});
  },
  async remove() {
    const use = backend ?? (inTauri() ? desktop : null);
    if (!use) return;
    try {
      await use.remove();
      set({ error: null });
    } catch (err) {
      set({ error: message(err) });
    }
    await get().refresh();
  },
}));

/** The address of the editor's page, or null while it is not installed. */
export function editorPage(): string | null {
  const info = useDiagramEditor.getState().info;
  if (!info?.installed) return null;
  if (demoPage) return demoPage;
  if (!inTauri()) return previewHasEditor() ? `${window.location.origin}/${previewKind === "real" ? "drawio" : "diagrams-stub"}/index.html` : null;
  // `http://diagrams.localhost/…` where a web view knows only http and https, `diagrams://localhost/…` elsewhere.
  return convertFileSrc("index.html", "diagrams");
}

/** The origin messages from the editor's page come from, as a message event says it. */
export function originOf(page: string): string {
  const match = /^([a-z][a-z0-9+.-]*:)\/\/([^/?#]*)/i.exec(page);
  return match ? `${match[1]}//${match[2]}` : "null";
}

/** "48 MB" for the editor's download. */
export const megabytes = (bytes: number): string => `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;

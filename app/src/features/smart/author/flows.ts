// What a person does to make and keep smart pages: start one from a starter,
// turn an ordinary page into one, go back, keep one as a template, save a copy
// as one HTML file. Each acts through the app's ops (backend.ts) and says in
// one plain sentence what happened.

import { inTauri } from "../../../lib/api";
import { useShell } from "../../../lib/store";
import { projectFolderOf } from "../../tags/model";
import { pageFor } from "../../workspace/page/open-page";
import { keepLayout, setLayout, usePageLayouts } from "../../workspace/page/page-layout";
import { reloadLists } from "../../workspace/reload";
import { useWorkspace } from "../../workspace/store";
import { setSmartSide } from "../use-smart-side";
import { type AuthorBackend, type MadeSmart, sentence, tauriAuthorBackend } from "./backend";
import { buildExportHtml } from "./export-html";
import { snapshotOf, wasShown } from "./snapshot";
import { EXPORT_DONE, EXPORT_NEEDS_VIEW, NEEDS_APP } from "./words";

const say = (text: string) => useWorkspace.getState().toast(text);
const desktop = (backend?: AuthorBackend) => backend !== undefined || inTauri();
const pageKey = (path: string): string => useWorkspace.getState().notes.find((n) => n.path === path)?.id || path;

/** Starts a smart page from the starter or template `starter` and opens it: in the project the person is in, else in the library. */
export async function newSmartPage(starter: string, backend?: AuthorBackend, inProject?: string | null): Promise<MadeSmart | null> {
  if (!desktop(backend)) {
    say(NEEDS_APP);
    return null;
  }
  const author = backend ?? tauriAuthorBackend;
  try {
    const project = inProject !== undefined ? inProject : (projectFolderOf(useWorkspace.getState().place.path) ?? null);
    // A folder under projects/ that is not a project (no project page) is not a place for it: the library is.
    const made = await author.newPage(starter, project).catch((err: unknown) => {
      if (project === null) throw err;
      return author.newPage(starter, null);
    });
    await reloadLists();
    useWorkspace.getState().openPath(made.page);
    return made;
  } catch (err) {
    say(`The page could not be made: ${sentence(err)}`);
    return null;
  }
}

/**
 * Turns the open page at `path` into a smart page from `starter`, keeping its
 * text. The layout is set through the open page (as every page option is), then
 * the app writes the folder; if that fails the layout is taken back.
 */
export async function turnIntoSmartPage(path: string, starter: string, backend?: AuthorBackend): Promise<boolean> {
  if (!desktop(backend)) {
    say(NEEDS_APP);
    return false;
  }
  const author = backend ?? tauriAuthorBackend;
  const session = pageFor(path);
  try {
    if (session) {
      keepLayout(session, { ...usePageLayouts.getState().of.get(session), layout: "smart" });
      session.editHeader("layout", "smart");
      await session.flush();
    }
    await author.turnInto(path, starter);
    setSmartSide(pageKey(path), "smart");
    await reloadLists();
    return true;
  } catch (err) {
    if (session) setLayout(session, "layout", null);
    say(`The page could not be turned into a smart page: ${sentence(err)}`);
    return false;
  }
}

/** Keeps the smart page at `path` as a template of the person's own, named like the page unless `name` is given. */
export async function saveSmartTemplate(path: string, name: string, backend?: AuthorBackend): Promise<boolean> {
  if (!desktop(backend)) {
    say(NEEDS_APP);
    return false;
  }
  try {
    const saved = await (backend ?? tauriAuthorBackend).saveTemplate(path, name);
    say(`Kept as “${saved.name}”. It is under Your templates when you start a new smart page.`);
    return true;
  } catch (err) {
    say(`The template could not be saved: ${sentence(err)}`);
    return false;
  }
}

export interface ExportDeps {
  backend?: AuthorBackend;
  /** Saves the copy; the app's own download helper unless a test gives another. Resolves where it went. */
  save?(name: string, bytes: Uint8Array, type: string): Promise<string>;
  today?(): string;
}

/** Saves a copy of the smart page at `path` as one HTML file that opens anywhere. */
export async function exportSmartHtml(path: string, title: string, deps: ExportDeps = {}): Promise<string | null> {
  if (!desktop(deps.backend)) {
    say(NEEDS_APP);
    return null;
  }
  const author = deps.backend ?? tauriAuthorBackend;
  // The answers are kept under the page's id (see SmartFrame), so another page at this path has none of them.
  const key = pageKey(path);
  if (!wasShown(key)) {
    say(EXPORT_NEEDS_VIEW);
    return null;
  }
  try {
    const listing = await author.files(path);
    const files: Record<string, string | Uint8Array> = {};
    for (const file of listing.files.filter((f) => f.allowed)) {
      const read = await author.read(path, file.path);
      files[file.path] = read.text ?? new Uint8Array(read.bytes ?? []);
    }
    const kit = Object.fromEntries(await author.kitFiles());
    const day = (deps.today ?? (() => new Date().toISOString().slice(0, 10)))();
    const { html, left } = buildExportHtml({ title, files, kit, snapshot: snapshotOf(key), day });
    const client = useWorkspace.getState().client;
    const save = deps.save ?? (client ? client.saveDownload.bind(client) : null);
    if (!save) throw new Error("There is nowhere to save it.");
    const name = `${title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "page"}.html`;
    const where = await save(name, new TextEncoder().encode(html), "text/html");
    say(left.length > 0 ? `${EXPORT_DONE} Left out: ${left.join(", ")}.` : `${EXPORT_DONE}`);
    return where;
  } catch (err) {
    say(`The copy could not be saved: ${sentence(err)}`);
    return null;
  }
}

// ---- present ----

let release: (() => void) | null = null;
let stopWatching: (() => void) | null = null;

const leave = () => {
  release?.();
  release = null;
  stopWatching?.();
  stopWatching = null;
  if (useShell.getState().focusMode) useShell.getState().toggleFocus();
};

/** Whether a smart page is being shown full screen. */
export const presentingSmart = (): boolean => stopWatching !== null;

/**
 * Shows the smart page full screen (the sidebar and bars go, the window or the
 * page fills the screen, as when a whiteboard is presented), or gives the
 * screen back. Esc leaves, as it does focus mode.
 */
export function togglePresentSmart(): void {
  if (presentingSmart()) return leave();
  if (!useShell.getState().focusMode) useShell.getState().toggleFocus();
  let taken = false;
  stopWatching = useShell.subscribe((state) => {
    if (taken && !state.focusMode) leave();
  });
  taken = true;
  void import("../../../lib/fullscreen").then(({ fillScreen }) => fillScreen(leave)).then((undo) => {
    if (presentingSmart()) release = undo;
    else undo();
  });
}

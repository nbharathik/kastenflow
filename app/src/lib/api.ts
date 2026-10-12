// Typed client for the Tauri commands in app/src-tauri. Every call maps
// one-to-one to a kasten-core op; the frontend never touches the filesystem.

import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { KitInfo } from "./vault/types";

export interface VaultPath {
  configured: string;
  resolved: string;
  exists: boolean;
}

export interface AppInfo {
  coreVersion: string;
  appVersion: string;
  vault: VaultPath | null;
  /** This program, which serves MCP when started with `--mcp`. */
  exe?: string | null;
  /** Where this build's releases are listed. */
  releases?: string | null;
  /** This build installs new versions in place. */
  canInstall?: boolean;
}

/** True inside the Tauri webview, false in a plain browser or test runner. */
export function inTauri(): boolean {
  return isTauri();
}

/** Opens a web or mail address in the system's browser or mail app. */
export async function openUrl(url: string): Promise<void> {
  if (!inTauri()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  await invoke("open_url", { url });
}

/** The title of the web page at `url`, read by the desktop app (which reads
 * no more than the page's head); null in a browser or when it could not be read. */
export async function webTitle(url: string): Promise<string | null> {
  if (!inTauri()) return null;
  return invoke<string>("web_title", { url }).catch(() => null);
}

/** What the update check found. */
export interface UpdateInfo {
  current: string;
  latest: string;
  /** The latest release is newer than this app. */
  newer: boolean;
  /** The release's page, with its downloads. */
  url: string;
  name: string;
  published: string | null;
  /** Its release notes, in Markdown. */
  notes: string;
  /** The installer for this computer, when the release has one. */
  download?: { name: string; url: string; size: number } | null;
}

/** Asks GitHub for the latest release; null outside the desktop app. */
export async function checkUpdate(): Promise<UpdateInfo | null> {
  if (!inTauri()) return null;
  return invoke<UpdateInfo>("check_update");
}

/** How far a download has got, in bytes. */
export interface DownloadProgress {
  done: number;
  total: number | null;
}

/** Looks for a newer version and downloads it, checking its signature.
 * Answers the version ready to install, or null when there is none. */
export async function prepareUpdate(onProgress: (progress: DownloadProgress) => void): Promise<string | null> {
  const stop = await listen<DownloadProgress>("kasten://update-progress", (event) => onProgress(event.payload));
  try {
    return await invoke<string | null>("update_prepare");
  } finally {
    stop();
  }
}

/** Installs the downloaded version; the app then restarts on it. */
export async function installUpdate(): Promise<void> {
  await invoke("update_install");
}

/** Build and vault information, or null outside Tauri (browser preview). */
export async function appInfo(): Promise<AppInfo | null> {
  if (!inTauri()) return null;
  return invoke<AppInfo>("app_info");
}

/** The open vault's token for MCP over HTTP, made on first use; null in
 * the browser preview, which serves no MCP. */
export async function mcpToken(): Promise<string | null> {
  if (!inTauri()) return null;
  return invoke<string>("mcp_token");
}

/** Shows a vault file in the system's file manager, or with no path the
 * vault's folder. Nothing in the browser preview, which has no folder. */
export async function revealInFolder(path?: string): Promise<void> {
  if (!inTauri()) return;
  await invoke<void>("reveal_in_folder", { path: path ?? null });
}

/** Copies files dropped on the window into the app's cache, outside the
 * vault, for Import to look at; returns that folder. */
export async function stageDrop(name: string, files: { rel: string; data: number[] }[]): Promise<string> {
  return invoke<string>("stage_drop", { name, files });
}

/** Resolves once the app has opened the vault; rejects with why it could
 * not. Opening can take seconds when the index is rebuilt. */
export async function vaultReady(): Promise<void> {
  await invoke<void>("vault_ready");
}

export interface VaultChoices {
  /** The vault open now, if any. */
  current: string | null;
  /** Vaults opened lately, newest first. */
  recent: string[];
  /** Where a new vault would go. */
  suggested: string;
  /** KASTEN_VAULT is set and wins over any choice made in the app. */
  fromEnv: boolean;
}

/** The vaults to offer on the first-run screen and in Settings. */
export async function vaultChoices(): Promise<VaultChoices | null> {
  if (!inTauri()) return null;
  return invoke<VaultChoices>("vault_choices");
}

/** Opens `path` as the vault (making a new one there with `create`); the
 * app restarts on it, so this resolves only on failure. */
export async function openVault(path: string, create: boolean, name?: string, kit?: string | null): Promise<void> {
  await invoke("open_vault", { path, create, name: name ?? null, kit: kit ?? null });
}

/** The starter kits a new vault can start with; none outside the desktop app. */
export async function listKits(): Promise<KitInfo[]> {
  if (!inTauri()) return [];
  return invoke<KitInfo[]>("list_kits");
}

/** The sync app that copies `path` (OneDrive, Dropbox, iCloud Drive…), if any. */
export async function folderSynced(path: string): Promise<string | null> {
  if (!inTauri()) return null;
  return invoke<string | null>("folder_synced", { path });
}

/** What a folder in the folder browser is, from its markers. */
export type FolderKind = "kasten" | "obsidian" | "notes" | "folder";

export interface FolderListing {
  path: string;
  parent: string | null;
  folders: { name: string; path: string; kind: FolderKind }[];
  /** Files of the kind asked for, newest first (none when not asked). */
  files?: { name: string; path: string; bytes: number; modified: number | null }[];
  /** Home, Documents and Desktop, where they exist. */
  places: { label: string; path: string }[];
}

/** The folders in `path` (the documents folder when none is given), and
 * the files ending in `.files` when asked, such as `bundle`. */
export async function browseFolders(path?: string, files?: string): Promise<FolderListing> {
  return invoke<FolderListing>("browse_folders", { path: path ?? null, files: files ?? null });
}

/** What a folder holds, read before it is opened (kasten-core's survey). */
export interface FolderSurvey {
  /** A Kasten vault: its name and format, and whether this Kasten reads it. */
  kasten: { name: string; format: number; readable: boolean } | null;
  obsidian: boolean;
  notes: number;
  /** More notes than were counted. */
  more: boolean;
  /** Top-level folders that hold notes. */
  folders: string[];
}

export async function surveyFolder(path: string): Promise<FolderSurvey> {
  return invoke<FolderSurvey>("survey_folder", { path });
}

let reported = false;

/** Sends the page's start-up marks (`kasten:*`) to the app's startup.log,
 * once per page: timings only. Nothing in a plain browser. */
export function reportStartup(): void {
  if (reported || !inTauri()) return;
  reported = true;
  const marks = (performance.getEntriesByType?.("mark") ?? []).filter((m) => m.name.startsWith("kasten:")).map((m): [string, number] => [`page:${m.name.slice("kasten:".length)}`, m.startTime]);
  void invoke("startup_marks", { now: performance.now(), marks }).catch(() => {});
}

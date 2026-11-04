// Vault files the page can show directly, such as images on a board or in a
// page, through Tauri's asset protocol (the app allows the open vault's
// folder, minus .git, .kasten and .trash).

import { convertFileSrc } from "@tauri-apps/api/core";

import { setCapped, touch } from "../lru";

let root: string | null = null;
/** Files the browser preview was given this session, as object URLs. */
const kept = new Map<string, string>();
export const KEPT_MAX = 64;

/** Where the open vault is on disk; null in the browser preview. */
export function setFileRoot(folder: string | null): void {
  root = folder;
}

/** A web address (a video on the web, say) is its own URL. Only `http` and `https`, with no name and password in front: nothing else
 * is a web address a window may load, and the window's content policy decides which kinds of thing may come from the web. */
function webAddress(path: string): string | null {
  if (!/^https?:\/\//i.test(path)) return null;
  try {
    const url = new URL(path);
    return url.username === "" && url.password === "" ? url.href : null;
  } catch {
    return null;
  }
}

/** A URL the window can load the vault file at `path` from, or null where
 * files cannot be shown (the browser preview, or a path outside the vault).
 * A web address is passed through as it is. */
export function fileUrl(path: string): string | null {
  const web = webAddress(path);
  if (web) return web;
  // Used now: it goes to the back of the line for being freed.
  const known = touch(kept, path);
  if (known) return known;
  if (!root || !path || path.startsWith("/") || path.split("/").some((part) => part === "" || part === "." || part === "..")) return null;
  const windows = root.includes("\\");
  const full = windows ? `${root.replace(/\\+$/, "")}\\${path.replaceAll("/", "\\")}` : `${root.replace(/\/+$/, "")}/${path}`;
  return convertFileSrc(full);
}

/** Where the browser preview shows a file it keeps in memory. A file that is
 * kept again frees its old URL, and the least recently used go once there are
 * more than `KEPT_MAX`; a page that still shows one asks for it again. */
export function keepFileUrl(path: string, url: string): void {
  const old = kept.get(path);
  if (old !== undefined && old !== url) free(old);
  setCapped(kept, path, url, KEPT_MAX, free);
}

function free(url: string): void {
  if (url.startsWith("blob:") && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
}

/** Image files a board shows as pictures. */
export const IMAGE_FILE = /\.(png|jpe?g|gif|webp|svg|avif)$/i;

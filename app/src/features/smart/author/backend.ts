// How the window asks the app to make and change smart pages by hand
// (`app/src-tauri/src/smart/author.rs`): one command per kind of thing, each a
// one-to-one wrapper. Every change goes through the core's ops in the app; the
// window never writes a vault file itself.

import { invoke } from "@tauri-apps/api/core";

/** A starter the app ships, or a template of the person's own. */
export interface StarterInfo {
  /** What the other calls take: a starter's name, or `mine:<slug>`. */
  id: string;
  name: string;
  summary: string;
  mine: boolean;
}

/** A smart page that was just made or turned on. */
export interface MadeSmart {
  page: string;
  id: string | null;
  title: string;
  /** Files written into its folder (none when it kept the folder it had). */
  files: number;
}

export interface FileEntry {
  path: string;
  size: number;
  allowed: boolean;
}

/** What a page's code folder holds. */
export interface Listing {
  page: string;
  dir: string;
  exists: boolean;
  files: FileEntry[];
  totalBytes: number;
  problems: string[];
}

/** One file: its text, or its bytes when it is a picture. */
export interface FileContent {
  path: string;
  hash: string;
  text: string | null;
  bytes: number[] | null;
}

export interface Written {
  path: string;
  rel: string;
  hash: string;
  created: boolean;
  changed: boolean;
}

export interface SavedTemplate {
  slug: string;
  name: string;
  written: string[];
}

/** Why a file was not saved: it changed on disk since it was read, or was taken away (the editor offers a choice), or any other reason. */
export class WriteRefused extends Error {
  constructor(
    readonly code: "conflict" | "gone" | "refused",
    message: string,
  ) {
    super(message);
    this.name = "WriteRefused";
  }
}

/** A rejection from a command as a `WriteRefused`. */
export function asWriteRefused(err: unknown): WriteRefused {
  if (err instanceof WriteRefused) return err;
  if (typeof err === "object" && err !== null) {
    const { code, message } = err as { code?: unknown; message?: unknown };
    if (typeof message === "string") return new WriteRefused(code === "conflict" || code === "gone" ? code : "refused", message);
    if (err instanceof Error) return new WriteRefused("refused", err.message);
  }
  return new WriteRefused("refused", typeof err === "string" ? err : "That did not work.");
}

/** The sentence for any failure. */
export const sentence = (err: unknown): string => (err instanceof Error ? err.message : typeof err === "string" ? err : typeof err === "object" && err !== null && typeof (err as { message?: unknown }).message === "string" ? (err as { message: string }).message : "That did not work.");

export interface AuthorBackend {
  /** The starters, then the person's own templates. */
  starters(): Promise<StarterInfo[]>;
  /** Makes a page from a starter or template, in a project's folder if given. */
  newPage(starter: string, project?: string | null, title?: string | null): Promise<MadeSmart>;
  /** Turns the page at `page` into a smart page, keeping its text. */
  turnInto(page: string, starter: string): Promise<MadeSmart>;
  saveTemplate(page: string, name: string): Promise<SavedTemplate>;
  files(page: string): Promise<Listing>;
  read(page: string, path: string): Promise<FileContent>;
  /** `base` is the hash the file was read with, `""` for a new file. Rejects with a `WriteRefused`. */
  write(page: string, path: string, text: string, base: string): Promise<Written>;
  remove(page: string, path: string): Promise<void>;
  /** The kit's files by path, for a copy of a page that has to stand alone. */
  kitFiles(): Promise<[string, string][]>;
}

export const tauriAuthorBackend: AuthorBackend = {
  starters: () => invoke<StarterInfo[]>("smart_starters"),
  newPage: (starter, project, title) => invoke<MadeSmart>("smart_new_page", { starter, project: project ?? null, title: title ?? null }),
  turnInto: (page, starter) => invoke<MadeSmart>("smart_turn_into", { page, starter }),
  saveTemplate: (page, name) => invoke<SavedTemplate>("smart_save_template", { page, name }),
  files: (page) => invoke<Listing>("smart_files", { page }),
  read: (page, path) => invoke<FileContent>("smart_file_read", { page, path }),
  write: (page, path, text, base) => invoke<Written>("smart_file_write", { page, path, text, baseHash: base }).catch((err: unknown) => Promise.reject(asWriteRefused(err))),
  remove: async (page, path) => {
    await invoke("smart_file_delete", { page, path });
  },
  kitFiles: () => invoke<[string, string][]>("smart_kit_files"),
};

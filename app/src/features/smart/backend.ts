// How the window asks the app about a smart page: one command per kind of
// thing (`app/src-tauri/src/smart/commands.rs`), each a one-to-one wrapper.
// The frame itself has no way to any of them; only the host code in the
// window (`bridge-host.ts`) calls them, for the page it made the frame for.

import { invoke } from "@tauri-apps/api/core";

import { BRIDGE_ERROR_CODES, bridgeError, type BridgeError, type ErrorLog, type ErrorReport } from "../../lib/vault/smart-types";
import type { CommitInfo } from "../../lib/vault/types";
import type { VaultCall } from "./schema";

/** What the window needs to show a smart page. */
export interface PageInfo {
  id: string;
  path: string;
  title: string;
  /** The folder is there with an index.html in it. */
  ready: boolean;
  height: number | null;
  maxHeight: number | null;
  problems: string[];
  /** The page may show pictures from the web. */
  webImages: boolean;
  /** The named views the manifest offers (`![[Page#name]]`), and the file each is drawn from when it is not the main page. */
  views: { name: string; title: string | null; entry: string | null }[];
}

/** Who made a smart page, and whether it waits for a person's "Allow to run". */
export interface Trust {
  /** The agent's client name, when an agent made the page. */
  madeBy: string | null;
  /** History is off, so nothing says who made the page, and agents are held to Review. */
  unknownMaker?: boolean;
  needsAllow: boolean;
  allowed: boolean;
}

/** What putting the code back as an earlier version changed (paths in the vault). */
export interface Restored {
  written: string[];
  trashed: string[];
  /** The commit it made, which Undo takes back; none when nothing changed. */
  commit: string | null;
}

export interface SmartBackend {
  /** Begins a frame for the page at `page`: the secret its address, and everything it loads, carry. */
  openFrame(page: string): Promise<string>;
  /** Ends a frame: nothing is served for its secret any more and its calls are refused. */
  closeFrame(frame: string): Promise<void>;
  /** One call that reads or changes the vault, for the page at `page`, made by the frame with the secret `frame`. Resolves the answer; rejects with a `BridgeError`. */
  call(page: string, call: VaultCall, frame: string): Promise<unknown>;
  /** Keeps an error the kit caught; gives the log as it is now. */
  report(page: string, report: ErrorReport, frame: string): Promise<ErrorLog>;
  errors(page: string): Promise<ErrorLog>;
  clearErrors(page: string): Promise<void>;
  info(page: string): Promise<PageInfo>;
  /** A person's choice, made in the window: the page may or may not show pictures from the web. */
  setWebImages(page: string, allow: boolean): Promise<void>;
  /** Who made the page and whether a person has to allow it to run. */
  trust(page: string): Promise<Trust>;
  /** A person's "Allow to run" for the page. */
  allowRun(page: string): Promise<void>;
  /** Whether smart pages run at all (they do until a person turns them off). */
  runEnabled(): Promise<boolean>;
  setRunEnabled(on: boolean): Promise<void>;
  /** The commits that changed the page's code folder, newest first. */
  history(page: string, limit?: number): Promise<CommitInfo[]>;
  /** Puts the code back as it was at the commit `rev`: a new commit, never a rewrite. */
  restoreVersion(page: string, rev: string): Promise<Restored>;
}

/** What a command rejected with, as a bridge error: a `{code, message}` from the app as it is, any other as plain words. */
export function asBridgeError(err: unknown, fallback: BridgeError["code"] = "refused"): BridgeError {
  if (typeof err === "object" && err !== null) {
    const { code, message } = err as { code?: unknown; message?: unknown };
    if (typeof message === "string" && (BRIDGE_ERROR_CODES as readonly unknown[]).includes(code)) return bridgeError(code as BridgeError["code"], message);
    if (err instanceof Error) return bridgeError(fallback, err.message);
  }
  return bridgeError(fallback, typeof err === "string" ? err : "That did not work.");
}

export const tauriSmartBackend: SmartBackend = {
  openFrame: (page) => invoke<string>("smart_frame_open", { page }),
  closeFrame: (frame) => invoke<void>("smart_frame_close", { frame }),
  call: (page, call, frame) => invoke("smart_call", { page, frame, call }),
  report: (page, report, frame) => invoke<ErrorLog>("smart_report", { page, frame, report }),
  errors: (page) => invoke<ErrorLog>("smart_errors", { page }),
  clearErrors: (page) => invoke<void>("smart_clear_errors", { page }),
  info: (path) => invoke<PageInfo>("smart_page_info", { path }),
  setWebImages: (page, allow) => invoke<void>("smart_set_web_images", { page, allow }),
  trust: (page) => invoke<Trust>("smart_trust", { page }),
  allowRun: (page) => invoke<void>("smart_allow_run", { page }),
  runEnabled: () => invoke<boolean>("smart_run_enabled"),
  setRunEnabled: (on) => invoke<void>("smart_set_run_enabled", { on }),
  history: (page, limit) => invoke<CommitInfo[]>("smart_history", { page, limit }),
  restoreVersion: (page, rev) => invoke<Restored>("smart_restore_version", { page, rev }),
};

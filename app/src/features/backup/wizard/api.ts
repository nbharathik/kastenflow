// The wizard's typed way to the desktop app's backup commands. The names,
// arguments and answers come from lib/vault/backup-types.ts, so a command the
// backend changes fails to compile here instead of failing in a window.

import { invoke } from "@tauri-apps/api/core";

import type { BackupCommands, BackupError } from "../../../lib/vault/backup-types";

export const call = <K extends keyof BackupCommands>(name: K, args?: BackupCommands[K]["args"]): Promise<BackupCommands[K]["result"]> =>
  invoke<BackupCommands[K]["result"]>(name, args ?? {});

/** A failed backup command answers `{ kind, message }`. */
export function backupError(err: unknown): BackupError {
  if (typeof err === "object" && err !== null && typeof (err as { kind?: unknown }).kind === "string") return err as BackupError;
  const text = err instanceof Error ? err.message : typeof err === "string" ? err : "Something went wrong. Try again in a moment";
  return { kind: "other", message: text };
}

/** The one plain sentence of a failed command. */
export const sentence = (err: unknown): string => backupError(err).message;

/** Backs up now, as the settings' "Back up now" does. */
export const pushNow = () => invoke<unknown>("push_now");

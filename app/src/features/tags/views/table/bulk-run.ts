// Runs the table's own batches (a bulk action, a paste, a new row order): open
// pages write what was typed first, the batch is ONE commit, the lists catch
// up, the pages it changed are shown again from disk, and the notice carries
// one Undo that takes the whole commit back. A refusal changes nothing and is
// told in one plain sentence.

import type { BatchChange, BatchRun } from "../../../../lib/vault/batch-types";
import type { VaultClient } from "../../../../lib/vault/types";
import { pageFor, reloadOpenPage } from "../../../workspace/page/open-page";
import { useWorkspace } from "../../../workspace/store";
import { useTags } from "../../store";

const sentence = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The core's refusal without its bookkeeping: which change it was, and "nothing changed". */
export function plainRefusal(message: string): string {
  if (message.includes("needs the vault's history")) return "Turn on history in Settings first, so that this can be undone. Nothing was changed.";
  if (message.includes("changed since you read it")) return "A page changed while this was being done, so nothing was changed. Try again.";
  const reason = message
    .replace(/^Change \d+ of \d+ \([a-z_]+\): /, "")
    .replace(/\.? ?Nothing in the batch was changed\.?$/, "")
    .trim();
  if (!reason) return "Nothing was changed.";
  return `Nothing was changed: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}${/[.!?]$/.test(reason) ? "" : "."}`;
}

/** What follows a batch, or an Undo: the note lists and the schemas are read again, and open pages show what is on disk. */
async function catchUp(paths: readonly string[]): Promise<void> {
  await useWorkspace.getState().refresh();
  await useTags.getState().load();
  for (const path of paths) reloadOpenPage(path);
}

/** Runs `changes` as one batch; null when it was refused (the sentence is toasted) or there is no vault. `paths` are the notes it touches, for their open pages. */
export async function runBatchChanges(changes: BatchChange[], reason: string, paths: readonly string[] = []): Promise<BatchRun | null> {
  const { client, toast } = useWorkspace.getState();
  if (!client) return null;
  try {
    // Typing waiting in an open page is written first, so the batch builds on it.
    await Promise.all(paths.map((path) => pageFor(path)?.flush()));
    const run = await client.runBatch(changes, reason);
    await catchUp(paths);
    return run;
  } catch (err) {
    toast(plainRefusal(sentence(err)));
    return null;
  }
}

/** The notice's Undo for a batch: the one commit goes back whole. Undefined when the batch left no commit (the browser preview). */
export function undoOf(client: VaultClient, run: BatchRun, paths: readonly string[], said: string, after?: () => void): { label: string; run: () => void } | undefined {
  const commit = run.commit;
  if (!commit) return undefined;
  const { toast } = useWorkspace.getState();
  return {
    label: "Undo",
    run: () => {
      void client.undoCommit(commit).then(
        async (undone) => {
          if (undone.conflict) return toast(`Not undone: ${undone.conflict.path} changed since (${undone.conflict.detail.toLowerCase()}).`);
          await catchUp(paths);
          after?.();
          toast(said);
        },
        (err: unknown) => toast(sentence(err)),
      );
    },
  };
}

/** Runs a batch and tells what it did, with its Undo. True when it ran. */
export async function runAndTell(changes: BatchChange[], reason: string, paths: readonly string[], done: string, undone: string, after?: () => void): Promise<boolean> {
  const run = await runBatchChanges(changes, reason, paths);
  if (!run) return false;
  const { client, toast } = useWorkspace.getState();
  toast(done, client ? undoOf(client, run, paths, undone, after) : undefined);
  return true;
}

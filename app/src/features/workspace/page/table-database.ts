// "Turn into database" for the page the editor shows. The tag's schema, a note
// for each row and the page itself (the table swapped for the embed of the new
// database) are made as ONE batch: one commit, one Undo. The page file has one
// writer, the batch, so the editor does not touch the table: what was typed is
// saved first, the batch edits the saved page, and the page is shown again from
// disk. If anything is refused nothing changes and one sentence says why.

import type { BatchRun, NoteMeta, VaultClient } from "../../../lib/vault/types";
import type { LinkProvider } from "../../pages/editor/links";
import { databaseChanges, FIRST_VIEW, type DatabasePlan, type TableSpot } from "../../pages/editor/tables/database";
import { isDraft, nowAt } from "../drafts";
import { useWorkspace } from "../store";
import { writeEverything } from "./before-exit";
import { newPageHome } from "./new-page-home";
import { passTyping, reloadOpenPage } from "./open-page";
import type { PageSession } from "./page-session";

type Made = { path: string; view: string } | { error: string };

const noun = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** What the core says when it refuses, in one plain sentence: which change it was and the "nothing changed" tail are the core's bookkeeping. */
export function plainRefusal(message: string, name: string): string {
  if (message.includes("already has a schema")) return `A database called “${name}” already exists. Give this one another name.`;
  if (message.includes("changed since you read it")) return "The page changed while the database was being made, so nothing was changed. Try again.";
  if (/may send at most|holds at most \d+ changes/.test(message)) return "This table holds too much to turn into a database at once. Split it into smaller tables first. Nothing was changed.";
  if (message.includes("needs the vault's history")) return "Turn on history in Settings first, so that making a database can be undone. Nothing was changed.";
  const reason = message
    .replace(/^Change \d+ of \d+ \([a-z_]+\): /, "")
    .replace(/\.? ?Nothing in the batch was changed\.?$/, "")
    .trim();
  return `Nothing was changed: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}${/[.!?]$/.test(reason) ? "" : "."}`;
}

const sentence = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The table's block in the saved page, or the sentence saying why it cannot be found. */
async function blockOf(client: VaultClient, path: string, spot: TableSpot): Promise<{ id: string; hash: string } | { error: string }> {
  const blocks = await client.pageBlocks(path);
  const tables = blocks.blocks.filter((b) => b.kind === "table");
  const block = tables[spot.index];
  // The editor and the page's blocks must agree on which table it is, or the wrong one could be replaced.
  if (blocks.truncated || tables.length !== spot.count || !block?.table || block.table.rows !== spot.rows || block.table.columns !== spot.columns) {
    return { error: "This table can't be turned into a database from where it is (inside a list or a quote, say). Move it onto the page itself and try again." };
  }
  return { id: block.id, hash: block.hash };
}

/** Undo for the one commit: the page is shown again and the lists catch up. */
function undoTurn(client: VaultClient, run: BatchRun, path: string, name: string): { label: string; run: () => void } | undefined {
  const commit = run.commit;
  if (!commit) return undefined;
  const { toast } = useWorkspace.getState();
  return {
    label: "Undo",
    run: () => {
      void client.undoCommit(commit).then(
        async (undone) => {
          if (undone.conflict) return toast(`Not undone: ${undone.conflict.path} changed since (${undone.conflict.detail.toLowerCase()}).`);
          reloadOpenPage(path);
          await useWorkspace.getState().refresh();
          toast(`Took back the database “${name}”`);
        },
        (err: unknown) => toast(sentence(err)),
      );
    },
  };
}

async function turn(client: VaultClient, session: PageSession, note: NoteMeta | undefined, plan: DatabasePlan, spot: TableSpot): Promise<Made> {
  const path = nowAt(session.path);
  if (!note || isDraft(path)) return { error: "Write something on the page first, so it is saved, then turn the table into a database." };
  // Everything typed is written first: the batch edits the saved page, and nothing else writes it meanwhile.
  passTyping(session);
  await writeEverything();
  if (session.busy) return { error: "The page could not be saved first, so nothing was changed. Try again in a moment." };
  let file: string;
  let run: BatchRun;
  try {
    const block = await blockOf(client, path, spot);
    if ("error" in block) return block;
    file = await client.newTagFile(plan.tag);
    run = await client.runBatch(databaseChanges(plan, newPageHome(note), { path, block }, file), `Turn the table into a database: ${plan.name}`);
  } catch (err) {
    return { error: plainRefusal(sentence(err), plan.name) };
  }
  // The database is made: what follows only shows it, and a failure there must not say "nothing was changed".
  try {
    // The page now holds the embed: show the saved page, and let the lists take in the new notes.
    reloadOpenPage(path);
    await useWorkspace.getState().refresh();
  } catch {
    // The lists catch up on the next change on disk.
  }
  useWorkspace.getState().toast(`Made the database “${plan.name}” from ${noun(plan.notes.length, "row", "rows")}`, undoTurn(client, run, path, plan.name));
  return { path: file, view: FIRST_VIEW };
}

/** The page's "Turn into database". Only a page in a vault has it: the browser preview cannot make one commit of many changes. */
export function tableDatabaseLinks(client: VaultClient, session: PageSession, note: () => NoteMeta | undefined): Pick<LinkProvider, "turnTableIntoDatabase"> {
  if (client.kind !== "vault") return {};
  return { turnTableIntoDatabase: (plan, spot) => turn(client, session, note(), plan, spot) };
}

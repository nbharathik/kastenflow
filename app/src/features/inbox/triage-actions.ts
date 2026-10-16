// What triage does to a card, one action at a time. Each goes through the
// core's ops by way of the vault client (`updateProps`, `setTags`, `create`)
// or the workspace's own move, and each says what it did in a notice whose
// Undo takes exactly that back. A card's source address and the day it was
// captured are never touched.

import { shortDay } from "../../lib/dates";
import type { Collection } from "../../lib/vault/collection-types";
import type { NoteMeta, TagSchema } from "../../lib/vault/types";
import { linkFor } from "../workspace/links";
import { titleOf } from "../workspace/names";
import { putBack, spotOf } from "../workspace/placing";
import { useWorkspace } from "../workspace/store";
import { joinTags } from "./join";
import { FILED, REVIEW_AFTER, isCapture, type Reading } from "./queue";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** A notice with an Undo that runs `run`, showing its own failure. */
function offerUndo(text: string, run: () => Promise<unknown>): void {
  const { toast } = useWorkspace.getState();
  toast(text, { label: "Undo", run: () => void run().catch((err: unknown) => useWorkspace.getState().toast(message(err))) });
}

/** Sets properties on a note (null removes one) and takes the page into the list; null when the core refused, which the window has said. */
export async function setProps(path: string, props: Record<string, unknown>): Promise<NoteMeta | null> {
  const { client, noteChanged, toast } = useWorkspace.getState();
  if (!client) return null;
  try {
    const saved = await client.updateProps(path, props);
    noteChanged(saved.meta);
    return saved.meta;
  } catch (err) {
    toast(message(err));
    return null;
  }
}

/** Puts the card off until `until`; it leaves the queue and comes back that day. */
export async function deferCard(card: NoteMeta, until: string): Promise<boolean> {
  const was = card.props[REVIEW_AFTER] ?? null;
  if (!(await setProps(card.path, { [REVIEW_AFTER]: until }))) return false;
  offerUndo(`Put off “${titleOf(card)}” until ${shortDay(until)}`, () => setProps(card.path, { [REVIEW_AFTER]: was }));
  return true;
}

/** Sets the card's reading state (null clears it), independent of where it is filed. */
export async function setReading(card: NoteMeta, state: Reading | null): Promise<boolean> {
  const was = card.props.reading ?? null;
  if (!(await setProps(card.path, { reading: state }))) return false;
  const text = state ? `“${titleOf(card)}” is marked ${state}` : `Cleared the reading state of “${titleOf(card)}”`;
  offerUndo(text, () => setProps(card.path, { reading: was }));
  return true;
}

/** Keeps the card and takes it out of the queue: a capture's status becomes Filed; a card in the Inbox also goes to Pages, so the Inbox is empty of it. */
export async function archiveCard(card: NoteMeta): Promise<boolean> {
  const workspace = useWorkspace.getState();
  const spot = spotOf(workspace.notes, card.path);
  const capture = isCapture(card);
  const status = card.props.status ?? null;
  let path = card.path;
  if (capture && !(await setProps(path, { status: FILED }))) return false;
  if (spot?.inbox) {
    const moved = await workspace.move(path, null, true);
    if (!moved) {
      if (capture) await setProps(path, { status });
      return false;
    }
    path = moved;
  }
  offerUndo(`Archived “${titleOf(card)}”`, async () => {
    // The status first, while the card is still where it was put.
    if (capture) await setProps(path, { status });
    if (spot?.inbox) await putBack(path, spot);
  });
  return true;
}

/** The properties a task made here starts with: the tag's first status, no day. */
export function taskProps(schema: TagSchema | undefined): Record<string, unknown> {
  const status = schema?.properties.find((p) => p.key === "status");
  if (status?.type === "select" && status.options.length > 0) return { status: status.options.find((o) => o.toLowerCase() === "todo") ?? status.options[0] };
  return { status: "Todo" };
}

/** Makes a `task` note that links the card; the card stays where it is. */
export async function makeTask(card: NoteMeta): Promise<boolean> {
  const workspace = useWorkspace.getState();
  const { client } = workspace;
  if (!client) return false;
  const schema = await client.tagSchemas().then(
    (all) => all.find((s) => s.name.toLowerCase() === "task"),
    () => undefined,
  );
  const task = await workspace.create({ kind: "page", title: `Follow up: ${titleOf(card)}`, project: card.project ?? null, tags: ["task"], props: taskProps(schema), body: `${linkFor(card, workspace.notes)}\n` }, false);
  if (!task) return false;
  // Undo moves the new task to the trash, where it stays until emptied.
  offerUndo(`Made the task “${titleOf(task.meta)}” from “${titleOf(card)}”`, () => useWorkspace.getState().trash(task.meta.path, true));
  return true;
}

/** Adds the card to a collection that is only tags, by giving it those tags. */
export async function joinCollection(card: NoteMeta, collection: Pick<Collection, "name" | "query" | "when" | "filter" | "problem" | "readOnly">): Promise<boolean> {
  const { client, noteChanged, toast } = useWorkspace.getState();
  const tags = joinTags(collection);
  if (!client || !tags) return false;
  const missing = tags.filter((tag) => !card.tags.some((have) => have.toLowerCase() === tag.toLowerCase()));
  if (missing.length === 0) {
    toast(`“${titleOf(card)}” is in “${collection.name}” already`);
    return true;
  }
  try {
    noteChanged((await client.setTags(card.path, missing, [])).meta);
  } catch (err) {
    toast(message(err));
    return false;
  }
  const given = missing.map((t) => `#${t}`).join(" ");
  offerUndo(`Added “${titleOf(card)}” to “${collection.name}” (tagged ${given})`, async () => {
    noteChanged((await client.setTags(card.path, [], missing)).meta);
  });
  return true;
}

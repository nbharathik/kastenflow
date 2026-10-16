// "Already saved on 2026-09-01 · Open · Save another snapshot": shown over a
// capture whose web address another card already holds. It tells and offers;
// it never blocks, and it saves nothing unless "Save another snapshot" is
// pressed (the desktop app only, as clipping is).

import { useEffect, useState } from "react";

import { stampDay } from "../../lib/dates";
import type { NoteMeta } from "../../lib/vault/types";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { titleOf } from "../workspace/names";
import { useWorkspace } from "../workspace/store";

/** The other cards that were kept from the address this card was kept from, the first saved first; null until they are known, and for a card with no address. */
export function useDuplicates(card: NoteMeta | undefined): NoteMeta[] | null {
  const client = useWorkspace((s) => s.client);
  const [found, setFound] = useState<{ path: string; others: NoteMeta[] } | null>(null);
  const path = card?.path;
  const url = typeof card?.props.url === "string" && card.props.url.trim() !== "" ? card.props.url : null;
  useEffect(() => {
    if (!client || !path || !url) return;
    let live = true;
    client.capturedFrom(url).then(
      (list) => live && setFound({ path, others: list.filter((n) => n.path !== path) }),
      () => live && setFound({ path, others: [] }),
    );
    return () => {
      live = false;
    };
  }, [client, path, url]);
  return found && found.path === path ? found.others : null;
}

/** The day a card was caught: its `captured` property, else the day it was made. */
export function capturedDay(note: Pick<NoteMeta, "props" | "created">): string | null {
  const day = note.props.captured;
  return typeof day === "string" && stampDay(day) ? day.slice(0, 10) : note.created && stampDay(note.created) ? note.created.slice(0, 10) : null;
}

const SHOWN = 3;

export function DuplicateNotice({ card }: { card: NoteMeta }) {
  const others = useDuplicates(card);
  const client = useWorkspace((s) => s.client);
  const [busy, setBusy] = useState(false);
  if (!others || others.length === 0) return null;
  const first = others[0]!;
  const days = others.slice(0, SHOWN).map((n) => capturedDay(n) ?? "an earlier day");
  const url = card.props.url as string;

  const snapshot = async () => {
    if (!client || busy) return;
    setBusy(true);
    const { toast, noteChanged, trash } = useWorkspace.getState();
    try {
      const outcome = await client.clipPage(url, true);
      if (outcome.kind === "saved") {
        noteChanged(outcome.note.meta);
        toast(`Saved another snapshot of “${titleOf(card)}”`, { label: "Undo", run: () => void trash(outcome.note.meta.path, true) });
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <p role="note" aria-label="Already saved" className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-soft px-3 py-2 text-13">
      <Icon name="info" className="size-4 shrink-0 text-muted" />
      <span>
        Already saved on {days.join(", ")}
        {others.length > SHOWN ? ` and ${others.length - SHOWN} more` : ""}
      </span>
      <Button size="sm" tone="quiet" aria-label={`Open “${titleOf(first)}”, saved earlier`} onClick={() => useWorkspace.getState().openPath(first.path)}>
        Open
      </Button>
      {client?.kind === "vault" && (
        <Button size="sm" tone="quiet" disabled={busy} onClick={() => void snapshot()}>
          Save another snapshot
        </Button>
      )}
    </p>
  );
}

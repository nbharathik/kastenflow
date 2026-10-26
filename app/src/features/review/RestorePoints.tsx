// "Restore to before this session": the restore points an agent session left
// (one before its first autonomous write, one before each big batch). Restoring
// puts every note back as it was then, as new changes the History can undo; it
// goes back past everything done since, so it asks first and says so.

import { useState } from "react";

import type { Checkpoint, VaultRestore } from "../../lib/vault/types";
import { Icon } from "../../ui/Icon";
import { useWorkspace } from "../workspace/store";
import { message, useReview } from "./store";
import { BUTTON, Callout, ConfirmBar } from "./ui";
import { count } from "./words";

/** "Before this session" as the button says it: "Restore to before this session". */
export const restoreWords = (label: string) => label.replace(/^Before\b/, "Restore to before");

type Outcome = VaultRestore | { error: string };

export function RestorePoints({ points, onChanged }: { points: Checkpoint[]; onChanged(): Promise<void> }) {
  const [asking, setAsking] = useState<Checkpoint | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const restore = async (point: Checkpoint) => {
    const { client, refresh } = useWorkspace.getState();
    if (!client) return;
    setAsking(null);
    setBusy(true);
    try {
      setOutcome(await client.restoreToCheckpoint(point.id));
    } catch (err) {
      setOutcome({ error: message(err) });
    }
    setBusy(false);
    await onChanged();
    void refresh();
    void useReview.getState().refresh();
  };

  return (
    <div className="mt-3 space-y-2">
      {outcome &&
        ("error" in outcome ? (
          <Callout tone="bad" icon="alert" role="alert">
            The vault was not put back: {outcome.error}
          </Callout>
        ) : (
          <Callout tone="ok" role="status">
            Put the notes back as they were: {count(outcome.written.length, "file")} restored. History can undo this.
          </Callout>
        ))}
      {asking ? (
        <ConfirmBar
          title={`${restoreWords(asking.label)}?`}
          detail="Puts every note back as it was then, as new changes you can undo. Everything changed since, by you or by other agents, goes back too, and notes made since go to the trash."
          confirm="Restore"
          onConfirm={() => void restore(asking)}
          onCancel={() => setAsking(null)}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {points.map((point) => (
            <button key={point.id} type="button" className={BUTTON} disabled={busy} onClick={() => setAsking(point)}>
              <Icon name="history" className="size-4" />
              {busy ? "Restoring…" : restoreWords(point.label)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

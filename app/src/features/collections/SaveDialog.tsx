// "Save as collection": a name for the search, a line that says what it
// will find, and what it could not keep. The collection is a file in the
// vault's views folder, made by one op that Undo takes back.

import { useId, useState } from "react";

import { COLLECTION_LIMITS, type Collection } from "../../lib/vault/collection-types";
import { Button } from "../../ui/Button";
import { Modal } from "../../ui/Modal";
import { useWorkspace } from "../workspace/store";
import type { SavedSearch } from "./from-search";
import { describeWhen } from "./describe";
import { openCollection } from "./requests";

interface Props {
  saved: SavedSearch;
  onClose(): void;
  /** After it is saved (the dialog closes itself). */
  onSaved?(made: Collection): void;
}

export function SaveCollectionDialog({ saved, onClose, onSaved }: Props) {
  const id = useId();
  const [name, setName] = useState(saved.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = saved.edits.query ?? "";
  const days = describeWhen(saved.edits.when ?? null);

  const save = async () => {
    const { client, toast } = useWorkspace.getState();
    if (!client || busy) return;
    const text = name.trim();
    if (text === "") return setError("Give the collection a name");
    setBusy(true);
    setError(null);
    try {
      const made = await client.createCollection(text, saved.edits);
      toast(`Saved the collection “${made.name}”`, { label: "Open", run: () => openCollection(made.path) });
      onSaved?.(made);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Modal labelledBy={`${id}-title`} describedBy={`${id}-body`} onClose={onClose} className="ui-dialog">
      <h2 id={`${id}-title`} className="ui-dialog-title">
        Save as collection
      </h2>
      <form
        id={`${id}-body`}
        className="ui-dialog-body space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="block text-13 font-medium">
          Name
          <input autoFocus className="ui-field mt-1 w-full" value={name} maxLength={COLLECTION_LIMITS.name} onChange={(event) => setName(event.target.value)} />
        </label>
        <p className="text-13 text-muted">
          It finds {query.trim() ? <code className="rounded bg-well px-1 py-0.5 text-12">{query.trim()}</code> : "every page"}
          {days ? ` ${days}` : ""}. The collection is looked up again each time you open it, so it follows your notes.
        </p>
        {saved.dropped.length > 0 && <p className="text-13 text-muted">Not kept, since a collection cannot say it: {saved.dropped.join(", ")}.</p>}
        {error && (
          <p role="alert" className="text-13 text-danger">
            {error}
          </p>
        )}
      </form>
      <footer className="ui-dialog-foot">
        <Button onClick={onClose}>Cancel</Button>
        <Button tone="primary" disabled={busy || name.trim() === ""} onClick={() => void save()}>
          Save
        </Button>
      </footer>
    </Modal>
  );
}

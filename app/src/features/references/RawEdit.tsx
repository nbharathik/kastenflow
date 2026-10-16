// An entry as the BibTeX it is written in, to edit by hand. What is saved must
// be one whole entry with the same key and no text outside it (checked here as
// you type, and again by the vault); everything else in the file is untouched.
// An entry of a file that is read only is shown, not edited.

import { useId, useState } from "react";

import { Button } from "../../ui/Button";
import type { Bibliography } from "../../lib/vault/reference-types";
import { useWorkspace } from "../workspace/store";
import { renderEntry } from "./bibtex";
import { checkRaw } from "./raw";
import type { RefRow } from "./rows";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

interface Props {
  row: RefRow;
  bib: Bibliography;
  /** The entry's own text, when it could be cut out of its file; null when it could not. */
  raw: string | null;
  onSaved(): void;
}

export function RawEdit({ row, bib, raw, onSaved }: Props) {
  const id = useId();
  const { entry } = row;
  // Without the entry's own text, a tidy copy built from its fields stands in, and says so.
  const tidy = raw === null;
  const start = raw ?? renderEntry(entry.type, entry.key, entry.fields);
  const [text, setText] = useState(start);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = checkRaw(entry.key, text);
  const dirty = text.trim() !== start.trim();

  if (!row.managed) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-12 text-muted">This file is read only. Make a managed copy to edit the entry.</p>
        <pre className="max-h-80 overflow-auto rounded bg-well p-3 font-mono text-12 whitespace-pre-wrap" aria-label="BibTeX">
          {start}
        </pre>
      </div>
    );
  }

  const save = async () => {
    const { client, toast } = useWorkspace.getState();
    if (!client || problem || !dirty) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await client.replaceReference(entry.key, text.trim(), bib.managed.hash);
      const commit = saved.commit;
      toast(`Saved “${entry.key}”`, commit ? { label: "Undo", run: () => void client.undoCommit(commit).then(() => onSaved(), (err: unknown) => toast(message(err))) } : undefined);
      onSaved();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-12 text-muted">
        BibTeX for “{entry.key}”. Edit the entry; the rest of the file is not touched.
      </label>
      {tidy && <p className="rounded bg-well p-2 text-12 text-muted">The file’s own text could not be read here, so this is a tidied copy built from the fields. Saving replaces the entry with it.</p>}
      <textarea
        id={id}
        className="ui-field h-auto resize-y py-2 font-mono text-12"
        rows={12}
        spellCheck={false}
        aria-invalid={problem !== null && dirty}
        aria-describedby={`${id}-state`}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <p id={`${id}-state`} aria-live="polite" className={`text-12 ${dirty && problem ? "text-danger" : "text-muted"}`}>
        {dirty ? (problem ?? "This is one whole entry with the same key.") : "Not changed."}
      </p>
      {error && (
        <p role="alert" className="text-13 text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button disabled={!dirty || busy} onClick={() => setText(start)}>
          Reset
        </Button>
        <Button tone="primary" disabled={!dirty || problem !== null || busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save BibTeX"}
        </Button>
      </div>
    </div>
  );
}

// The structured edit of a reference in the managed file: the usual fields as
// boxes, the others shown as they are. Saving changes only the fields that
// were changed (the vault edits those values in place and keeps every other
// byte); emptying a box removes the field. The entry's kind and key are not
// changed here: the BibTeX tab and Rename key do that.

import { useState } from "react";

import { Button } from "../../ui/Button";
import type { Bibliography } from "../../lib/vault/reference-types";
import { useWorkspace } from "../workspace/store";
import { missingOf } from "./draft";
import { extraFields, fieldsFor, typeLabel } from "./field-specs";
import { FieldRow } from "./PaperForm";
import type { RefRow } from "./rows";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The values to write: each field that differs from the entry, with null for one that was emptied. */
export function changesOf(original: Record<string, string>, edited: Record<string, string>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [name, raw] of Object.entries(edited)) {
    const value = raw.trim();
    const was = (original[name] ?? "").trim();
    if (value === was) continue;
    out[name] = value === "" ? null : value;
  }
  return out;
}

interface Props {
  row: RefRow;
  bib: Bibliography;
  onSaved(): void;
}

export function FieldsForm({ row, bib, onSaved }: Props) {
  const { entry } = row;
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...entry.fields }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changes = changesOf(entry.fields, values);
  const dirty = Object.keys(changes).length > 0;
  const lack = new Set(missingOf(entry.type, values));
  const extras = extraFields(entry.type, entry.fields);

  const save = async () => {
    const { client, toast } = useWorkspace.getState();
    if (!client || !dirty) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await client.updateReference(entry.key, changes, bib.managed.hash);
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
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <p className="text-12 text-muted">{typeLabel(entry.type)}. Fields you leave empty are left out, never made up.</p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-3">
        {fieldsFor(entry.type).map((spec) => (
          <FieldRow key={spec.name} spec={spec} value={values[spec.name] ?? ""} guessed={false} missing={lack.has(spec.name)} onChange={(value) => setValues((was) => ({ ...was, [spec.name]: value }))} />
        ))}
      </div>
      {extras.length > 0 && (
        <section aria-label="Other fields" className="rounded bg-well p-3">
          <h3 className="text-12 font-medium">Other fields, kept as they are</h3>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-12">
            {extras.map(([name, value]) => (
              <div key={name} className="contents">
                <dt className="font-mono text-muted">{name}</dt>
                <dd className="min-w-0 break-words">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {error && (
        <p role="alert" className="text-13 text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button disabled={!dirty || busy} onClick={() => setValues({ ...entry.fields })}>
          Reset
        </Button>
        <Button type="submit" tone="primary" disabled={!dirty || busy}>
          {busy ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

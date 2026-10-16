// Changing a collection: its query, the days it looks at, how it is shown,
// its filters and sorts. Only what is changed is sent, and the file's other
// lines (a key this version does not know, a comment) stay as written.

import { useId, useState } from "react";

import { COLLECTION_LIMITS, WHEN_TOKENS, type Collection } from "../../lib/vault/collection-types";
import { Button, IconButton } from "../../ui/Button";
import { Modal } from "../../ui/Modal";
import { useWorkspace } from "../workspace/store";
import { editsOf, FILTER_OPS, FORM_KINDS, formOf, hasEdits, WHEN_CHOICES, type Form } from "./edit-form";

const TOKEN_LABELS: Record<(typeof WHEN_TOKENS)[number], string> = {
  today: "today",
  yesterday: "yesterday",
  "this-week": "this week",
  "last-7-days": "the last 7 days",
  "last-30-days": "the last 30 days",
  "this-month": "this month",
  "last-month": "last month",
  "this-year": "this year",
  "next-7-days": "the next 7 days",
};

export function EditCollectionDialog({ collection, onClose, onSaved }: { collection: Collection; onClose(): void; onSaved(changed: Collection): void }) {
  const id = useId();
  const [form, setForm] = useState<Form>(() => formOf(collection));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const edits = editsOf(collection, form);
  const patch = (next: Partial<Form>) => setForm((was) => ({ ...was, ...next }));

  const save = async () => {
    const client = useWorkspace.getState().client;
    if (!client || busy || !hasEdits(edits)) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await client.updateCollection(collection.path, edits, collection.hash));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Modal labelledBy={`${id}-title`} onClose={onClose} className="ui-dialog is-wide">
      <h2 id={`${id}-title`} className="ui-dialog-title">
        Edit “{collection.name}”
      </h2>
      <form
        className="ui-dialog-body space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="block text-13 font-medium">
          Query
          <input autoFocus className="ui-field mt-1 w-full" value={form.query} maxLength={COLLECTION_LIMITS.query} onChange={(event) => patch({ query: event.target.value })} placeholder="#capture project:photo-organiser" />
          <span className="mt-1 block text-12 font-normal text-muted">The search box’s words: #tag, project:name, type:card, under:page, quoted phrases.</span>
        </label>

        <div className="flex flex-wrap items-end gap-3">
          <label className="text-13 font-medium">
            Look at notes
            <select className="ui-field mt-1 block" value={form.whenField} onChange={(event) => patch({ whenField: event.target.value as Form["whenField"] })}>
              {WHEN_CHOICES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          {form.whenField !== "" && (
            <label className="text-13 font-medium">
              In
              <select className="ui-field mt-1 block" value={form.whenToken} onChange={(event) => patch({ whenToken: event.target.value as Form["whenToken"] })}>
                {WHEN_TOKENS.map((t) => (
                  <option key={t} value={t}>
                    {TOKEN_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="text-13 font-medium">
            Show as
            <select className="ui-field mt-1 block" value={form.kind} onChange={(event) => patch({ kind: event.target.value as Form["kind"] })}>
              {FORM_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-13 font-medium">
            Most notes
            <input className="ui-field mt-1 block w-24" inputMode="numeric" value={form.limit} placeholder="500" onChange={(event) => patch({ limit: event.target.value.replace(/\D/g, "") })} />
          </label>
          <label className="text-13 font-medium">
            Icon
            <input className="ui-field mt-1 block w-24" value={form.icon} maxLength={40} onChange={(event) => patch({ icon: event.target.value })} />
          </label>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-13 font-medium">Filters</legend>
          {form.filters.map((row, at) => (
            <div key={at} className="flex items-center gap-2">
              <input className="ui-field w-36" aria-label="Property" placeholder="Property" value={row.key} onChange={(event) => patch({ filters: form.filters.map((r, i) => (i === at ? { ...r, key: event.target.value } : r)) })} />
              <select className="ui-field" aria-label="Test" value={row.op} onChange={(event) => patch({ filters: form.filters.map((r, i) => (i === at ? { ...r, op: event.target.value as typeof row.op } : r)) })}>
                {FILTER_OPS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              {FILTER_OPS.find((o) => o.id === row.op)?.needsValue && <input className="ui-field min-w-0 flex-1" aria-label="Value" placeholder="Value" value={row.value} onChange={(event) => patch({ filters: form.filters.map((r, i) => (i === at ? { ...r, value: event.target.value } : r)) })} />}
              <IconButton icon="close" label="Remove filter" size="sm" onClick={() => patch({ filters: form.filters.filter((_, i) => i !== at) })} />
            </div>
          ))}
          <Button size="sm" onClick={() => patch({ filters: [...form.filters, { key: "", op: "is", value: "" }] })}>
            Add filter
          </Button>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-13 font-medium">Sort</legend>
          {form.sorts.map((row, at) => (
            <div key={at} className="flex items-center gap-2">
              <input className="ui-field w-36" aria-label="Sort by" placeholder="Property" value={row.key} onChange={(event) => patch({ sorts: form.sorts.map((r, i) => (i === at ? { ...r, key: event.target.value } : r)) })} />
              <select className="ui-field" aria-label="Direction" value={row.dir} onChange={(event) => patch({ sorts: form.sorts.map((r, i) => (i === at ? { ...r, dir: event.target.value as typeof row.dir } : r)) })}>
                <option value="asc">A to Z, oldest first</option>
                <option value="desc">Z to A, newest first</option>
              </select>
              <IconButton icon="close" label="Remove sort" size="sm" onClick={() => patch({ sorts: form.sorts.filter((_, i) => i !== at) })} />
            </div>
          ))}
          <Button size="sm" onClick={() => patch({ sorts: [...form.sorts, { key: "", dir: "asc" }] })}>
            Add sort
          </Button>
        </fieldset>

        {error && (
          <p role="alert" className="text-13 text-danger">
            {error}
          </p>
        )}
      </form>
      <footer className="ui-dialog-foot">
        <Button onClick={onClose}>Cancel</Button>
        <Button tone="primary" disabled={busy || !hasEdits(edits)} onClick={() => void save()}>
          Save
        </Button>
      </footer>
    </Modal>
  );
}

// The fields of a reference as a form: used to review a paper before it is
// added. A field read by guessing says so, and a field nobody supplied says it
// is missing and stays empty: nothing here is ever made up.

import { useId } from "react";

import { ENTRY_TYPES } from "../../lib/vault/reference-types";
import { extraFields, fieldsFor, typeLabel, type FieldSpec } from "./field-specs";
import { missingOf, type PaperDraft } from "./draft";

interface Props {
  draft: PaperDraft;
  onChange(next: PaperDraft): void;
}

/** One field of the form: its label with a mark when it was guessed or is missing, the box, and how to write it. */
export function FieldRow({ spec, value, guessed, missing, onChange }: { spec: FieldSpec; value: string; guessed: boolean; missing: boolean; onChange(value: string): void }) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = guessed ? "Read by guessing: check it." : missing ? "Not found: fill it in if you know it." : (spec.hint ?? null);
  return (
    <div className={spec.narrow ? "" : "col-span-2"}>
      <label htmlFor={id} className="mb-1 flex items-baseline gap-2 text-12 font-medium">
        {spec.label}
        {guessed && <span className="rounded bg-soft px-1.5 text-11 font-normal text-accent">Check this</span>}
        {missing && !guessed && <span className="text-11 font-normal text-warning">Missing</span>}
      </label>
      {spec.long ? (
        <textarea id={id} aria-describedby={note ? noteId : undefined} rows={3} className="ui-field h-auto resize-y py-2" value={value} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input id={id} type="text" aria-describedby={note ? noteId : undefined} className="ui-field" value={value} onChange={(event) => onChange(event.target.value)} />
      )}
      {note && (
        <p id={noteId} className="mt-1 text-11 text-muted">
          {note}
        </p>
      )}
    </div>
  );
}

export function PaperForm({ draft, onChange }: Props) {
  const typeId = useId();
  const lack = new Set(missingOf(draft.type, draft.fields));
  const extras = extraFields(draft.type, draft.fields);
  const set = (name: string, value: string) => onChange({ ...draft, fields: { ...draft.fields, [name]: value }, guessed: draft.guessed.filter((g) => g !== name) });
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-3">
      <div className="col-span-2">
        <label htmlFor={typeId} className="mb-1 block text-12 font-medium">
          Kind of work
        </label>
        <select id={typeId} className="ui-field" value={draft.type.toLowerCase()} onChange={(event) => onChange({ ...draft, type: event.target.value })}>
          {[...new Set([...ENTRY_TYPES, draft.type.toLowerCase()])].map((type) => (
            <option key={type} value={type}>
              {typeLabel(type)}
            </option>
          ))}
        </select>
      </div>
      {fieldsFor(draft.type).map((spec) => (
        <FieldRow key={spec.name} spec={spec} value={draft.fields[spec.name] ?? ""} guessed={draft.guessed.includes(spec.name)} missing={lack.has(spec.name)} onChange={(value) => set(spec.name, value)} />
      ))}
      {extras.length > 0 && (
        <p className="col-span-2 text-12 text-muted">
          Also kept, not shown here: {extras.map(([name]) => name).join(", ")}.
        </p>
      )}
    </div>
  );
}

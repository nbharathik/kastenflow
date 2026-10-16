// The second step of adding a paper: the fields as read, to check and fill in,
// the key it will be cited by, and anything in the bibliography it would repeat.

import { useId } from "react";

import { Button } from "../../ui/Button";
import type { ReferenceMatch } from "../../lib/vault/reference-types";
import { openReference } from "./requests";
import { PaperForm } from "./PaperForm";
import type { PaperDraft } from "./draft";
import type { useAddPaper } from "./use-add-paper";

type Add = ReturnType<typeof useAddPaper>;

const WHAT: Record<ReferenceMatch["by"], string> = { key: "the same key", doi: "the same DOI", arxiv: "the same arXiv number" };

function Repeats({ add, close }: { add: Add; close(): void }) {
  if (add.matches.length === 0) return null;
  const open = (key: string) => {
    close();
    openReference(key);
  };
  return (
    <div role="alert" className="rounded bg-well p-3 text-13">
      <p className="font-medium">{add.keyTaken ? "That key is taken." : "This looks like a reference you have."}</p>
      <ul className="mt-1 space-y-1">
        {add.matches.map((m) => (
          <li key={`${m.by}:${m.file}:${m.key}`} className="flex items-center gap-2">
            <span className="min-w-0 flex-1">
              “{m.key}” in {m.file} has {WHAT[m.by]}.
            </span>
            <Button size="sm" onClick={() => open(m.key)}>
              Open existing
            </Button>
          </li>
        ))}
      </ul>
      {add.keyTaken && add.free && (
        <Button size="sm" className="mt-2" onClick={add.takeFree}>
          Use {add.free} instead
        </Button>
      )}
      {!add.keyTaken && (
        <label className="mt-2 flex items-center gap-2 text-12">
          <input type="checkbox" checked={add.allowDuplicate} onChange={(event) => add.setAllowDuplicate(event.target.checked)} />
          It is another work: add it anyway
        </label>
      )}
    </div>
  );
}

export function ReviewStep({ add, close }: { add: Add; close(): void }) {
  const keyId = useId();
  const { draft } = add;
  const change = (next: PaperDraft) => add.setDraft(next);
  return (
    <>
      <div className="flex max-h-[62vh] flex-col gap-3 overflow-y-auto pr-1">
        {add.position && (
          <p className="text-12 text-muted">
            Entry {add.position.at} of {add.position.of}
          </p>
        )}
        {draft.note && <p className="rounded bg-well p-2 text-12 text-muted">{draft.note}</p>}
        <div>
          <label htmlFor={keyId} className="mb-1 block text-12 font-medium">
            Key
          </label>
          <input id={keyId} type="text" className="ui-field font-mono" spellCheck={false} aria-invalid={add.problem !== null} aria-describedby={`${keyId}-note`} value={draft.key} onChange={(event) => add.setKey(event.target.value)} />
          <p id={`${keyId}-note`} className={`mt-1 text-11 ${add.problem && draft.key ? "text-danger" : "text-muted"}`}>
            {add.problem && draft.key ? add.problem : `Cite it in a page as [@${draft.key || "key"}]. The key is made from the first author, the year and the title; change it if you like.`}
          </p>
        </div>
        <Repeats add={add} close={close} />
        <PaperForm draft={draft} onChange={change} />
      </div>
      {add.error && (
        <p role="alert" className="text-13 text-danger">
          {add.error}
        </p>
      )}
      <footer className="ui-dialog-foot">
        {!add.cameWithDraft && !add.position && (
          <Button tone="quiet" onClick={add.back}>
            Back
          </Button>
        )}
        {add.position && <Button onClick={add.skip}>Skip this one</Button>}
        <Button onClick={close}>Cancel</Button>
        <Button tone="primary" disabled={!add.canSave} onClick={() => void add.save()}>
          {add.busy ? "Adding…" : add.position && add.position.at < add.position.of ? "Add and go on" : "Add to references"}
        </Button>
      </footer>
    </>
  );
}

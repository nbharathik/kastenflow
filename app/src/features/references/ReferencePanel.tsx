// One reference, beside the table: what it says, where it is cited, ways to
// copy it, and (for the managed file) the structured and BibTeX edits and a
// rename. A reference in a file KastenFlow only reads can be copied into the
// managed file, which is then the one to edit.

import { useEffect, useId, useState } from "react";

import { Button, IconButton } from "../../ui/Button";
import { Segmented } from "../../ui/Segmented";
import { MANAGED_BIB, type Bibliography, type KeyUses } from "../../lib/vault/reference-types";
import { useWorkspace } from "../workspace/store";
import { renderEntry } from "./bibtex";
import { copyText } from "./copy";
import { FieldsForm } from "./FieldsForm";
import { fullCitation } from "./labels";
import { RawEdit } from "./RawEdit";
import { fileTexts, rawEntry } from "./raw";
import { RenameDialog } from "./RenameDialog";
import type { RefRow } from "./rows";

type Tab = "details" | "bibtex";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

interface Props {
  row: RefRow;
  bib: Bibliography;
  uses: KeyUses | undefined;
  onChanged(): void;
  /** Selects the managed reference `key` (after a copy or a rename). */
  onSelectKey(key: string): void;
  onClose(): void;
}

/** The text of the file the entry is in, read once the BibTeX tab asks. */
function useEntryText(row: RefRow, bib: Bibliography, wanted: boolean): { raw: string | null; loading: boolean } {
  const [state, setState] = useState<{ raw: string | null; loading: boolean }>({ raw: null, loading: true });
  const hash = row.managed ? bib.managed.hash : (bib.external.find((f) => f.path === row.file)?.hash ?? "");
  useEffect(() => {
    if (!wanted) return;
    const { client } = useWorkspace.getState();
    if (!client) return;
    let cancelled = false;
    setState({ raw: null, loading: true });
    client.references().then(
      (all) => {
        if (cancelled) return;
        const text = fileTexts(bib, all).get(row.file);
        setState({ raw: text === undefined ? null : rawEntry(text, row.key), loading: false });
      },
      () => !cancelled && setState({ raw: null, loading: false }),
    );
    return () => {
      cancelled = true;
    };
    // The file's hash stands for its text: read it again when that changes.
  }, [wanted, row.file, row.key, hash]);
  return state;
}

export function ReferencePanel({ row, bib, uses, onChanged, onSelectKey, onClose }: Props) {
  const headId = useId();
  const [tab, setTab] = useState<Tab>("details");
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const { entry } = row;
  const text = useEntryText(row, bib, tab === "bibtex");
  const open = (path: string) => useWorkspace.getState().openPath(path, "tab");

  /** The entry as the file has it when that can be read, else written out from its fields. */
  const copyBibtex = async () => {
    let bibtex = renderEntry(entry.type, entry.key, entry.fields);
    try {
      const all = await useWorkspace.getState().client?.references();
      const own = all === undefined ? undefined : fileTexts(bib, all).get(row.file);
      const raw = own === undefined ? null : rawEntry(own, row.key);
      if (raw) bibtex = raw;
    } catch {
      // The fields stand in.
    }
    await copyText(bibtex, "Copied the BibTeX");
  };

  /** Copies this reference, or every reference of its file, into the managed file. */
  const adopt = async (keys: string[] | null) => {
    const { client, toast } = useWorkspace.getState();
    if (!client) return;
    setBusy(true);
    try {
      const done = await client.adoptBib(row.file, keys, bib.managed.hash);
      const commit = done.commit;
      const skipped = done.skipped.length > 0 ? ` ${plural(done.skipped.length, "was", "were")} left out: ${done.skipped[0]!.why}` : "";
      toast(`Copied ${plural(done.added.length, "reference")} into ${MANAGED_BIB}.${skipped}`, commit ? { label: "Undo", run: () => void client.undoCommit(commit).then(() => onChanged(), (err: unknown) => toast(message(err))) } : undefined);
      onChanged();
      if (done.added.includes(entry.key)) onSelectKey(entry.key);
    } catch (err) {
      toast(message(err));
    } finally {
      setBusy(false);
    }
  };

  const file = [bib.managed, ...bib.external].find((f) => f.path === row.file);
  const cited = uses ? uses.pages.length + uses.decks.length + uses.assets.length : 0;
  return (
    <aside aria-labelledby={headId} className="flex h-full w-[26rem] shrink-0 flex-col overflow-y-auto border-l border-line bg-panel">
      <header className="flex items-start gap-2 p-4 pb-2">
        <div className="min-w-0 flex-1">
          <h2 id={headId} className="truncate font-mono text-14 font-semibold" title={entry.key}>
            {entry.key}
          </h2>
          <p className="mt-0.5 text-12 text-muted">{row.managed ? "In your managed file" : `In ${row.file}, which is read only`}</p>
        </div>
        <IconButton icon="close" label="Close the details" size="sm" onClick={onClose} />
      </header>

      <div className="flex flex-col gap-4 p-4 pt-2">
        <p className="text-14 leading-snug">{row.title || <span className="text-faint">No title</span>}</p>

        <div role="toolbar" aria-label="Copy" className="flex flex-wrap gap-1.5">
          <Button size="sm" icon="copy" onClick={() => void copyText(fullCitation(entry), "Copied the citation")}>
            Copy citation
          </Button>
          <Button size="sm" icon="copy" onClick={() => void copyBibtex()}>
            Copy BibTeX
          </Button>
          <Button size="sm" icon="copy" disabled={!row.link} title={row.link ? undefined : "This reference has no DOI, arXiv number or address"} onClick={() => row.link && void copyText(row.link.href, "Copied the link")}>
            Copy link
          </Button>
          <Button size="sm" icon="copy" title="What to write in a page to cite it" onClick={() => void copyText(`[@${entry.key}]`, `Copied [@${entry.key}]`)}>
            Copy [@{entry.key}]
          </Button>
          {row.pdf && (
            <Button size="sm" icon="open" onClick={() => useWorkspace.getState().go({ view: "highlights", path: row.pdf! }, "tab")}>
              Open the PDF
            </Button>
          )}
        </div>

        <section aria-label="Cited in">
          <h3 className="text-12 font-medium text-muted">Cited in</h3>
          {!uses ? (
            <p className="mt-1 text-13 text-muted">Looking…</p>
          ) : cited === 0 ? (
            <p className="mt-1 text-13 text-muted">Nothing cites it yet. Write [@{entry.key}] in a page to cite it.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {uses.pages.map((page) => (
                <li key={page.path} className="flex items-center gap-2 text-13">
                  <span className="min-w-0 flex-1 truncate">{page.title}</span>
                  <span className="text-12 text-muted">{plural(page.count, "time")}</span>
                  <Button size="sm" aria-label={`Open ${page.title}`} onClick={() => open(page.path)}>
                    Open
                  </Button>
                </li>
              ))}
              {uses.decks.map((deck) => (
                <li key={deck.path} className="flex items-center gap-2 text-13">
                  <span className="min-w-0 flex-1 truncate">{deck.title} (deck)</span>
                  <span className="text-12 text-muted">{plural(deck.count + deck.inLayouts, "time")}</span>
                  <Button size="sm" aria-label={`Open ${deck.title}`} onClick={() => open(deck.path)}>
                    Open
                  </Button>
                </li>
              ))}
              {uses.assets.length > 0 && <li className="text-12 text-muted">{plural(uses.assets.length, "picture")} name it as their source.</li>}
            </ul>
          )}
        </section>

        {!row.managed && (
          <section aria-label="Make a managed copy" className="rounded bg-well p-3">
            <p className="text-13">This reference is in {row.file}, a file KastenFlow reads and never changes (a Zotero export, for example). To edit it or rename its key, make a managed copy.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" tone="primary" disabled={busy} onClick={() => void adopt([entry.key])}>
                Make a managed copy
              </Button>
              {file && file.entries.length > 1 && (
                <Button size="sm" disabled={busy} onClick={() => void adopt(null)}>
                  Copy all {file.entries.length} of this file
                </Button>
              )}
            </div>
          </section>
        )}

        <Segmented<Tab>
          label="Reference details"
          value={tab}
          onChange={setTab}
          choices={[
            { value: "details", label: "Details" },
            { value: "bibtex", label: "BibTeX" },
          ]}
        />
        {tab === "details" ? (
          row.managed ? (
            <FieldsForm key={`${row.id}:${bib.managed.hash}`} row={row} bib={bib} onSaved={onChanged} />
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-13">
              {Object.entries(entry.fields).map(([name, value]) => (
                <div key={name} className="contents">
                  <dt className="font-mono text-12 text-muted">{name}</dt>
                  <dd className="min-w-0 break-words">{value}</dd>
                </div>
              ))}
            </dl>
          )
        ) : text.loading ? (
          <p className="text-13 text-muted">Reading the file…</p>
        ) : (
          <RawEdit key={`${row.id}:${bib.managed.hash}:${text.raw === null}`} row={row} bib={bib} raw={text.raw} onSaved={onChanged} />
        )}

        {row.managed && (
          <div className="border-t border-line pt-3">
            <Button size="sm" onClick={() => setRenaming(true)}>
              Rename key…
            </Button>
          </div>
        )}
      </div>
      {renaming && (
        <RenameDialog
          keyName={entry.key}
          onClose={() => setRenaming(false)}
          onRenamed={(to) => {
            onChanged();
            onSelectKey(to);
          }}
        />
      )}
    </aside>
  );
}

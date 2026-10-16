// References: the papers and books of the vault in one table. The ones in
// `sources/references.bib` are KastenFlow's to edit; those in any other `.bib`
// file (a Zotero Better BibTeX export, say) are listed too and read only, until
// a managed copy is made. A page cites one as [@key]; the table says where each
// is cited, what it lacks and what the bibliography repeats.

import { useEffect, useMemo, useState } from "react";

import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { Segmented } from "../../ui/Segmented";
import { useSources } from "../sources/store";
import { openCompare } from "../sources/compare/compare-state";
import { openAddPaper } from "./add-state";
import { ReferencePanel } from "./ReferencePanel";
import { RefTable, type Order } from "./RefTable";
import { useReferenceRequests } from "./requests";
import { buildRows, filterRows, sortRows, type RowFilter, type RowOrder } from "./rows";
import { useBibliography } from "./use-bibliography";
import { useUses } from "./use-uses";

/** How many rows are drawn before "Show more". */
const PAGE = 60;

const FILTERS: { value: RowFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "managed", label: "Managed" },
  { value: "external", label: "External" },
  { value: "incomplete", label: "Incomplete" },
  { value: "duplicate", label: "Repeated" },
];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function ReferencesView() {
  const { bib, error, reload } = useBibliography();
  const pdfList = useSources((s) => s.list);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RowFilter>("all");
  const [order, setOrder] = useState<Order>({ by: "key", direction: "asc" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const wanted = useReferenceRequests((s) => s.key);

  useEffect(() => {
    if (useSources.getState().list === null) void useSources.getState().loadList();
  }, []);

  const pdfs = useMemo(() => (pdfList ?? []).map((s) => s.path), [pdfList]);
  const rows = useMemo(() => (bib ? buildRows(bib, pdfs) : []), [bib, pdfs]);
  const shown = useMemo(() => sortRows(filterRows(rows, { filter, query }), order.by, order.direction), [rows, filter, query, order]);
  const visible = shown.slice(0, limit);
  const selected = rows.find((r) => r.id === selectedId) ?? null;
  const uses = useUses(useMemo(() => [...new Set([...(selected ? [selected.key] : []), ...visible.map((r) => r.key)])], [visible, selected]));

  // A citation chip, a duplicate or a comparison asked for one reference.
  useEffect(() => {
    if (!wanted || !bib) return;
    const found = rows.find((r) => r.key === wanted && r.managed) ?? rows.find((r) => r.key === wanted);
    if (found) {
      setFilter("all");
      setQuery("");
      setSelectedId(found.id);
    }
    useReferenceRequests.getState().clear();
  }, [wanted, bib, rows]);

  const sortBy = (by: RowOrder) => setOrder((was) => ({ by, direction: was.by === by && was.direction === "asc" ? "desc" : "asc" }));
  const tick = (id: string) =>
    setTicked((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const tickAll = (on: boolean) => setTicked(on ? new Set(shown.map((r) => r.id)) : new Set());
  const selectKey = (key: string) => setSelectedId(`${bib?.managed.path ?? ""}::${key}`);
  const managedCount = bib?.managed.entries.length ?? 0;
  const externalCount = rows.length - managedCount;
  const problems = bib ? [bib.managed, ...bib.external].filter((f) => f.problem) : [];
  const pickedRows = rows.filter((r) => ticked.has(r.id));

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col bg-canvas">
        <header className="flex flex-wrap items-center gap-3 px-6 pt-5">
          <div className="min-w-0 flex-1">
            <h1 className="text-20 font-semibold">References</h1>
            <p className="mt-0.5 text-13 text-muted" role="status">
              {bib ? `${plural(rows.length, "reference")}: ${managedCount} managed${externalCount > 0 ? `, ${externalCount} from other files` : ""}` : error ? "" : "Reading your bibliography…"}
            </p>
          </div>
          <Button icon="compose" disabled={pickedRows.length < 2} title={pickedRows.length < 2 ? "Tick two or more references to compare them" : undefined} onClick={() => openCompare({ keys: pickedRows.map((r) => r.key) })}>
            Compare{pickedRows.length >= 2 ? ` ${pickedRows.length}` : ""}…
          </Button>
          <Button
            tone="primary"
            icon="plus"
            onClick={() =>
              openAddPaper({
                then: (key) => {
                  reload();
                  selectKey(key);
                },
              })
            }
          >
            Add a paper…
          </Button>
        </header>

        {error && (
          <p role="alert" className="mx-6 mt-3 text-13 text-danger">
            {error}
          </p>
        )}
        {problems.map((file) => (
          <p key={file.path} role="alert" className="mx-6 mt-3 text-13 text-warning">
            {file.path}: {file.problem}
          </p>
        ))}

        {bib && rows.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 px-6 py-3">
            <div className="relative min-w-48 max-w-sm flex-1">
              <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input type="search" aria-label="Search references" placeholder="Search key, author, year, title, DOI" className="ui-field pl-8" value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
            <Segmented<RowFilter> label="Filter references" value={filter} choices={FILTERS} onChange={setFilter} />
            <span className="text-12 text-muted" role="status">
              {shown.length === rows.length ? "" : `${shown.length} shown`}
              {ticked.size > 0 ? `${shown.length === rows.length ? "" : " · "}${ticked.size} ticked` : ""}
            </span>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto px-4 pb-6">
          {bib && rows.length === 0 ? (
            <Empty />
          ) : bib && shown.length === 0 ? (
            <div className="m-auto mt-16 max-w-sm text-center">
              <p className="text-14 font-medium">No reference matches.</p>
              <Button
                className="mt-3"
                onClick={() => {
                  setQuery("");
                  setFilter("all");
                }}
              >
                Clear the search and filter
              </Button>
            </div>
          ) : (
            bib && (
              <>
                <RefTable rows={visible} order={order} onOrder={sortBy} selected={selectedId} onSelect={setSelectedId} ticked={ticked} onTick={tick} onTickAll={tickAll} uses={uses} />
                {shown.length > visible.length && (
                  <div className="mt-3 flex justify-center">
                    <Button onClick={() => setLimit((n) => n + PAGE)}>Show {Math.min(PAGE, shown.length - visible.length)} more of {shown.length - visible.length}</Button>
                  </div>
                )}
              </>
            )
          )}
        </div>
      </div>

      {bib && selected && <ReferencePanel key={selected.id} row={selected} bib={bib} uses={uses.get(selected.key)} onChanged={reload} onSelectKey={selectKey} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

function Empty() {
  return (
    <div className="m-auto mt-16 max-w-md px-6 text-center">
      <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-well text-muted" aria-hidden="true">
        <Icon name="book" className="size-7" />
      </div>
      <h2 className="mt-3 text-16 font-semibold">Keep the papers you cite</h2>
      <p className="mt-1.5 text-14 leading-relaxed text-muted">
        Add a paper by pasting its BibTeX, a citation, a DOI or an arXiv number, then cite it in any page as [@key]. Nothing is looked up online: what you paste is read on this computer. A .bib file you export from Zotero into the vault is listed here too, read only.
      </p>
      <Button className="mt-5" tone="primary" icon="plus" onClick={() => openAddPaper()}>
        Add a paper…
      </Button>
    </div>
  );
}

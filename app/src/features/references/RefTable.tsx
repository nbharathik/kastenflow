// The References table: one row for each reference, sortable by its column
// heads, ticked for actions on several, and moved through with the arrow keys.

import { useRef, type KeyboardEvent } from "react";

import type { KeyUses } from "../../lib/vault/reference-types";
import { Icon } from "../../ui/Icon";
import type { RefRow, RowOrder } from "./rows";

export interface Order {
  by: RowOrder;
  direction: "asc" | "desc";
}

interface Props {
  rows: readonly RefRow[];
  order: Order;
  onOrder(by: RowOrder): void;
  selected: string | null;
  onSelect(id: string): void;
  ticked: ReadonlySet<string>;
  onTick(id: string): void;
  onTickAll(on: boolean): void;
  uses: ReadonlyMap<string, KeyUses>;
}

const COLUMNS: { by: RowOrder; label: string }[] = [
  { by: "key", label: "Key" },
  { by: "authors", label: "Authors" },
  { by: "year", label: "Year" },
  { by: "title", label: "Title" },
];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "2 pages, 1 deck"; "Not cited" when it is cited nowhere; a dash while it is being read. */
export function citedIn(uses: KeyUses | undefined): string {
  if (!uses) return "…";
  const parts = [uses.pages.length > 0 ? plural(uses.pages.length, "page") : "", uses.decks.length > 0 ? plural(uses.decks.length, "deck") : ""].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "Not cited";
}

export function RefTable({ rows, order, onOrder, selected, onSelect, ticked, onTick, onTickAll, uses }: Props) {
  const body = useRef<HTMLTableSectionElement>(null);
  const all = rows.length > 0 && rows.every((r) => ticked.has(r.id));

  /** Up and Down move to the next row and select it, as in a list. */
  const onKeyDown = (event: KeyboardEvent<HTMLTableSectionElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = [...(body.current?.querySelectorAll<HTMLButtonElement>("button[data-row]") ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[at + (event.key === "ArrowDown" ? 1 : -1)];
    if (at < 0 || !next) return;
    event.preventDefault();
    next.focus();
    onSelect(next.dataset.row!);
  };

  return (
    <table className="w-full table-fixed border-collapse text-13">
      <caption className="sr-only">References</caption>
      <colgroup>
        <col className="w-9" />
        <col className="w-48" />
        <col className="w-36" />
        <col className="w-14" />
        <col />
        <col className="w-40" />
        <col className="w-36" />
      </colgroup>
      <thead className="sticky top-0 z-10 bg-canvas text-12 text-muted">
        <tr className="border-b border-line">
          <th scope="col" className="px-2 py-2 text-left font-normal">
            <input type="checkbox" aria-label="Tick every reference shown" checked={all} onChange={(event) => onTickAll(event.target.checked)} />
          </th>
          {COLUMNS.slice(0, 3).map((column) => (
            <Head key={column.by} column={column} order={order} onOrder={onOrder} />
          ))}
          <Head column={COLUMNS[3]!} order={order} onOrder={onOrder} />
          <th scope="col" className="px-2 py-2 text-left font-normal">
            Link
          </th>
          <th scope="col" className="px-2 py-2 text-left font-normal">
            Cited in
          </th>
        </tr>
      </thead>
      <tbody ref={body} onKeyDown={onKeyDown}>
        {rows.map((row) => (
          <tr key={row.id} className={`border-b border-line align-top hover:bg-hover ${selected === row.id ? "bg-selected" : ""}`}>
            <td className="px-2 py-2">
              <input type="checkbox" aria-label={`Tick ${row.key}`} checked={ticked.has(row.id)} onChange={() => onTick(row.id)} />
            </td>
            <td className="px-2 py-2">
              <button type="button" data-row={row.id} aria-current={selected === row.id ? "true" : undefined} onClick={() => onSelect(row.id)} className="w-full truncate text-left font-mono text-12 hover:underline" title={`${row.key} in ${row.file}`}>
                {row.key}
              </button>
              <span className="mt-0.5 flex flex-wrap gap-1 text-11 text-muted">
                <span title={row.managed ? `In ${row.file}, which KastenFlow edits` : `In ${row.file}, which KastenFlow reads and does not change`}>{row.managed ? "Managed" : `External: ${row.file.slice(row.file.lastIndexOf("/") + 1)}`}</span>
                {row.duplicate && <span className="text-warning">Repeated</span>}
                {row.missing.length > 0 && <span title={`Missing: ${row.missing.join(", ")}`}>Incomplete</span>}
              </span>
            </td>
            <td className="truncate px-2 py-2" title={row.work.authors.join("; ")}>
              {row.authors || <span className="text-faint">No author</span>}
            </td>
            <td className="px-2 py-2 tabular-nums">{row.year || <span className="text-faint">—</span>}</td>
            <td className="px-2 py-2">{row.title || <span className="text-faint">No title</span>}</td>
            <td className="px-2 py-2">
              {row.link ? (
                <a href={row.link.href} target="_blank" rel="noreferrer noopener" className="inline-flex max-w-full items-center gap-1 text-accent hover:underline" title={row.link.href}>
                  <span className="truncate">{row.link.text}</span>
                  <Icon name="external" className="size-3 shrink-0" />
                </a>
              ) : (
                <span className="text-faint">—</span>
              )}
            </td>
            <td className="px-2 py-2 text-muted">{citedIn(uses.get(row.key))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Head({ column, order, onOrder }: { column: { by: RowOrder; label: string }; order: Order; onOrder(by: RowOrder): void }) {
  const active = order.by === column.by;
  return (
    <th scope="col" aria-sort={active ? (order.direction === "asc" ? "ascending" : "descending") : "none"} className="px-2 py-2 text-left font-normal">
      <button type="button" onClick={() => onOrder(column.by)} className="inline-flex items-center gap-1 hover:text-ink" aria-label={`Sort by ${column.label.toLowerCase()}`}>
        {column.label}
        {active && <Icon name={order.direction === "asc" ? "chevron-up" : "chevron-down"} className="size-3" />}
      </button>
    </th>
  );
}

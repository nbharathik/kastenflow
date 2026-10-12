// What a view shows and in which order: its filters and sorts as chips, a
// board's "group by" and a calendar's date. Every change is saved with the
// view in the tag's YAML.

import { useRef, useState } from "react";

import type { PropDef, TagSchema, TagView, ViewFilter } from "../../lib/vault/types";
import { Popup } from "../pages/page/Popup";
import { BUILT_IN, ROW_LABELS, keyLabel, spans } from "./model";

type Op = ViewFilter["op"];

const OPS: { op: Op; label: string; needs: boolean }[] = [
  { op: "is", label: "is", needs: true },
  { op: "is_not", label: "is not", needs: true },
  { op: "contains", label: "contains", needs: true },
  { op: "before", label: "is before", needs: true },
  { op: "after", label: "is after", needs: true },
  { op: "empty", label: "is empty", needs: false },
  { op: "not_empty", label: "is not empty", needs: false },
];

/** The keys a view can filter and sort by: the tag's properties, then built-ins (a view that spans tags and projects also has project, type and tags). */
function keysOf(schema: TagSchema | null, view: TagView): { key: string; label: string; def?: PropDef }[] {
  const props = (schema?.properties ?? []).map((def) => ({ key: def.key, label: def.key, def }));
  const own = new Set(props.map((p) => p.key));
  const fields = spans(view) ? { ...BUILT_IN, ...ROW_LABELS } : BUILT_IN;
  return [...props, ...Object.entries(fields).filter(([key]) => !own.has(key)).map(([key, label]) => ({ key, label }))];
}

const opLabel = (op: Op) => OPS.find((o) => o.op === op)?.label ?? op;
const valueLabel = (value: unknown) => (value === true ? "ticked" : value === false ? "not ticked" : String(value ?? ""));
const describe = (view: TagView, f: ViewFilter) => `${keyLabel(view, f.key)} ${opLabel(f.op)}${OPS.find((o) => o.op === f.op)?.needs ? ` ${valueLabel(f.value)}` : ""}`;

interface ViewBarProps {
  view: TagView;
  schema: TagSchema | null;
  shown: number;
  total: number;
  onChange(next: TagView): void;
  /** A quick find over the view's notes, kept out of the saved view. */
  find?: { query: string; onQuery(query: string): void };
}

export function ViewBar({ view, schema, shown, total, onChange, find }: ViewBarProps) {
  const keys = keysOf(schema, view);
  const filters = view.filter ?? [];
  const sorts = view.sort ?? [];
  const selects = (schema?.properties ?? []).filter((p) => p.type === "select");
  const dates = (schema?.properties ?? []).filter((p) => p.type === "date");
  const set = (patch: Partial<TagView>) => onChange({ ...view, ...patch });

  return (
    <div className="kasten-tagdb-bar" role="toolbar" aria-label="View settings">
      {view.type === "kanban" && selects.length > 0 && (
        <label className="kasten-tagdb-pick">
          Group by
          <select value={view.group_by ?? selects[0]!.key} onChange={(e) => set({ group_by: e.target.value })}>
            {selects.map((p) => (
              <option key={p.key}>{p.key}</option>
            ))}
          </select>
        </label>
      )}
      {view.type === "calendar" && dates.length > 0 && (
        <label className="kasten-tagdb-pick">
          By
          <select value={view.date ?? dates[0]!.key} onChange={(e) => set({ date: e.target.value })}>
            {dates.map((p) => (
              <option key={p.key}>{p.key}</option>
            ))}
          </select>
        </label>
      )}
      {filters.map((f, i) => (
        <span key={`f${i}`} className="kasten-tagdb-rule">
          {describe(view, f)}
          <button type="button" aria-label={`Remove the filter ${describe(view, f)}`} onClick={() => set({ filter: filters.filter((_, j) => j !== i) })}>
            ×
          </button>
        </span>
      ))}
      {view.type !== "calendar" &&
        sorts.map((s, i) => (
          <span key={`s${i}`} className="kasten-tagdb-rule">
            <button type="button" aria-label={`Sort ${keyLabel(view, s.key)} ${s.dir === "asc" ? "descending" : "ascending"}`} onClick={() => set({ sort: sorts.map((x, j) => (j === i ? { ...x, dir: x.dir === "asc" ? "desc" : "asc" } : x)) })}>
              {keyLabel(view, s.key)} {s.dir === "asc" ? "↑" : "↓"}
            </button>
            <button type="button" aria-label={`Remove the sort by ${keyLabel(view, s.key)}`} onClick={() => set({ sort: sorts.filter((_, j) => j !== i) })}>
              ×
            </button>
          </span>
        ))}
      <AddFilter keys={keys} onAdd={(f) => set({ filter: [...filters, f] })} />
      {view.type !== "calendar" && <AddSort keys={keys.filter((k) => !sorts.some((s) => s.key === k.key))} onAdd={(key) => set({ sort: [...sorts, { key, dir: "asc" }] })} />}
      <span className="flex-1" />
      {find && (
        <input
          type="search"
          value={find.query}
          onChange={(e) => find.onQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && find.query && (e.stopPropagation(), find.onQuery(""))}
          placeholder="Find in view…"
          aria-label="Find in this view"
          className="kasten-tagdb-find"
        />
      )}
      {shown !== total && (
        <span className="text-13 text-muted">
          {shown.toLocaleString()} of {total.toLocaleString()}
        </span>
      )}
    </div>
  );
}

function AddFilter({ keys, onAdd }: { keys: ReturnType<typeof keysOf>; onAdd: (f: ViewFilter) => void }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const [key, setKey] = useState(keys[0]?.key ?? "title");
  const [op, setOp] = useState<Op>("is");
  const [value, setValue] = useState("");
  const def = keys.find((k) => k.key === key)?.def;
  const needs = OPS.find((o) => o.op === op)?.needs ?? false;
  // A checkbox starts as "ticked", as its menu shows.
  const ticked = value !== "false";
  const add = () => {
    const filterValue = def?.type === "checkbox" ? ticked : def?.type === "number" && value.trim() ? Number(value) : value.trim();
    onAdd(needs ? { key, op, value: filterValue } : { key, op });
    setOpen(false);
    setValue("");
  };
  return (
    <span className="relative">
      <button ref={button} type="button" className="kasten-tagdb-add" onClick={() => setOpen(!open)}>
        + Filter
      </button>
      {open && (
        <Popup label="Add a filter" anchor={button} onClose={() => setOpen(false)} className="kasten-tagdb-popup">
          <select
            aria-label="Property"
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setValue("");
            }}
          >
            {keys.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </select>
          <select aria-label="Condition" value={op} onChange={(e) => setOp(e.target.value as Op)}>
            {OPS.map((o) => (
              <option key={o.op} value={o.op}>
                {o.label}
              </option>
            ))}
          </select>
          {needs &&
            (def?.type === "select" || def?.type === "multi_select" ? (
              <select aria-label="Value" value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="">Choose…</option>
                {def.options.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : def?.type === "checkbox" ? (
              <select aria-label="Value" value={ticked ? "true" : "false"} onChange={(e) => setValue(e.target.value)}>
                <option value="true">ticked</option>
                <option value="false">not ticked</option>
              </select>
            ) : (
              <input aria-label="Value" type={def?.type === "date" || op === "before" || op === "after" ? "date" : def?.type === "number" ? "number" : "text"} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
            ))}
          <button type="button" className="kasten-tagdb-button is-primary" disabled={needs && def?.type !== "checkbox" && !value.trim()} onClick={add}>
            Add filter
          </button>
        </Popup>
      )}
    </span>
  );
}

function AddSort({ keys, onAdd }: { keys: ReturnType<typeof keysOf>; onAdd: (key: string) => void }) {
  if (keys.length === 0) return null;
  return (
    <label className="kasten-tagdb-add">
      <span className="sr-only">Sort by</span>
      <select
        aria-label="Add a sort"
        value=""
        onChange={(e) => {
          if (e.target.value) onAdd(e.target.value);
        }}
      >
        <option value="">+ Sort</option>
        {keys.map((k) => (
          <option key={k.key} value={k.key}>
            {k.label}
          </option>
        ))}
      </select>
    </label>
  );
}

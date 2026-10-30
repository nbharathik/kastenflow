// What a view shows and in which order: its filters and sorts as chips, a
// board's "group by" and a calendar's date. Every change is saved with the
// view in the tag's YAML.

import { useRef, useState } from "react";

import type { PropDef, TagSchema, TagView, ViewFilter } from "../../lib/vault/types";
import { Dropdown } from "../library/Dropdown";
import { Popup } from "../pages/page/Popup";
import { useFrontActions } from "./in-front";
import { BUILT_IN, ROW_LABELS, keyLabel, spans } from "./model";
import { altMove, moveSort } from "./sort-order";
import type { SubItems } from "./sub-items";
import { SubItemsMenu } from "./SubItemsMenu";
import { TableOptions } from "./TableOptions";
import { collapseAll, expandAll } from "./views/table/open-rows";
import { groupChoices } from "./views/table/group";
import { TimelineSettings } from "./views/timeline/TimelineSettings";

type Op = ViewFilter["op"];

const OPS: { op: Op; label: string; needs: boolean }[] = [
  { op: "is", label: "is", needs: true },
  { op: "is_not", label: "is not", needs: true },
  { op: "contains", label: "contains", needs: true },
  { op: "before", label: "is before", needs: true },
  { op: "after", label: "is after", needs: true },
  { op: "gt", label: "is more than", needs: true },
  { op: "gte", label: "is at least", needs: true },
  { op: "lt", label: "is less than", needs: true },
  { op: "lte", label: "is at most", needs: true },
  { op: "empty", label: "is empty", needs: false },
  { op: "not_empty", label: "is not empty", needs: false },
];

const NUMERIC: readonly Op[] = ["gt", "gte", "lt", "lte"];

/** The conditions a property offers: the number ones only for numbers and calculated values. */
const opsFor = (def: PropDef | undefined) => OPS.filter((o) => !NUMERIC.includes(o.op) || def?.type === "number" || def?.type === "formula");

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
  /** The "Sub-items" menu's data (useSubItems); without it the bar has no such menu. */
  subItems?: { menu: SubItems["menu"]; present: boolean };
}

export function ViewBar({ view, schema, shown, total, onChange, find, subItems }: ViewBarProps) {
  const keys = keysOf(schema, view);
  const filters = view.filter ?? [];
  const sorts = view.sort ?? [];
  const selects = (schema?.properties ?? []).filter((p) => p.type === "select");
  const dates = (schema?.properties ?? []).filter((p) => p.type === "date");
  const set = (patch: Partial<TagView>) => onChange({ ...view, ...patch });
  // The sort chip being dragged to a new place in the order.
  const [dragging, setDragging] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const menu = subItems?.menu ?? null;
  const subOn = view.type === "table" && view.sub_items === true && menu !== null;
  // What the palette can do to this view (see commands.ts).
  useFrontActions("bar", root, {
    view,
    schema,
    onChange,
    groups: view.type === "table" ? groupChoices(view, schema) : undefined,
    expandAll: subOn && menu.parents.length > 0 ? () => expandAll(menu.openKey, menu.parents) : undefined,
    collapseAll: subOn ? () => collapseAll(menu.openKey) : undefined,
  });

  return (
    <div ref={root} className="kasten-tagdb-bar" role="toolbar" aria-label="View settings">
      {view.type === "kanban" && selects.length > 0 && (
        <Dropdown label="Group by" value={view.group_by ?? selects[0]!.key} options={selects.map((p) => ({ value: p.key, label: p.key }))} onChange={(group_by) => set({ group_by })} />
      )}
      {view.type === "calendar" && dates.length > 0 && (
        <Dropdown label="By" value={view.date ?? dates[0]!.key} options={dates.map((p) => ({ value: p.key, label: p.key }))} onChange={(date) => set({ date })} />
      )}
      {view.type === "timeline" && <TimelineSettings view={view} schema={schema} onChange={onChange} />}
      {subItems && <SubItemsMenu view={view} menu={subItems.menu} present={subItems.present} onChange={onChange} />}
      <TableOptions view={view} schema={schema} onChange={onChange} />
      {filters.map((f, i) => (
        <span key={`f${i}`} className="kasten-tagdb-rule">
          {describe(view, f)}
          <button type="button" aria-label={`Remove the filter ${describe(view, f)}`} onClick={() => set({ filter: filters.filter((_, j) => j !== i) })}>
            ×
          </button>
        </span>
      ))}
      {filters.length > 1 && (
        <button
          type="button"
          className="kasten-tagdb-rule"
          aria-label={view.filter_mode === "any" ? "Notes match any filter; change to all" : "Notes match all filters; change to any"}
          onClick={() => set({ filter_mode: view.filter_mode === "any" ? "all" : "any" })}
        >
          {view.filter_mode === "any" ? "Match any" : "Match all"}
        </button>
      )}
      {view.type !== "calendar" && view.type !== "timeline" &&
        sorts.map((s, i) => (
          <span
            key={`s:${s.key}:${sorts.slice(0, i).filter((x) => x.key === s.key).length}`}
            className={`kasten-tagdb-rule${dragging === i ? " is-dragging" : ""}`}
            draggable={sorts.length > 1}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", keyLabel(view, s.key));
              setDragging(i);
            }}
            onDragOver={(e) => dragging !== null && e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging !== null) set({ sort: [...moveSort(sorts, dragging, i)] });
              setDragging(null);
            }}
            onDragEnd={() => setDragging(null)}
          >
            <button
              type="button"
              aria-label={`Sort ${keyLabel(view, s.key)} ${s.dir === "asc" ? "descending" : "ascending"}`}
              title={sorts.length > 1 ? `Drag, or Alt with an arrow key, to change the order (${i + 1} of ${sorts.length})` : undefined}
              onClick={() => set({ sort: sorts.map((x, j) => (j === i ? { ...x, dir: x.dir === "asc" ? "desc" : "asc" } : x)) })}
              onKeyDown={(e) => {
                const to = e.altKey ? altMove(e.key, i) : null;
                if (to === null || to < 0 || to >= sorts.length) return;
                e.preventDefault();
                set({ sort: [...moveSort(sorts, i, to)] });
              }}
            >
              {sorts.length > 1 && <span className="text-muted">{i + 1}</span>} {keyLabel(view, s.key)} {s.dir === "asc" ? "↑" : "↓"}
            </button>
            <button type="button" aria-label={`Remove the sort by ${keyLabel(view, s.key)}`} onClick={() => set({ sort: sorts.filter((_, j) => j !== i) })}>
              ×
            </button>
          </span>
        ))}
      <AddFilter keys={keys} onAdd={(f) => set({ filter: [...filters, f] })} />
      {view.type !== "calendar" && view.type !== "timeline" && <AddSort keys={keys.filter((k) => !sorts.some((s) => s.key === k.key))} onAdd={(key) => set({ sort: [...sorts, { key, dir: "asc" }] })} />}
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
  const offered = opsFor(def);
  // A condition the property does not offer gives way to the first that it does.
  const shownOp: Op = offered.some((o) => o.op === op) ? op : offered[0]!.op;
  const needs = OPS.find((o) => o.op === shownOp)?.needs ?? false;
  const counting = NUMERIC.includes(shownOp);
  // A checkbox starts as "ticked", as its menu shows.
  const ticked = value !== "false";
  const add = () => {
    const numeric = def?.type === "number" || counting;
    const filterValue = def?.type === "checkbox" ? ticked : numeric && value.trim() && Number.isFinite(Number(value)) ? Number(value) : value.trim();
    onAdd(needs ? { key, op: shownOp, value: filterValue } : { key, op: shownOp });
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
          <Dropdown
            label="Property"
            value={key}
            options={keys.map((k) => ({ value: k.key, label: k.label }))}
            onChange={(next) => {
              setKey(next);
              setValue("");
            }}
          />
          <Dropdown label="Condition" value={shownOp} options={offered.map((o) => ({ value: o.op, label: o.label }))} onChange={(next) => setOp(next as Op)} />
          {needs &&
            (def?.type === "select" || def?.type === "multi_select" ? (
              <Dropdown label="Value" value={value} display={value || "Choose…"} options={def.options.map((o) => ({ value: o, label: o }))} onChange={setValue} />
            ) : def?.type === "checkbox" ? (
              <Dropdown
                label="Value"
                value={ticked ? "true" : "false"}
                options={[
                  { value: "true", label: "ticked" },
                  { value: "false", label: "not ticked" },
                ]}
                onChange={setValue}
              />
            ) : (
              <input aria-label="Value" type={def?.type === "date" || shownOp === "before" || shownOp === "after" ? "date" : def?.type === "number" || counting ? "number" : "text"} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
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
    <Dropdown label="Sort" value="" display="+ Sort" options={keys.map((k) => ({ value: k.key, label: k.label }))} onChange={(key) => key && onAdd(key)} />
  );
}

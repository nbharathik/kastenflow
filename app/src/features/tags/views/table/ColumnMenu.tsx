// A column's menu (sort, move, hide) and the "+" menu that shows hidden
// properties again. Every choice is saved with the view in the tag's YAML.

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";

import type { TagSchema, TagView } from "../../../../lib/vault/types";
import { hiddenColumns, hideColumn, moveColumn, showColumn, sortColumn, sortOf, type Column } from "./columns";
import { Floating } from "./Floating";
import { own } from "./format";
import { calcOf, defaultCalc, kindOf, withCalc } from "./calc";
import { groupChoices, withGroup } from "./group";
import { Glyph, TitleMark } from "./icons";

const TYPE_NAMES: Record<string, string> = {
  title: "Title",
  text: "Text",
  number: "Number",
  select: "Select",
  multi_select: "Multi-select",
  date: "Date",
  checkbox: "Checkbox",
  url: "URL",
  relation: "Relation",
};

export const typeName = (column: Column) => (column.kind === "builtin" ? "Note field" : (own(TYPE_NAMES, column.type) ?? column.type));

/** Arrow keys between a menu's items; the first takes focus when it opens. */
export function useMenuKeys(onClose: () => void) {
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    menu.current?.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
  }, []);
  const onKeyDown = (e: KeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    } else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      onClose();
    }
  };
  return { menu, onKeyDown };
}

interface ItemProps {
  icon: string;
  label: string;
  disabled?: boolean;
  onSelect(): void;
}

export function Item({ icon, label, disabled, onSelect }: ItemProps) {
  return (
    <button type="button" role="menuitem" className="kasten-table-menu-item" disabled={disabled} onClick={onSelect}>
      <Glyph name={icon} />
      <span>{label}</span>
    </button>
  );
}

interface ColumnMenuProps {
  anchor: RefObject<HTMLElement | null>;
  column: Column;
  /** Its place among the columns, the title being 0. */
  index: number;
  count: number;
  view: TagView;
  schema: TagSchema | null;
  change(next: TagView): void;
  /** `refocus` gives keys back to the header's button. */
  onClose(refocus: boolean): void;
}

export function ColumnMenu({ anchor, column, index, count, view, schema, change, onClose }: ColumnMenuProps) {
  const { menu, onKeyDown } = useMenuKeys(() => onClose(true));
  const act = (next: TagView) => {
    onClose(true);
    if (next !== view) change(next);
  };
  const dir = sortOf(view, column.key);
  const groupable = view.type === "table" && groupChoices(view, schema).some((c) => c.key === column.key);
  const grouped = view.group_by === column.key;
  return (
    <Floating anchor={anchor} role="menu" label={`${column.label} column`} onClose={() => onClose(false)} minWidth={210}>
      <div ref={menu} className="kasten-table-menu" onKeyDown={onKeyDown}>
        <div className="kasten-table-menu-head">
          {column.kind === "title" ? <TitleMark /> : <Glyph name={column.type} />}
          <span className="truncate">{column.label}</span>
          <span className="kasten-table-menu-type">{typeName(column)}</span>
        </div>
        <Item icon="up" label={dir === "asc" ? "Sorted ascending" : "Sort ascending"} disabled={dir === "asc" && view.sort?.length === 1} onSelect={() => act(sortColumn(view, column.key, "asc"))} />
        <Item icon="down" label={dir === "desc" ? "Sorted descending" : "Sort descending"} disabled={dir === "desc" && view.sort?.length === 1} onSelect={() => act(sortColumn(view, column.key, "desc"))} />
        {!calcOf(view, column) && <Item icon="number" label="Calculate" onSelect={() => act(withCalc(view, column.key, defaultCalc(kindOf(column))))} />}
        {groupable && <Item icon="select" label={grouped ? "Remove grouping" : "Group by this column"} onSelect={() => act(withGroup(view, grouped ? null : column.key))} />}
        {column.kind !== "title" && (
          <>
            <hr className="kasten-table-menu-line" />
            <Item icon="left" label="Move left" disabled={index <= 1} onSelect={() => act(moveColumn(view, schema, column.key, -1))} />
            <Item icon="right" label="Move right" disabled={index >= count - 1} onSelect={() => act(moveColumn(view, schema, column.key, 1))} />
            <Item icon="hide" label="Hide in this view" onSelect={() => act(hideColumn(view, schema, column.key))} />
          </>
        )}
      </div>
    </Floating>
  );
}

interface AddColumnProps {
  view: TagView;
  schema: TagSchema | null;
  change(next: TagView): void;
}

/** "+" at the end of the header: the properties this view hides, to show again. */
export function AddColumn({ view, schema, change }: AddColumnProps) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus({ preventScroll: true });
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        className="kasten-table-add-col"
        aria-label="Show a property"
        title="Show a property"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Glyph name="plus" />
      </button>
      {open && <AddColumnMenu anchor={button} view={view} schema={schema} change={change} onClose={close} />}
    </>
  );
}

function AddColumnMenu({ anchor, view, schema, change, onClose }: AddColumnProps & { anchor: RefObject<HTMLElement | null>; onClose(refocus: boolean): void }) {
  const { menu, onKeyDown } = useMenuKeys(() => onClose(true));
  const hidden = hiddenColumns(view, schema);
  const props = hidden.filter((c) => c.kind === "prop");
  const fields = hidden.filter((c) => c.kind === "builtin");
  const show = (column: Column) => {
    onClose(true);
    change(showColumn(view, schema, column.key));
  };
  return (
    <Floating anchor={anchor} role="menu" label="Show a property" onClose={() => onClose(false)} minWidth={230}>
      <div ref={menu} className="kasten-table-menu" onKeyDown={onKeyDown}>
        <div className="kasten-table-menu-label">{props.length > 0 ? "Hidden properties" : schema?.properties.length ? "Every property is shown" : "No properties yet: add them with Properties"}</div>
        {props.map((column) => (
          <Item key={column.key} icon={column.type} label={column.label} onSelect={() => show(column)} />
        ))}
        {fields.length > 0 && (
          <>
            <hr className="kasten-table-menu-line" />
            <div className="kasten-table-menu-label">Note fields</div>
            {fields.map((column) => (
              <Item key={column.key} icon={column.type} label={column.label} onSelect={() => show(column)} />
            ))}
          </>
        )}
      </div>
    </Floating>
  );
}

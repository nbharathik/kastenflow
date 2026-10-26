// A tag database's views as tabs: "+ View" adds a table, board, list,
// gallery or calendar; the active one's menu renames, duplicates or
// deletes it.
// Double-click a tab to rename it.

import { useState } from "react";

import type { TagSchema, TagView, TagViewKind } from "../../lib/vault/types";
import { Menu, type MenuItem } from "../../shell/Menu";
import { useWorkspace } from "../workspace/store";
import { KIND_NAMES, VIEW_KINDS, freshName, newView } from "./model";
import { Icon } from "../../ui/Icon";
import type { IconName } from "../../ui/icons";

export const KIND_ICONS: Record<TagViewKind, IconName> = { table: "table", kanban: "kanban", list: "list", calendar: "calendar", gallery: "gallery", timeline: "calendar-days" };

interface ViewTabsProps {
  views: TagView[];
  active: number;
  schema: TagSchema | null;
  onSelect(index: number): void;
  /** Saves the views, then shows `selected` when given. */
  onSave(next: TagView[], selected?: string): void;
}

export function ViewTabs({ views, active, schema, onSelect, onSave }: ViewTabsProps) {
  const [renaming, setRenaming] = useState<number | null>(null);
  const hasDate = (schema?.properties ?? []).some((p) => p.type === "date");
  const add = (kind: TagViewKind) => {
    // A timeline places notes by a date property; without one there is nothing to start from.
    if (kind === "timeline" && !hasDate) {
      useWorkspace.getState().toast("A timeline needs a date property. Add one with Properties at the top, then add the timeline.");
      return;
    }
    const view = newView(kind, schema, views);
    onSave([...views, view], view.name);
  };
  const menu = (view: TagView, i: number): (MenuItem | "divider")[] => [
    { label: "Rename", icon: <Icon name="edit" className="size-4" />, onSelect: () => setRenaming(i) },
    {
      label: "Duplicate",
      icon: <Icon name="copy" className="size-4" />,
      onSelect: () => {
        const copy = { ...view, name: freshName(views, view.name) };
        onSave([...views.slice(0, i + 1), copy, ...views.slice(i + 1)], copy.name);
      },
    },
    ...(views.length > 1
      ? (["divider", { label: "Delete view", icon: <Icon name="trash" className="size-4" />, danger: true, onSelect: () => onSave(views.filter((_, j) => j !== i), views[i === 0 ? 1 : i - 1]!.name) }] as const)
      : []),
  ];
  return (
    <div className="kasten-tagdb-tabs">
      <div role="tablist" aria-label="Views" className="contents">
        {views.map((view, i) =>
          renaming === i ? (
            <RenameField
              key={view.name}
              name={view.name}
              taken={views.filter((_, j) => j !== i).map((v) => v.name.toLowerCase())}
              onDone={(name) => {
                setRenaming(null);
                if (name && name !== view.name) onSave(views.map((v, j) => (j === i ? { ...v, name } : v)), name);
              }}
            />
          ) : (
            <span key={view.name} className={`kasten-tagdb-tab ${i === active ? "is-active" : ""}`}>
              <button type="button" role="tab" aria-selected={i === active} onClick={() => onSelect(i)} onDoubleClick={() => setRenaming(i)}>
                <span aria-hidden="true" className="kasten-tagdb-tab-icon">
                  <Icon name={KIND_ICONS[view.type]} className="size-[15px]" />
                </span>
                {view.name}
              </button>
              {i === active && (
                <Menu label={`Options for the view ${view.name}`} align="left" buttonClass="kasten-tagdb-tab-more" items={menu(view, i)}>
                  <Icon name="more" className="size-4" />
                </Menu>
              )}
            </span>
          ),
        )}
      </div>
      <Menu label="Add a view" align="left" buttonClass="kasten-tagdb-add-view" items={VIEW_KINDS.map((kind) => ({ label: KIND_NAMES[kind], icon: <Icon name={KIND_ICONS[kind]} className="size-4" />, hint: kind === "timeline" && !hasDate ? "needs a date" : undefined, onSelect: () => add(kind) }))}>
        + View
      </Menu>
    </div>
  );
}

function RenameField({ name, taken, onDone }: { name: string; taken: string[]; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(name);
  const clash = taken.includes(value.trim().toLowerCase());
  const finish = () => onDone(value.trim() && !clash ? value.trim() : null);
  return (
    <input
      autoFocus
      aria-label="View name"
      aria-invalid={clash}
      className="kasten-tagdb-rename"
      value={value}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish();
        if (e.key === "Escape") onDone(null);
      }}
    />
  );
}

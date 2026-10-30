// The view bar's "Sub-items" menu. A table: "Show sub-items" (off by default),
// and while on, Expand all and Collapse all. The other views: "Hide sub-items".
// The calendar has none. The choice is saved with the view.

import type { TagView } from "../../lib/vault/types";
import { Menu, type MenuEntry } from "../../shell/Menu";
import type { SubItems } from "./sub-items";
import { collapseAll, expandAll } from "./views/table/open-rows";

interface Props {
  view: TagView;
  /** What the menu needs, from useSubItems. */
  menu: SubItems["menu"];
  /** Whether any note here is a sub-item of another, so the switch means something. */
  present: boolean;
  onChange(next: TagView): void;
}

const without = (view: TagView, key: "sub_items" | "hide_sub_items"): TagView => {
  const next = { ...view };
  delete next[key];
  return next;
};

export function SubItemsMenu({ view, menu, present, onChange }: Props) {
  if (view.type === "calendar") return null;
  let items: MenuEntry[];
  if (view.type === "table") {
    const on = view.sub_items === true;
    items = [{ label: "Show sub-items", checked: on, onSelect: () => onChange(on ? without(view, "sub_items") : { ...view, sub_items: true }) }];
    if (on && menu) {
      items.push("divider");
      if (menu.parents.length > 0) items.push({ label: "Expand all", onSelect: () => expandAll(menu.openKey, menu.parents) });
      items.push({ label: "Collapse all", onSelect: () => collapseAll(menu.openKey) });
    }
  } else {
    const hidden = view.hide_sub_items === true;
    if (!present && !hidden) return null;
    items = [{ label: "Hide sub-items", checked: hidden, onSelect: () => onChange(hidden ? without(view, "hide_sub_items") : { ...view, hide_sub_items: true }) }];
  }
  return (
    <Menu label="Sub-items options" align="left" buttonClass="kasten-tagdb-add" items={items}>
      Sub-items
    </Menu>
  );
}

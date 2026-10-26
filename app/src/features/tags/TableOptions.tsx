// The table's own settings in the view bar: "Group by" and a "Display" menu
// (wrapped cells, row density, the frozen title column, the calculations
// row). Every choice is saved with the view.

import type { TagSchema, TagView } from "../../lib/vault/types";
import { Menu, type MenuEntry } from "../../shell/Menu";
import { Dropdown } from "../library/Dropdown";
import { showsCalcs, withCalcRow } from "./views/table/calc";
import { densityOf, frozenOf, wrapOf } from "./views/table/display";
import { groupChoices, groupSpec, withGroup } from "./views/table/group";

interface Props {
  view: TagView;
  schema: TagSchema | null;
  onChange(next: TagView): void;
}

const NO_GROUP = "";

/** The view with a true-or-false setting changed; one at its default is left out of the file. */
function withFlag(view: TagView, key: "wrap" | "freeze_title", on: boolean, fallback: boolean): TagView {
  const next = { ...view };
  if (on === fallback) delete next[key];
  else next[key] = on;
  return next;
}

export function TableOptions({ view, schema, onChange }: Props) {
  if (view.type !== "table") return null;
  const choices = groupChoices(view, schema);
  const spec = groupSpec(view, schema);
  const density = densityOf(view);
  const items: MenuEntry[] = [
    { label: "Wrap cells", checked: wrapOf(view), onSelect: () => onChange(withFlag(view, "wrap", !wrapOf(view), false)) },
    { label: "Freeze the title column", checked: frozenOf(view), onSelect: () => onChange(withFlag(view, "freeze_title", !frozenOf(view), true)) },
    { label: "Show calculations", checked: showsCalcs(view), onSelect: () => onChange(withCalcRow(view, !showsCalcs(view))) },
    "divider",
    { heading: "Row height" },
    {
      label: "Comfortable",
      checked: density === "comfortable",
      onSelect: () => {
        const next = { ...view };
        delete next.density;
        onChange(next);
      },
    },
    { label: "Compact", checked: density === "compact", onSelect: () => onChange({ ...view, density: "compact" }) },
  ];
  return (
    <>
      {choices.length > 0 && (
        <Dropdown
          label="Group by"
          value={spec ? spec.key : NO_GROUP}
          display={spec ? `Group: ${choices.find((c) => c.key === spec.key)?.label ?? spec.key}` : "Group"}
          active={spec !== null}
          options={[{ value: NO_GROUP, label: "No grouping" }, ...choices.map((c) => ({ value: c.key, label: c.label }))]}
          onChange={(key) => onChange(withGroup(view, key || null))}
        />
      )}
      <Menu label="Display options" align="left" buttonClass="kasten-tagdb-add" items={items}>
        Display
      </Menu>
    </>
  );
}

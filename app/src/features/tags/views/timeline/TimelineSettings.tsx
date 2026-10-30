// A timeline's settings in the view bar: the date property bars begin at, the
// one they end at (none: markers) and the property that makes lanes. Each
// change is saved with the view; the start is always written, so the view
// stays one the core accepts.

import type { TagSchema, TagView } from "../../../../lib/vault/types";
import { Dropdown } from "../../../library/Dropdown";
import { dateDefs, keysOf, laneDef } from "./items";

interface Props {
  view: TagView;
  schema: TagSchema | null;
  onChange(next: TagView): void;
}

export function TimelineSettings({ view, schema, onChange }: Props) {
  const keys = keysOf(view, schema);
  if (!keys) return null;
  const dates = dateDefs(schema);
  const lanes = (schema?.properties ?? []).filter((p) => p.type === "select" || p.type === "multi_select" || p.type === "relation");
  const lane = laneDef(view, schema)?.key ?? "";
  const save = (patch: { start?: string; end?: string; group_by?: string }) => {
    const next: TagView = { ...view, start: keys.start };
    if (keys.end) next.end = keys.end;
    else delete next.end;
    if (lane) next.group_by = lane;
    else delete next.group_by;
    for (const [key, value] of Object.entries(patch)) {
      if (value) next[key] = value;
      else delete next[key];
    }
    // The end must be another property than the start.
    if (next.end === next.start) delete next.end;
    onChange(next);
  };
  return (
    <>
      <Dropdown label="Starts at" value={keys.start} options={dates.map((p) => ({ value: p.key, label: p.key }))} onChange={(start) => save({ start })} />
      <Dropdown
        label="Ends at"
        value={keys.end ?? ""}
        display={keys.end ?? "No end"}
        options={[{ value: "", label: "No end (markers)" }, ...dates.filter((p) => p.key !== keys.start).map((p) => ({ value: p.key, label: p.key }))]}
        onChange={(end) => save({ end })}
      />
      <Dropdown label="Lanes by" value={lane} display={lane || "No lanes"} options={[{ value: "", label: "No lanes" }, ...lanes.map((p) => ({ value: p.key, label: p.key }))]} onChange={(group_by) => save({ group_by })} />
    </>
  );
}

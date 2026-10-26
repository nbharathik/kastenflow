import { describe, expect, it } from "vitest";

import type { PropDef, TagSchema, TagView } from "../../../../lib/vault/types";
import { metaFor } from "../../../workspace/preview/note-meta";
import { daysOf, itemOf, keysOf, laneDef, lanesOf, newDatesTarget, readItems, targetOf, withPending } from "./items";

const STATUS: PropDef = { key: "status", type: "select", options: ["Todo", "Doing", "Done"] };
const SCHEMA: TagSchema = {
  name: "task",
  color: null,
  path: "tags/task.yaml",
  properties: [
    STATUS,
    { key: "begin", type: "date", options: [] },
    { key: "finish", type: "date", options: [] },
    { key: "days_left", type: "formula", options: [], formula: "days_until(finish)" },
    { key: "title_text", type: "text", options: [] },
  ],
  views: [],
};
const VIEW: TagView = { name: "Plan", type: "timeline", start: "begin", end: "finish", group_by: "status" };

const note = (path: string, props: Record<string, string> = {}) =>
  metaFor(path, `---\ntitle: ${path}\ntags: [task]\nprops:\n${Object.entries(props).map(([k, v]) => `  ${k}: ${v}\n`).join("")}---\nBody\n`, 0);

describe("timeline keys of a view", () => {
  it("uses the properties the view names", () => {
    expect(keysOf(VIEW, SCHEMA)).toEqual({ start: "begin", end: "finish", startLocked: false, endLocked: false });
  });

  it("starts from the first date property when the view names none or a wrong one", () => {
    expect(keysOf({ name: "P", type: "timeline" }, SCHEMA)).toEqual({ start: "begin", end: null, startLocked: false, endLocked: false });
    expect(keysOf({ name: "P", type: "timeline", start: "title_text", end: "nowhere" }, SCHEMA)).toEqual({ start: "begin", end: null, startLocked: false, endLocked: false });
  });

  it("does not use the same property for both, and marks a calculated one as locked", () => {
    expect(keysOf({ ...VIEW, end: "begin" }, SCHEMA)!.end).toBeNull();
    expect(keysOf({ ...VIEW, end: "days_left" }, SCHEMA)).toMatchObject({ end: "days_left", endLocked: true });
    expect(keysOf({ ...VIEW, start: "days_left" }, SCHEMA)).toMatchObject({ start: "days_left", startLocked: true });
  });

  it("has no keys for a tag without a date property", () => {
    expect(keysOf(VIEW, { ...SCHEMA, properties: [STATUS] })).toBeNull();
    expect(keysOf(VIEW, null)).toBeNull();
  });

  it("makes lanes only from a select, multi select or relation", () => {
    expect(laneDef(VIEW, SCHEMA)).toBe(STATUS);
    expect(laneDef({ ...VIEW, group_by: "begin" }, SCHEMA)).toBeNull();
    expect(laneDef({ ...VIEW, group_by: undefined }, SCHEMA)).toBeNull();
  });
});

describe("timeline items", () => {
  const keys = keysOf(VIEW, SCHEMA)!;

  it("reads a bar, a marker and a note without dates", () => {
    const bar = itemOf(note("a.md", { begin: "2026-10-05", finish: "2026-10-07" }), keys);
    expect(bar.dates).toEqual({ start: "2026-10-05", end: "2026-10-07" });
    expect(bar.reversed).toBe(false);
    expect(itemOf(note("b.md", { begin: "2026-10-05" }), keys).dates).toEqual({ start: "2026-10-05", end: null });
    expect(itemOf(note("c.md", {}), keys).dates).toBeNull();
    // An end with no start is not enough to place it.
    expect(itemOf(note("d.md", { finish: "2026-10-07" }), keys).dates).toBeNull();
  });

  it("takes the day of a date with a time, and leaves out dates it cannot place", () => {
    expect(itemOf(note("a.md", { begin: "'2026-10-05T09:30'" }), keys).dates?.start).toBe("2026-10-05");
    expect(itemOf(note("b.md", { begin: "2026-13-45" }), keys).dates).toBeNull();
    expect(itemOf(note("c.md", { begin: "0003-01-01" }), keys).dates).toBeNull();
    expect(itemOf(note("d.md", { begin: "2026-10-05", finish: "2999-01-01" }), keys).dates).toEqual({ start: "2026-10-05", end: null });
  });

  it("flags an end before the start", () => {
    const item = itemOf(note("a.md", { begin: "2026-10-05", finish: "2026-10-02" }), keys);
    expect(item.reversed).toBe(true);
    expect(item.dates).toEqual({ start: "2026-10-05", end: "2026-10-02" });
  });

  it("locks an item whose dates are calculated", () => {
    const calc = keysOf({ ...VIEW, start: "days_left" }, SCHEMA)!;
    expect(itemOf(note("a.md", { days_left: "2026-10-05" }), calc).locked).toBe(true);
    expect(itemOf(note("a.md", { begin: "2026-10-05" }), keys).locked).toBe(false);
  });

  it("splits dated from undated and sorts the dated by start, then end, then title", () => {
    const { dated, undated } = readItems(
      [note("z.md", { begin: "2026-10-09" }), note("none.md"), note("b.md", { begin: "2026-10-05", finish: "2026-10-08" }), note("a.md", { begin: "2026-10-05", finish: "2026-10-06" }), note("also-none.md")],
      keys,
    );
    expect(dated.map((i) => i.id)).toEqual(["a.md", "b.md", "z.md"]);
    expect(undated.map((i) => i.id)).toEqual(["none.md", "also-none.md"]);
  });

  it("shows items at the days they are moving to", () => {
    const items = readItems([note("a.md", { begin: "2026-10-05", finish: "2026-10-07" }), note("m.md", { begin: "2026-10-05" })], keys).dated;
    expect(withPending(items, new Map())).toEqual(items);
    const shown = withPending(
      items,
      new Map([
        ["a.md", ["2026-10-09", "2026-10-11"]],
        ["m.md", ["2026-10-06"]],
      ]),
    );
    expect(shown.find((i) => i.id === "a.md")!.dates).toEqual({ start: "2026-10-09", end: "2026-10-11" });
    expect(shown.find((i) => i.id === "m.md")!.dates).toEqual({ start: "2026-10-06", end: null });
    // An item that is not moving is the very same object.
    const [first, second] = [items[0]!, items[1]!];
    const only = withPending(items, new Map([[first.id, ["2026-10-20", "2026-10-21"]]]));
    expect(only[1]).toBe(second);
  });

  it("makes the target of a change: both keys for a bar, the start for a marker", () => {
    const bar = readItems([note("a.md", { begin: "2026-10-05", finish: "2026-10-07" })], keys).dated[0]!;
    const marker = readItems([note("m.md", { begin: "2026-10-05" })], keys).dated[0]!;
    const barTarget = targetOf(bar, keys);
    expect([barTarget.keys, barTarget.days]).toEqual([["begin", "finish"], ["2026-10-05", "2026-10-07"]]);
    const markerTarget = targetOf(marker, keys);
    expect([markerTarget.keys, markerTarget.days]).toEqual([["begin"], ["2026-10-05"]]);
    expect(daysOf({ start: "2026-10-08", end: "2026-10-10" }, barTarget)).toEqual(["2026-10-08", "2026-10-10"]);
    expect(daysOf({ start: "2026-10-08", end: null }, markerTarget)).toEqual(["2026-10-08"]);
  });

  it("gives an undated note today as both dates when the view has an end, else as its start", () => {
    const item = readItems([note("n.md")], keys).undated[0]!;
    expect(newDatesTarget(item, keys, "2026-10-23")).toMatchObject({ days: ["2026-10-23", "2026-10-23"], target: { keys: ["begin", "finish"] } });
    expect(newDatesTarget(item, { ...keys, end: null }, "2026-10-23")).toMatchObject({ days: ["2026-10-23"], target: { keys: ["begin"] } });
    expect(newDatesTarget(item, { ...keys, endLocked: true }, "2026-10-23").target.keys).toEqual(["begin"]);
  });
});

describe("timeline lanes", () => {
  const keys = keysOf(VIEW, SCHEMA)!;
  const items = readItems([note("a.md", { begin: "2026-10-05", status: "Doing" }), note("b.md", { begin: "2026-10-06" }), note("c.md", { begin: "2026-10-07", status: "Blocked" }), note("d.md", { begin: "2026-10-08", status: "Todo" })], keys).dated;

  it("has one lane per option in order, a lane for notes with none first, and odd values last", () => {
    const lanes = lanesOf(items, STATUS);
    expect(lanes.map((l) => l.label)).toEqual(["No status", "Todo", "Doing", "Done", "Blocked"]);
    expect(lanes.map((l) => l.items.map((i) => i.id))).toEqual([["b.md"], ["d.md"], ["a.md"], [], ["c.md"]]);
  });

  it("is one lane without a label when nothing groups it", () => {
    expect(lanesOf(items, null)).toEqual([{ key: "", label: "", items }]);
  });
});

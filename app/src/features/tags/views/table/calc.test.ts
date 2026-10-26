import { describe, expect, it } from "vitest";

import type { NoteMeta, TagView } from "../../../../lib/vault/types";
import { calcOf, calcsFor, calculate, calcText, defaultCalc, kindOf, showsCalcs, withCalc, withCalcRow, type CalcFn } from "./calc";

function note(id: string, props: Record<string, unknown>, extra: Partial<NoteMeta> = {}): NoteMeta {
  return { path: `library/${id}.md`, id, title: id, kind: "page", icon: null, cover: null, parent: null, project: null, tags: ["task"], modified: 0, created: null, updated: null, excerpt: "", words: 0, props, locked: false, ...extra };
}

const rows = [
  note("a", { points: 3, due: "2026-10-02", urgent: true, status: "Todo", labels: ["ui", "core"] }),
  note("b", { points: "5", due: "2026-10-12", urgent: false, status: "todo", labels: ["ui"] }),
  note("c", { points: "many", status: "Done" }),
  note("d", { points: 10, due: "2026-09-30", urgent: "true", status: "" }),
];

const run = (fn: CalcFn, key: string, kind: string, notes = rows) => calculate(fn, notes, key, kind);

describe("calculate", () => {
  const cases: [CalcFn, string, string, number | string | null, string][] = [
    ["count", "points", "number", 4, "4"],
    ["count_empty", "due", "date", 1, "1"],
    ["count_not_empty", "due", "date", 3, "3"],
    // An unticked box is empty, as the filters see it; "true" text counts as ticked.
    ["count_empty", "urgent", "checkbox", 2, "2"],
    ["count_not_empty", "urgent", "checkbox", 2, "2"],
    ["unique", "status", "select", 2, "2"],
    ["unique", "labels", "multi_select", 2, "2"],
    ["percent_checked", "urgent", "checkbox", 50, "50%"],
    // Text in a number column is skipped.
    ["sum", "points", "number", 18, "18"],
    ["average", "points", "number", 6, "6"],
    ["median", "points", "number", 5, "5"],
    ["min", "points", "number", 3, "3"],
    ["max", "points", "number", 10, "10"],
    ["range", "points", "number", 7, "7"],
    ["earliest", "due", "date", "2026-09-30", "2026-09-30"],
    ["latest", "due", "date", "2026-10-12", "2026-10-12"],
    ["range", "due", "date", 12, "12 days"],
  ];
  it.each(cases)("%s of %s", (fn, key, kind, value, text) => {
    const result = run(fn, key, kind);
    expect(result.value).toBe(value);
    expect(result.text).toBe(text);
  });

  it("takes the median of an even count as the middle two's mean", () => {
    expect(run("median", "points", "number", [note("x", { points: 1 }), note("y", { points: 4 })]).value).toBe(2.5);
  });

  it("is empty, not zero, when no value suits", () => {
    const none = [note("x", {}), note("y", { points: "many" })];
    for (const fn of ["sum", "average", "median", "min", "max", "range"] as const) expect(run(fn, "points", "number", none)).toEqual({ text: "", value: null });
    expect(run("earliest", "due", "date", none).value).toBeNull();
    expect(run("percent_checked", "urgent", "checkbox", []).value).toBeNull();
    expect(run("count", "points", "number", []).value).toBe(0);
  });

  it("works over a formula's values, numbers or dates", () => {
    const calculated = [note("x", { left: 4 }), note("y", { left: 6 }), note("z", { left: null })];
    expect(run("sum", "left", "formula", calculated).value).toBe(10);
    expect(run("count_empty", "left", "formula", calculated).value).toBe(1);
    const dated = [note("x", { when: "2026-01-02" }), note("y", { when: "2026-03-01" })];
    expect(run("latest", "when", "formula", dated).value).toBe("2026-03-01");
  });

  it("reads built-in fields: the edit time as a number, created as a day", () => {
    const made = [note("x", {}, { modified: 4, created: "2026-02-01" }), note("y", {}, { modified: 6, created: "2026-02-11" })];
    expect(run("sum", "modified", "number", made).value).toBe(10);
    expect(run("range", "created", "date", made).value).toBe(10);
  });

  it("rounds long decimals", () => {
    // In the person's own number format.
    const average = run("average", "points", "number", [note("x", { points: 1 }), note("y", { points: 1 }), note("z", { points: 2 })]);
    expect(average.text).toBe((1.33).toLocaleString(undefined, { maximumFractionDigits: 2 }));
  });
});

describe("calcsFor", () => {
  it("offers each type its own set", () => {
    expect(calcsFor("text")).toEqual(["count", "count_empty", "count_not_empty", "unique"]);
    expect(calcsFor("checkbox")).toContain("percent_checked");
    expect(calcsFor("number")).toEqual(expect.arrayContaining(["sum", "median", "range"]));
    expect(calcsFor("number")).not.toContain("earliest");
    expect(calcsFor("date")).toEqual(expect.arrayContaining(["earliest", "latest", "range"]));
    expect(calcsFor("date")).not.toContain("sum");
    expect(calcsFor("formula")).toEqual(expect.arrayContaining(["sum", "latest"]));
    expect(calcsFor("select")).not.toContain("sum");
  });

  it("knows a column's type from a built-in field too", () => {
    expect(kindOf({ kind: "title", type: "title" })).toBe("text");
    expect(kindOf({ kind: "builtin", type: "created" })).toBe("date");
    expect(kindOf({ kind: "builtin", type: "modified" })).toBe("number");
    expect(kindOf({ kind: "prop", type: "relation" })).toBe("relation");
  });
});

describe("the saved calculations", () => {
  const view: TagView = { name: "V", type: "table", calcs: { points: "sum", status: "sum" }, extra: 1 };
  const points = { key: "points", kind: "prop" as const, type: "number" };
  const status = { key: "status", kind: "prop" as const, type: "select" };

  it("are read per column, ignoring one the column cannot do", () => {
    expect(calcOf(view, points)).toBe("sum");
    expect(calcOf(view, status)).toBeNull();
    expect(calcOf({ name: "V", type: "table" }, points)).toBeNull();
    expect(calcOf({ name: "V", type: "table", calcs: ["sum"] as unknown as Record<string, string> }, points)).toBeNull();
  });

  it("are set and cleared, keeping the rest of the view", () => {
    const set = withCalc(view, "due", "latest");
    expect(set.calcs).toEqual({ points: "sum", status: "sum", due: "latest" });
    expect(set.extra).toBe(1);
    expect(view.calcs).toEqual({ points: "sum", status: "sum" });
    // Clearing the last one leaves the row shown, empty.
    expect(withCalc({ name: "V", type: "table", calcs: { points: "sum" } }, "points", null).calcs).toEqual({});
  });

  it("show the calculations row once the view has a calcs setting", () => {
    const plain: TagView = { name: "V", type: "table", keep: 1 };
    expect(showsCalcs(plain)).toBe(false);
    expect(showsCalcs({ ...plain, calcs: [] as unknown as Record<string, string> })).toBe(false);
    expect(showsCalcs(withCalcRow(plain, true))).toBe(true);
    expect(withCalcRow(plain, true).keep).toBe(1);
    expect(showsCalcs(withCalcRow(view, false))).toBe(false);
    expect(withCalcRow(view, true).calcs).toEqual(view.calcs);
    expect(["number", "formula", "checkbox", "text", "date"].map(defaultCalc)).toEqual(["sum", "sum", "percent_checked", "count", "count"]);
  });

  it("say the name with the value", () => {
    expect(calcText("sum", { text: "18", value: 18 })).toBe("Sum 18");
    expect(calcText("sum", { text: "", value: null })).toBe("Sum");
  });
});

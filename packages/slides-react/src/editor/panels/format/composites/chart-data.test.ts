import { describe, expect, it } from "vitest";

import { type ChartTable, MOST_CATEGORIES, MOST_SERIES, addCategory, addSeries, fit, numberOf, removeCategory, removeSeries, setCategory, setSeriesName, setValue, splitRows, tableFromText } from "./chart-data.ts";

const table = (): ChartTable => ({ categories: ["Q1", "Q2", "Q3"], series: [{ name: "2025", values: [1, 2, 3], color: "accent2" }, { name: "2026", values: [4, 5, 6] }] });

describe("changing the table of a chart", () => {
  it("adds a row with a zero for each series, and takes one away from every series", () => {
    const more = addCategory(table());
    expect(more.categories).toEqual(["Q1", "Q2", "Q3", "Category 4"]);
    expect(more.series.map((s) => s.values)).toEqual([[1, 2, 3, 0], [4, 5, 6, 0]]);
    const fewer = removeCategory(table(), 1);
    expect(fewer.categories).toEqual(["Q1", "Q3"]);
    expect(fewer.series.map((s) => s.values)).toEqual([[1, 3], [4, 6]]);
  });

  it("adds a column of zeros, and takes one away", () => {
    const more = addSeries(table());
    expect(more.series).toHaveLength(3);
    expect(more.series[2]).toEqual({ name: "Series 3", values: [0, 0, 0] });
    expect(removeSeries(table(), 0).series.map((s) => s.name)).toEqual(["2026"]);
  });

  it("renames, and sets a number, without touching the rest or the table it was given", () => {
    const start = table();
    const next = setValue(setSeriesName(setCategory(start, 0, "Jan"), 1, "Plan"), 1, 2, 9);
    expect(next.categories).toEqual(["Jan", "Q2", "Q3"]);
    expect(next.series.map((s) => s.name)).toEqual(["2025", "Plan"]);
    expect(next.series[1]?.values).toEqual([4, 5, 9]);
    // The colour of a series stays with it.
    expect(next.series[0]?.color).toBe("accent2");
    expect(start).toEqual(table());
  });

  it("gives every series a number for each category", () => {
    const ragged: ChartTable = { categories: ["a", "b", "c"], series: [{ name: "x", values: [1] }, { name: "y", values: [1, 2, 3, 4] }] };
    expect(fit(ragged).series.map((s) => s.values)).toEqual([[1, 0, 0], [1, 2, 3]]);
  });
});

describe("reading a table from pasted text", () => {
  it("reads spreadsheet cells (tab-separated) with a header row of series names", () => {
    const got = tableFromText("Quarter\t2025\t2026\nQ1\t12\t15\nQ2\t19\t17\r\n");
    expect(got).toEqual({ categories: ["Q1", "Q2"], series: [{ name: "2025", values: [12, 19] }, { name: "2026", values: [15, 17] }] });
  });

  it("reads a CSV, with quotes around a name that has a comma in it", () => {
    const got = tableFromText('Region,Sales\n"North, west",10\nSouth,"1,5"\n');
    expect(got?.categories).toEqual(["North, west", "South"]);
    // A comma-separated file has no thousands: "1,5" is two cells' worth of text, here quoted whole, and is not a number.
    expect(got?.series[0]?.name).toBe("Sales");
    expect(got?.series[0]?.values[0]).toBe(10);
  });

  it("reads semicolons with decimal commas", () => {
    expect(tableFromText("Item;Cost\nTea;1,5\nCake;3,25")?.series[0]?.values).toEqual([1.5, 3.25]);
  });

  it("takes the first row as data when it holds numbers, and names the series itself", () => {
    const got = tableFromText("A\t1\t2\nB\t3\t4");
    expect(got?.categories).toEqual(["A", "B"]);
    expect(got?.series.map((s) => s.name)).toEqual(["Series 1", "Series 2"]);
    expect(got?.series.map((s) => s.values)).toEqual([[1, 3], [2, 4]]);
  });

  it("reads thousands, percent and currency signs, and turns what is not a number into zero", () => {
    const got = tableFromText("Name\tValue\nA\t1,234\nB\t12%\nC\t$5\nD\tn/a");
    expect(got?.series[0]?.values).toEqual([1234, 12, 5, 0]);
  });

  it("makes a single column of numbers one series numbered 1, 2, 3", () => {
    expect(tableFromText("5\n6\n7")).toEqual({ categories: ["1", "2", "3"], series: [{ name: "Series 1", values: [5, 6, 7] }] });
    expect(tableFromText("a\nb")).toBeNull();
  });

  it("keeps the colour of the series in the same place, and gives an empty name a number", () => {
    const got = tableFromText("\tA\n\t1\nQ\t2", table());
    expect(got?.categories).toEqual(["1", "Q"]);
    expect(got?.series[0]).toEqual({ name: "A", values: [1, 2], color: "accent2" });
  });

  it("makes nothing of empty text, and cuts a table that is too big", () => {
    expect(tableFromText("")).toBeNull();
    expect(tableFromText("  \n\n")).toBeNull();
    const rows = Array.from({ length: MOST_CATEGORIES + 10 }, (_, i) => `c${i}\t${i}`).join("\n");
    expect(tableFromText(rows)?.categories).toHaveLength(MOST_CATEGORIES);
    const wide = `h\t${Array.from({ length: 20 }, (_, i) => `s${i}`).join("\t")}\nx\t${Array.from({ length: 20 }, () => "1").join("\t")}`;
    expect(tableFromText(wide)?.series).toHaveLength(MOST_SERIES);
  });

  it("splits rows and says which separator it found", () => {
    expect(splitRows("a\tb\nc\td")).toEqual({ rows: [["a", "b"], ["c", "d"]], delimiter: "\t" });
    expect(splitRows("a,b").delimiter).toBe(",");
    expect(splitRows('"say ""hi""",2').rows).toEqual([['say "hi"', "2"]]);
  });

  it("reads numbers as people write them", () => {
    expect(numberOf(" 1 000 ")).toBe(1000);
    expect(numberOf("abc")).toBeNull();
    expect(numberOf("")).toBeNull();
    expect(numberOf("2,5", ";")).toBe(2.5);
  });
});

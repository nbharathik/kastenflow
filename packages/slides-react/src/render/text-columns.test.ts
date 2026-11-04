import { describe, expect, it } from "vitest";

import { columnClass, columnsOf, gapOf, gapStyle } from "./text-columns.ts";

describe("the columns of a text box", () => {
  it("are two or three, and anything else is one column", () => {
    expect(columnsOf(2)).toBe(2);
    expect(columnsOf(3)).toBe(3);
    for (const odd of [undefined, null, 0, 1, 4, "2", Number.NaN]) expect(columnsOf(odd)).toBe(1);
  });

  it("give a class only when there is more than one", () => {
    expect(columnClass(1)).toBeUndefined();
    expect(columnClass(2)).toBe("ks-cols-2");
    expect(columnClass(3)).toBe("ks-cols-3");
  });

  it("have a gap only when the deck names a sensible one", () => {
    expect(gapOf(24)).toBe(24);
    expect(gapOf(0)).toBe(0);
    for (const odd of [undefined, -1, 481, Number.NaN, Number.POSITIVE_INFINITY, "24"]) expect(gapOf(odd)).toBeUndefined();
    expect(gapStyle(undefined)).toBeUndefined();
    expect(gapStyle(24)).toEqual({ "--ks-col-gap": "24px" });
  });
});

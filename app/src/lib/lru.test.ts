import { describe, expect, it, vi } from "vitest";

import { setCapped, touch } from "./lru";

describe("setCapped", () => {
  it("drops the oldest past the cap and says which", () => {
    const map = new Map<string, number>();
    const gone = vi.fn();
    for (const [i, key] of ["a", "b", "c"].entries()) setCapped(map, key, i, 2, gone);
    expect([...map.keys()]).toEqual(["b", "c"]);
    expect(gone).toHaveBeenCalledExactlyOnceWith(0, "a");
  });

  it("keeps what was touched", () => {
    const map = new Map([["a", 1], ["b", 2]]);
    expect(touch(map, "a")).toBe(1);
    setCapped(map, "c", 3, 2);
    expect([...map.keys()]).toEqual(["a", "c"]);
    expect(touch(map, "zzz")).toBeUndefined();
  });

  it("replaces a key without counting it twice", () => {
    const map = new Map([["a", 1], ["b", 2]]);
    setCapped(map, "a", 9, 2);
    expect([...map.entries()]).toEqual([["b", 2], ["a", 9]]);
  });
});

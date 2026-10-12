import { describe, expect, it } from "vitest";

import { ago, agoLong } from "./when";

const NOW = new Date(2026, 9, 7, 14, 0, 0).getTime();
const minutes = (n: number) => NOW - n * 60_000;

describe("how long ago, in as few characters as a row can spare", () => {
  it("says now for the first moments, then minutes and hours", () => {
    expect(ago(NOW, NOW)).toBe("now");
    expect(ago(NOW - 44_000, NOW)).toBe("now");
    expect(ago(NOW - 45_000, NOW)).toBe("1m");
    expect(ago(minutes(12), NOW)).toBe("12m");
    expect(ago(minutes(59), NOW)).toBe("59m");
    expect(ago(minutes(60), NOW)).toBe("1h");
    expect(ago(minutes(60 * 23 + 59), NOW)).toBe("23h");
  });

  it("says Yesterday, then days, then the day itself", () => {
    expect(ago(minutes(60 * 24), NOW)).toBe("Yesterday");
    expect(ago(minutes(60 * 24 * 3), NOW)).toBe("3d");
    expect(ago(minutes(60 * 24 * 6), NOW)).toBe("6d");
    expect(ago(minutes(60 * 24 * 30), NOW)).toMatch(/\d/);
    expect(ago(minutes(60 * 24 * 30), NOW).length).toBeGreaterThan(3);
  });

  it("never reads a time from the future as negative", () => {
    expect(ago(NOW + 5 * 60_000, NOW)).toBe("now");
  });

  it("keeps the long form for a tooltip", () => {
    expect(agoLong(Date.now() - 5 * 60_000)).toBe("5 minutes ago");
  });
});

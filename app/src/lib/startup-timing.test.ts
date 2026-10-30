import { afterEach, describe, expect, it } from "vitest";

import { startupDetail, startupLine, startupMarks } from "./startup-timing";

afterEach(() => performance.clearMarks());

describe("start-up timing", () => {
  it("writes one rounded line from the listed mark", () => {
    expect(startupLine([{ name: "connected", at: 410.4 }, { name: "listed", at: 639.6 }])).toBe("Startup: 640 ms");
  });

  it("falls back to connected, and says nothing before either", () => {
    expect(startupLine([{ name: "connected", at: 410 }])).toBe("Startup: 410 ms");
    expect(startupLine([{ name: "warm", at: 900 }])).toBeNull();
    expect(startupLine([])).toBeNull();
  });

  it("lists every mark for the tooltip", () => {
    expect(startupDetail([{ name: "connected", at: 410 }, { name: "warm", at: 1200.2 }])).toBe("connected 410 ms · warm 1200 ms");
  });

  it("reads only the kasten marks, in order", () => {
    performance.mark("other");
    performance.mark("kasten:listed");
    const names = startupMarks().map((m) => m.name);
    expect(names).toEqual(["listed"]);
  });
});

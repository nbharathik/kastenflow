import { type Mock, describe, expect, it, vi } from "vitest";

import type { PresentScreens } from "../host.ts";
import { presentOnRows } from "./present-on.ts";

const screens = (chosen = "auto"): PresentScreens & { choose: Mock<(value: string) => void> } => ({ displays: async () => [], chosen: () => chosen, choose: vi.fn<(value: string) => void>() });

describe("Present on", () => {
  it("is not offered where the host has no choice, or only one display", () => {
    expect(presentOnRows(undefined, ["A", "B"])).toEqual([]);
    expect(presentOnRows(screens(), [])).toEqual([]);
    expect(presentOnRows(screens(), ["Built-in"])).toEqual([]);
  });

  it("offers automatic, this screen and each display by name, with the kept choice ticked", () => {
    const rows = presentOnRows(screens("name:DELL U2720Q"), ["Built-in", "DELL U2720Q"]);
    expect(rows.map((row) => [row.label, row.checked])).toEqual([
      ["Automatic", false],
      ["This screen", false],
      ["Built-in", false],
      ["DELL U2720Q", true],
    ]);
  });

  it("names the main screen and the others by place when the host says which is which, and offers to identify them", () => {
    const host = { ...screens("name:Projector"), identify: vi.fn() };
    const info = [
      { label: "Built-in", primary: true, current: false },
      { label: "Projector", primary: false, current: true },
    ];
    const rows = presentOnRows(host, ["Built-in", "Projector"], info);
    expect(rows.map((row) => [row.label, row.checked])).toEqual([
      ["Automatic", false],
      ["This screen", false],
      ["Main screen (Built-in)", false],
      ["Screen 2 (Projector)", true],
      ["Identify screens", undefined],
    ]);
    rows[2]?.run?.();
    expect(host.choose).toHaveBeenCalledWith("name:Built-in");
    rows[4]?.run?.();
    expect(host.identify).toHaveBeenCalledTimes(1);
  });

  it("hands the choice to the host in the words it keeps", () => {
    const host = screens();
    const rows = presentOnRows(host, ["Built-in", "Projector"]);
    for (const row of rows) row.run?.();
    expect(host.choose.mock.calls).toEqual([["auto"], ["here"], ["name:Built-in"], ["name:Projector"]]);
  });
});

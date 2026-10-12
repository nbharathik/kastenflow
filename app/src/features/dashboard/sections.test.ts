import { describe, expect, it } from "vitest";

import { homeProp, projectHome, PROJECT_DEFAULT, PROJECT_SECTIONS } from "../projects/home";
import { alone, chosen, moved, shifted, toggled, type SectionDef } from "./sections";

const DEFS: SectionDef<"a" | "b" | "c" | "d">[] = [
  { id: "a", label: "A", icon: "home", hint: "" },
  { id: "b", label: "B", icon: "home", hint: "" },
  { id: "c", label: "C", icon: "home", hint: "" },
  { id: "d", label: "D", icon: "home", hint: "" },
];

describe("dashboard sections", () => {
  it("keeps known ids once, in the saved order, or falls back", () => {
    expect(chosen(["c", "A", "zzz", "c", 3], DEFS, ["a"])).toEqual(["c", "a"]);
    expect(chosen([], DEFS, ["a"])).toEqual([]);
    expect(chosen(undefined, DEFS, ["a", "b"])).toEqual(["a", "b"]);
    expect(chosen("a", DEFS, ["b"])).toEqual(["b"]);
  });

  it("moves a section within the list", () => {
    expect(shifted(["a", "b", "c"], "c", -1)).toEqual(["a", "c", "b"]);
    expect(shifted(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(shifted(["a", "b", "c"], "a", 5)).toEqual(["b", "c", "a"]);
    expect(shifted(["a", "b"], "d", 1)).toEqual(["a", "b"]);
  });

  it("puts a dragged section where the one it was dropped on is", () => {
    expect(moved(["a", "b", "c", "d"], "d", "b")).toEqual(["a", "d", "b", "c"]);
    expect(moved(["a", "b", "c", "d"], "a", "c")).toEqual(["b", "c", "a", "d"]);
    expect(moved(["a", "b", "c"], "b", "b")).toEqual(["a", "b", "c"]);
    expect(moved(["a", "b", "c"], "b", "zzz" as "a")).toEqual(["a", "b", "c"]);
    const list = ["a", "b"] as const;
    expect(moved(list, "a", "b")).toEqual(["b", "a"]);
    expect(list).toEqual(["a", "b"]);
  });

  it("finds a half-width section left alone on its row", () => {
    const cell = (wide: boolean, shown = true) => ({ wide, shown });
    // Two to a row: nobody is alone.
    expect(alone([cell(false), cell(false)])).toEqual([false, false]);
    // One before a wide section, or last with no partner.
    expect(alone([cell(true), cell(false), cell(true)])).toEqual([false, true, false]);
    expect(alone([cell(false), cell(false), cell(false)])).toEqual([false, false, true]);
    // A section with nothing to show takes no place in the rows.
    expect(alone([cell(false), cell(false, false), cell(false)])).toEqual([false, false, false]);
    expect(alone([cell(false), cell(false, false), cell(true)])).toEqual([true, false, false]);
    // Rows start again after a wide section.
    expect(alone([cell(false), cell(false), cell(false), cell(true), cell(false), cell(false)])).toEqual([false, false, true, false, false, false]);
  });

  it("turns a section off, or on near its usual place", () => {
    expect(toggled(["a", "b", "d"], "b", DEFS)).toEqual(["a", "d"]);
    expect(toggled(["a", "d"], "c", DEFS)).toEqual(["a", "c", "d"]);
    expect(toggled(["d", "a"], "b", DEFS)).toEqual(["d", "a", "b"]);
    expect(toggled([], "c", DEFS)).toEqual(["c"]);
  });
});

describe("a project's home", () => {
  it("reads the home property of the project page", () => {
    expect(projectHome({})).toEqual({ shown: true, sections: [...PROJECT_DEFAULT] });
    expect(projectHome({ home: false })).toEqual({ shown: false, sections: [...PROJECT_DEFAULT] });
    expect(projectHome({ home: "off" }).shown).toBe(false);
    expect(projectHome({ home: ["kanban", "todo", "nope"] })).toEqual({ shown: true, sections: ["kanban", "todo"] });
  });

  it("writes only what differs from the usual home", () => {
    expect(homeProp({ shown: true, sections: [...PROJECT_DEFAULT] })).toBeNull();
    expect(homeProp({ shown: false, sections: ["todo"] })).toBe(false);
    expect(homeProp({ shown: true, sections: ["todo", "kanban"] })).toEqual(["todo", "kanban"]);
  });

  it("has a label and an icon for every section", () => {
    for (const id of PROJECT_DEFAULT) expect(PROJECT_SECTIONS.some((d) => d.id === id)).toBe(true);
    expect(new Set(PROJECT_SECTIONS.map((d) => d.id)).size).toBe(PROJECT_SECTIONS.length);
  });
});

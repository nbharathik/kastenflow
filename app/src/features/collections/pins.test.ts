import { beforeEach, describe, expect, it } from "vitest";

import { forget, MAX_PINNED, moved, pin, pinnedIn, reloadPins, unpin, usePins } from "./pins";

const EMPTY: { home: string[]; projects: Record<string, string[]> } = { home: [], projects: {} };

describe("pinning collections", () => {
  it("pins to Home or a project in order, once each", () => {
    let pins = pin(EMPTY, { kind: "home" }, "views/a.yaml");
    pins = pin(pins, { kind: "home" }, "views/b.yaml");
    pins = pin(pins, { kind: "home" }, "views/a.yaml");
    pins = pin(pins, { kind: "project", folder: "trip" }, "views/a.yaml");
    expect(pinnedIn(pins, { kind: "home" })).toEqual(["views/a.yaml", "views/b.yaml"]);
    expect(pinnedIn(pins, { kind: "project", folder: "trip" })).toEqual(["views/a.yaml"]);
    expect(pinnedIn(pins, { kind: "project", folder: "other" })).toEqual([]);
  });

  it("holds only so many in one place", () => {
    let pins = EMPTY;
    for (let n = 0; n < MAX_PINNED + 2; n++) pins = pin(pins, { kind: "home" }, `views/c${n}.yaml`);
    expect(pinnedIn(pins, { kind: "home" })).toHaveLength(MAX_PINNED);
  });

  it("unpins, and drops a project that has none left", () => {
    const pins = pin(pin(EMPTY, { kind: "project", folder: "trip" }, "views/a.yaml"), { kind: "home" }, "views/a.yaml");
    const without = unpin(unpin(pins, { kind: "project", folder: "trip" }, "views/a.yaml"), { kind: "home" }, "views/a.yaml");
    expect(without).toEqual({ home: [], projects: {} });
    expect(unpin(pins, { kind: "home" }, "views/zzz.yaml")).toEqual(pins);
  });

  it("follows a rename and forgets a collection that is gone, everywhere", () => {
    let pins = pin(pin(EMPTY, { kind: "home" }, "views/a.yaml"), { kind: "project", folder: "trip" }, "views/a.yaml");
    pins = moved(pins, "views/a.yaml", "views/b.yaml");
    expect(pinnedIn(pins, { kind: "home" })).toEqual(["views/b.yaml"]);
    expect(pinnedIn(pins, { kind: "project", folder: "trip" })).toEqual(["views/b.yaml"]);
    expect(forget(pins, "views/b.yaml")).toEqual({ home: [], projects: {} });
  });
});

describe("the pins in the window's storage", () => {
  beforeEach(() => {
    localStorage.clear();
    reloadPins();
  });

  it("are kept and read back", () => {
    usePins.getState().pin({ kind: "home" }, "views/a.yaml");
    usePins.getState().pin({ kind: "project", folder: "trip" }, "views/b.yaml");
    reloadPins();
    expect(usePins.getState().pins).toEqual({ home: ["views/a.yaml"], projects: { trip: ["views/b.yaml"] } });
    usePins.getState().moved("views/a.yaml", "views/c.yaml");
    expect(JSON.parse(localStorage.getItem("kasten.collection-pins")!)).toEqual({ home: ["views/c.yaml"], projects: { trip: ["views/b.yaml"] } });
  });

  it("start empty when what is stored is not pins", () => {
    for (const bad of ["not json", "null", '{"home": 5, "projects": []}', '{"home": [1], "projects": {"a": "x"}}']) {
      localStorage.setItem("kasten.collection-pins", bad);
      reloadPins();
      expect(usePins.getState().pins).toEqual(EMPTY);
    }
  });
});

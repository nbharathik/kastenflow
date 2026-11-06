// The small parts of the Slides home: arrow-key moves, what is remembered in the window, and the project filter.

import { afterEach, describe, expect, it, vi } from "vitest";

import type { DeckInfo } from "../../lib/vault/types";
import { columnsOf, moveOf, nextIndex } from "./grid-keys";
import { HOME_SORTS, inProject, projectKeys, readHomeSort, readView, writeView } from "./home-prefs";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

const deck = (path: string, project: string | null): DeckInfo => ({ path, title: path, project, slides: 1, modified: 1, size: 1, problem: null });

describe("moving between cards", () => {
  it("names the keys that move", () => {
    expect(moveOf("ArrowDown")).toBe("down");
    expect(moveOf("Home")).toBe("first");
    expect(moveOf("a")).toBeNull();
  });

  it("goes by one across a row and by a whole row up and down", () => {
    expect(nextIndex("right", 0, 7, 3)).toBe(1);
    expect(nextIndex("left", 2, 7, 3)).toBe(1);
    expect(nextIndex("down", 1, 7, 3)).toBe(4);
    expect(nextIndex("up", 4, 7, 3)).toBe(1);
  });

  it("stays at an edge, and reaches the ends", () => {
    expect(nextIndex("left", 0, 7, 3)).toBe(0);
    expect(nextIndex("up", 1, 7, 3)).toBe(1);
    expect(nextIndex("right", 6, 7, 3)).toBe(6);
    // The last row is short: down from the second column of the row above has no card under it.
    expect(nextIndex("down", 4, 7, 3)).toBe(4);
    expect(nextIndex("first", 5, 7, 3)).toBe(0);
    expect(nextIndex("last", 0, 7, 3)).toBe(6);
    expect(nextIndex("down", 0, 0, 3)).toBe(-1);
  });

  it("counts a row as the cards that share the first one's top edge", () => {
    const at = (top: number) => ({ getBoundingClientRect: () => ({ top }) }) as unknown as Element;
    expect(columnsOf([at(10), at(10), at(10), at(200), at(200)])).toBe(3);
    expect(columnsOf([at(10), at(60), at(110)])).toBe(1);
    expect(columnsOf([])).toBe(1);
  });
});

describe("what the home remembers", () => {
  it("is a grid until a list was chosen, and keeps the choice", () => {
    expect(readView()).toBe("grid");
    writeView("list");
    expect(readView()).toBe("list");
    writeView("grid");
    expect(readView()).toBe("grid");
  });

  it("goes on without storage: the grid, and nothing thrown", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readView()).toBe("grid");
    expect(() => writeView("list")).not.toThrow();
    expect(readHomeSort()).toBe("recent");
  });

  it("reads an order that grouped by project as the newest first", () => {
    localStorage.setItem("kasten.slides.sort", "project");
    expect(readHomeSort()).toBe("recent");
    localStorage.setItem("kasten.slides.sort", "name");
    expect(readHomeSort()).toBe("name");
    expect(HOME_SORTS.map((sort) => sort.value)).toEqual(["recent", "name"]);
  });
});

describe("the project filter", () => {
  const list = [deck("a", "trip"), deck("b", null), deck("c", "trip"), deck("d", "work")];

  it("lists the projects that hold a deck, once each", () => {
    expect(projectKeys(list)).toEqual(["trip", "work"]);
    expect(projectKeys([deck("b", null)])).toEqual([]);
  });

  it("keeps the decks of one project, the loose ones, or all", () => {
    expect(inProject(list, "trip").map((d) => d.path)).toEqual(["a", "c"]);
    expect(inProject(list, "").map((d) => d.path)).toEqual(["b"]);
    expect(inProject(list, null)).toHaveLength(4);
  });
});

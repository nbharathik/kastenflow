// The audit of the editor against the agent tools, as a test (see `agent-parity.ts`): every entry of the slash
// menu, the page menu, the page's palette commands, the block menu and the whiteboard's bar must be in the table
// as "tool exists", "UI only" or "gap". A new one that is not fails here, so it is decided when it is added.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { PALETTE_IDS } from "../../../shell/page-menu";
import { PAGE_COMMANDS } from "../../workspace/overlays/page-commands";
import * as parity from "./agent-parity";
import { BLOCK_CHOICES, colorChoices, slashChoices } from "./menus/catalog";

const here = import.meta.dirname;
const source = (...path: string[]) => readFileSync(join(here, ...path), "utf8");
const sorted = (items: Iterable<string>) => [...items].sort();

/** The text between double quotes after each match of `pattern` (its first group) in a source file. */
const found = (text: string, pattern: RegExp) => new Set([...text.matchAll(pattern)].map((match) => match[1]!));

describe("the slash menu", () => {
  const keys = (choices: readonly { key: string }[]) => choices.map((choice) => (/^(color|background)-/.test(choice.key) ? "colour" : choice.key));

  it("has every entry in the table, and the table has nothing the menu dropped", () => {
    const own = new Set(keys([...BLOCK_CHOICES, ...colorChoices()]));
    expect(sorted(own)).toEqual(sorted(Object.keys(parity.SLASH)));
  });

  it("knows the choices plugins add, wherever they are on", () => {
    const plugins = keys(slashChoices()).filter((key) => !(key in parity.SLASH));
    for (const key of plugins) expect(parity.SLASH_PLUGINS, `the plugin choice “${key}”`).toHaveProperty(key);
  });
});

describe("the page menu and the page's palette commands", () => {
  it("have every row in the table", () => {
    expect(sorted(Object.keys(PALETTE_IDS))).toEqual(sorted(Object.keys(parity.PAGE_MENU)));
  });

  it("have every command in the table", () => {
    expect(sorted(PAGE_COMMANDS.map((command) => command.id))).toEqual(sorted(Object.keys(parity.PAGE_COMMANDS)));
  });
});

describe("the block menu and the bar over a selected text", () => {
  it("have every row in the table", () => {
    const labels = new Set([...found(source("menus", "block-menu.ts"), /label: "([^"]+)"/g), ...found(source("menus", "toolbar.ts"), /label: "([^"]+)"/g)]);
    expect(sorted(labels)).toEqual(sorted(Object.keys(parity.BLOCK_MENU)));
  });
});

describe("the whiteboard", () => {
  it("has every action of the selection bar, every tool and every command in the table", () => {
    const bar = source("..", "..", "boards", "canvas", "toolbar", "selection-actions.ts");
    const actions = [...(/export type BarAction = ([^;]+);/.exec(bar)?.[1] ?? "").matchAll(/"([a-z]+)"/g)].map((match) => match[1]!);
    const tools = source("..", "..", "boards", "canvas", "state", "tools.ts");
    const kinds = [...(/export type Tool = ([^;]+);/.exec(tools)?.[1] ?? "").matchAll(/"([a-z]+)"/g)].map((match) => match[1]!);
    expect(actions.length).toBeGreaterThan(5);
    expect(kinds.length).toBeGreaterThan(3);
    // `shape:${ShapeKind}` is the one tool of every shape.
    expect(sorted(new Set([...actions, ...kinds, "shape"]))).toEqual(sorted(Object.keys(parity.BOARD)));
    const commands = found(source("..", "..", "boards", "commands.ts"), /id: "([a-z-]+)"/g);
    expect(sorted(commands)).toEqual(sorted(Object.keys(parity.BOARD_COMMANDS)));
  });
});

describe("the table", () => {
  const all = Object.entries({ ...parity.SLASH, ...parity.SLASH_PLUGINS, ...parity.PAGE_MENU, ...parity.PAGE_MENU_PLUGINS, ...parity.PAGE_COMMANDS, ...parity.BLOCK_MENU, ...parity.HEADER, ...parity.BOARD, ...parity.BOARD_COMMANDS });

  it("says one of the three things about everything, in the words it asks for", () => {
    expect(all.length).toBeGreaterThan(100);
    for (const [name, value] of all) expect(value, name).toMatch(parity.SHAPE);
  });

  it("names the tools of a 'tool exists' entry", () => {
    for (const [name, value] of all) if (value.startsWith("tool exists")) expect(parity.toolsOf(value).length, name).toBeGreaterThan(0);
  });
});

// The editor and the agent tools share one list of operations. This reads the editor's source for the
// operations it applies, and its command list, and checks both against slides-core's own list, so a change
// to either side has to be said on purpose (`agent-parity.ts`).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { COMMANDS } from "./index.ts";
import { DECK_PREFIXES, NOT_APPLIED_BY_THE_EDITOR, UI_ONLY } from "./agent-parity.ts";

const packageSrc = join(import.meta.dirname, "../..");

/** The names slides-core registers, as the generated file the wasm package ships lists them. */
function registered(): string[] {
  const text = readFileSync(join(packageSrc, "../../slides-wasm/ts/generated/ops.ts"), "utf8");
  const list = /export const OP_NAMES = \[([\s\S]*?)\] as const;/.exec(text)?.[1] ?? "";
  return [...list.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]!);
}

/** Every source file of the package that is not a test, with its text. */
function sources(dir = packageSrc): { file: string; text: string }[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts") ? [{ file: path, text: readFileSync(path, "utf8") }] : [];
  });
}

/** The operation names the package applies: `apply("x"`, `applyIntoLast("x"`, and a batch's `["x", {...}]`. */
function applied(): Map<string, string> {
  const found = new Map<string, string>();
  const patterns = [/\b(?:apply|applyIntoLast)\(\s*"([a-z]+(?:_[a-z]+)+)"/g, /\[\s*"([a-z]+(?:_[a-z]+)+)"\s*,\s*(?:\{|[A-Z])/g];
  for (const { file, text } of sources()) {
    for (const pattern of patterns) for (const match of text.matchAll(pattern)) found.set(match[1]!, file);
  }
  return found;
}

describe("the operations the editor applies", () => {
  const names = registered();
  const used = applied();

  it("are all operations of slides-core", () => {
    expect(names.length).toBeGreaterThan(50);
    const unknown = [...used.keys()].filter((name) => !names.includes(name));
    expect(unknown, "the editor applies an operation slides-core does not have").toEqual([]);
  });

  it("are every operation but the few the editor leaves to others, each with its reason", () => {
    const never = names.filter((name) => !used.has(name)).sort();
    expect(never).toEqual(Object.keys(NOT_APPLIED_BY_THE_EDITOR).sort());
    for (const [name, why] of Object.entries(NOT_APPLIED_BY_THE_EDITOR)) {
      expect(why.length, name).toBeGreaterThan(15);
    }
  });
});

describe("the editor's commands", () => {
  const ids = [...COMMANDS.keys()];

  it("each either never change the deck, for a reason on the list, or are in a group that changes it by an operation", () => {
    const unsorted = ids.filter((id) => !UI_ONLY.some((rule) => rule.pattern.test(id)) && !DECK_PREFIXES.includes(id.split(".")[0]!));
    expect(unsorted, "a new group of commands: say whether it changes the deck").toEqual([]);
  });

  it("have no reason on the list that no command has any more", () => {
    for (const rule of UI_ONLY) {
      expect(
        ids.some((id) => rule.pattern.test(id)),
        String(rule.pattern),
      ).toBe(true);
    }
  });
});

// The editor's function list is the core's (see the fixture's note).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, it } from "vitest";

import { FORMULA_FUNCTIONS } from "./functions";

it("lists the functions the core has, with the examples the core parses", () => {
  const file = resolve(process.cwd(), "../fixtures/table-wire/formula-functions.json");
  const fixture = JSON.parse(readFileSync(file, "utf8")) as { functions: { name: string; example: string }[] };
  expect(FORMULA_FUNCTIONS.map((f) => ({ name: f.name, example: f.example }))).toEqual(fixture.functions.map((f) => ({ name: f.name, example: f.example })));
});

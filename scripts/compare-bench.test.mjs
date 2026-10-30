import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { collect, formatTime, judge, table } from "./compare-bench.mjs";

function bench(root, name, run, median) {
  const dir = join(root, ...name.split("/"), run);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "estimates.json"), JSON.stringify({ mean: { point_estimate: median }, median: { point_estimate: median } }));
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "bench-"));
  bench(root, "read a note", "main", 1000);
  bench(root, "read a note", "new", 1100);
  bench(root, "files/note stats", "main", 2000);
  bench(root, "files/note stats", "new", 2600);
  bench(root, "only saved", "main", 5);
  return root;
}

test("collect pairs the runs and skips benches missing one", () => {
  const rows = collect(fixture(), "main", "new");
  assert.deepEqual(
    rows.map((r) => r.name),
    ["files/note stats", "read a note"],
  );
});

test("judge fails over the limit and passes under it", () => {
  const rows = judge(collect(fixture(), "main", "new"), 20);
  assert.equal(rows.find((r) => r.name === "read a note").failed, false);
  assert.equal(rows.find((r) => r.name === "files/note stats").failed, true);
  assert.equal(Math.round(rows.find((r) => r.name === "files/note stats").change), 30);
});

test("exactly the limit passes; faster never fails", () => {
  const rows = judge([
    { name: "a", base: 100, current: 120 },
    { name: "b", base: 100, current: 50 },
  ]);
  assert.deepEqual(
    rows.map((r) => r.failed),
    [false, false],
  );
});

test("only keeps benches whose name has a word", () => {
  const rows = judge(collect(fixture(), "main", "new"), 20, ["stats"]);
  assert.equal(rows.length, 1);
});

test("the table names each bench and marks failures", () => {
  const text = table(judge(collect(fixture(), "main", "new"), 20), 20);
  assert.match(text, /files\/note stats \| 2\.00 µs \| 2\.60 µs \| \+30\.0% \| FAIL/);
  assert.match(text, /read a note .* ok/);
});

test("times read in the unit that fits", () => {
  assert.equal(formatTime(500), "500 ns");
  assert.equal(formatTime(2_500_000), "2.50 ms");
  assert.equal(formatTime(3_000_000_000), "3.00 s");
});

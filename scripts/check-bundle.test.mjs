import assert from "node:assert/strict";
import { test } from "node:test";

import { firstPageFiles, kb, measure, report } from "./check-bundle.mjs";

const manifest = {
  "index.html": { file: "assets/main.js", src: "index.html", isEntry: true, imports: ["_vendor.js"], css: ["assets/main.css"], dynamicImports: ["src/Editor.tsx"] },
  "_vendor.js": { file: "assets/vendor.js", imports: ["_deep.js"] },
  "_deep.js": { file: "assets/deep.js", imports: ["_vendor.js"] },
  "src/Editor.tsx": { file: "assets/editor.js", isDynamicEntry: true, imports: ["_vendor.js"] },
  "capture.html": { file: "assets/capture.js", src: "capture.html", isEntry: true },
};

const sizes = { "assets/main.js": 100_000, "assets/main.css": 20_000, "assets/vendor.js": 150_000, "assets/deep.js": 10_000, "assets/editor.js": 900_000, "assets/capture.js": 3_000 };
const sizeOf = (file) => sizes[file];

test("an entry counts itself, its static imports and styles, never lazy chunks", () => {
  const files = firstPageFiles(manifest, "index.html").sort();
  assert.deepEqual(files, ["assets/deep.js", "assets/main.css", "assets/main.js", "assets/vendor.js"]);
});

test("measure totals each entry", () => {
  const results = measure(manifest, sizeOf);
  assert.equal(results.find((r) => r.entry === "index.html").total, 280_000);
  assert.equal(results.find((r) => r.entry === "capture.html").total, 3_000);
});

test("within the budget passes", () => {
  assert.equal(report(measure(manifest, sizeOf), 300).ok, true);
});

test("over the budget fails and names the entry and its biggest file first", () => {
  const { ok, text } = report(measure(manifest, sizeOf), 250);
  assert.equal(ok, false);
  assert.match(text, /index\.html: 280\.0 kB gzip of 250 kB \(OVER BUDGET\)/);
  assert.ok(text.indexOf("assets/vendor.js") < text.indexOf("assets/main.js"));
});

test("each entry is held to its own budget, the rest to the default", () => {
  const { ok, text } = report(measure(manifest, sizeOf), { "index.html": 290 });
  assert.equal(ok, true);
  assert.match(text, /index\.html: 280\.0 kB gzip of 290 kB\n/);
  assert.match(text, /capture\.html: 3\.0 kB gzip of 300 kB\n/);
  assert.equal(report(measure(manifest, sizeOf), { "capture.html": 2 }).ok, false);
});

test("sizes read in kilobytes", () => {
  assert.equal(kb(287_400), "287.4 kB");
});

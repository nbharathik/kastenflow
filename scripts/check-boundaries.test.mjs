import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { checkBoundaries } from "./check-boundaries.mjs";

const write = (root, path, text) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};

function repo({ manifest = {}, source = 'export const a = 1;\n', crate = {}, appSource = "export {};\n" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "boundaries-"));
  write(root, "packages/canvas/package.json", JSON.stringify({ name: "@kasten-slides/canvas", license: "Apache-2.0", ...manifest }));
  write(root, "packages/canvas/LICENSE", "Apache");
  write(root, "packages/canvas/src/index.ts", source);
  write(root, "crates/slides-core/LICENSE", "Apache");
  write(root, "app/src/main.ts", appSource);
  const metadata = {
    packages: [
      { name: "slides-core", license: "Apache-2.0", manifest_path: join(root, "crates/slides-core/Cargo.toml"), dependencies: [{ name: "serde" }], ...crate },
      { name: "kasten-core", license: "MIT", manifest_path: join(root, "crates/kasten-core/Cargo.toml"), dependencies: [{ name: "slides-core" }] },
    ],
  };
  return { root, metadata };
}

test("a clean tree has no problems", () => {
  const { root, metadata } = repo();
  assert.deepEqual(checkBoundaries(root, metadata), []);
});

test("a package that imports Kasten is reported with its line", () => {
  const { root, metadata } = repo({ source: 'import { a } from "./a.ts";\nimport { b } from "kasten-core";\nimport("@kasten/x");\n' });
  const problems = checkBoundaries(root, metadata);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /index\.ts:2: imports kasten-core/);
  assert.match(problems[1], /index\.ts:3: imports @kasten\/x/);
});

test("its own scope is not Kasten", () => {
  const { root, metadata } = repo({ source: 'import { r } from "@kasten-slides/react";\n' });
  assert.deepEqual(checkBoundaries(root, metadata), []);
});

test("a package that reaches outside its folder is reported", () => {
  const { root, metadata } = repo({ source: 'import { x } from "../../../app/src/main.ts";\n' });
  assert.match(checkBoundaries(root, metadata)[0], /outside the package/);
});

test("a Kasten dependency or the wrong licence is reported", () => {
  const { root, metadata } = repo({ manifest: { license: "MIT", dependencies: { "kasten-app": "1.0.0" } } });
  const problems = checkBoundaries(root, metadata);
  assert.equal(problems.length, 2);
  assert.match(problems.join("\n"), /license is MIT/);
  assert.match(problems.join("\n"), /names kasten-app/);
});

test("a slides crate that depends on a kasten crate, or lacks its licence, is reported", () => {
  const { root, metadata } = repo({ crate: { license: "MIT", dependencies: [{ name: "kasten-core" }] } });
  const problems = checkBoundaries(root, metadata);
  assert.match(problems.join("\n"), /license is MIT/);
  assert.match(problems.join("\n"), /depends on kasten-core/);
});

test("Kasten may depend on a slides crate", () => {
  const { root, metadata } = repo();
  assert.equal(metadata.packages[1].dependencies[0].name, "slides-core");
  assert.deepEqual(checkBoundaries(root, metadata), []);
});

test("the app must not import from inside a Slides package", () => {
  const { root, metadata } = repo({ appSource: 'import { a } from "@kasten-slides/react";\nimport { b } from "@kasten-slides/react/src/units.ts";\n' });
  const problems = checkBoundaries(root, metadata);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /main\.ts:2: imports @kasten-slides\/react\/src\/units\.ts/);
});

test("the app may use a further entry point the package exports, and no other path", () => {
  const { root, metadata } = repo({
    manifest: { exports: { ".": "./src/index.ts", "./presenter-entry": "./src/presenter-entry.ts" } },
    appSource: 'import { a } from "@kasten-slides/canvas/presenter-entry";\nimport { b } from "@kasten-slides/canvas/src/presenter-entry.ts";\n',
  });
  const problems = checkBoundaries(root, metadata);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /main\.ts:2: imports @kasten-slides\/canvas\/src\/presenter-entry\.ts/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = (name) => readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), "utf8");

test("Node setup never asks for a package manager before it is installed", () => {
  for (const name of ["ci", "release", "pages"]) {
    const steps = workflow(name).split(/(?=^      - )/m);
    const setup = steps.filter((step) => /uses: actions\/setup-node@/.test(step));
    assert.ok(setup.length > 0, `${name} sets up Node`);
    for (const step of setup) {
      assert.match(step, /package-manager-cache:\s*false\b/, `${name}: disable automatic package caching until pnpm is available`);
    }
  }
});

test("website tags deploy independently of installer releases", () => {
  const pages = workflow("pages");
  assert.match(pages, /push:\s*\n\s+tags: \["v\*", "site-v\*"\]/);
  assert.match(pages, /workflow_dispatch:/);
  assert.doesNotMatch(pages, /^\s+(?:branches|pull_request):/m);
  assert.match(workflow("release"), /tags: \["v\*"\]/);
});

test("ordinary changes retain quick checks while platform matrices need a release tag or a run by hand", () => {
  const ci = workflow("ci");
  assert.match(ci, /push:\s*\n\s+branches: \[main\]/);
  assert.match(ci, /^  pull_request:/m);
  assert.match(ci, /^  workflow_dispatch:/m);
  assert.doesNotMatch(ci, /^\s+tags:/m);
  for (const name of ["rust", "frontend"]) {
    const job = ci.split(new RegExp(`^  ${name}:`, "m"))[1]?.split(/^  \w+:/m)[0];
    assert.ok(job, `${name} job exists`);
    assert.match(job, /^    if: startsWith\(github\.ref, 'refs\/tags\/v'\) \|\| github\.event_name == 'workflow_dispatch'\r?$/m);
  }
});

test("a push to main never cancels a full run started by hand", () => {
  assert.match(workflow("ci"), /group: ci-\$\{\{ github\.event_name \}\}-\$\{\{ github\.ref \}\}/);
});

test("the Intel Mac build runs on an Intel Mac, not cross-built on Apple silicon", () => {
  assert.match(workflow("release"), /name: macos-x64, os: macos-15-intel, target: x86_64-apple-darwin/);
});

test("a full Rust run names every failure and gives Windows longer to finish", () => {
  const rust = workflow("ci").split(/^  rust:/m)[1]?.split(/^  \w+:/m)[0];
  assert.ok(rust, "rust job exists");
  assert.match(rust, /cargo test --workspace --locked --no-fail-fast/);
  const [, windows, others] = rust.match(/timeout-minutes: \$\{\{ matrix\.os == 'windows-latest' && (\d+) \|\| (\d+) \}\}/) ?? [];
  assert.ok(Number(windows) > Number(others), "Windows gets more minutes than Linux and macOS");
});

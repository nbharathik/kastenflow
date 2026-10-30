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

const job = (text, name) => text.split(new RegExp(`^  ${name}:`, "m"))[1]?.split(/^  \w+:/m)[0];

test("docs-only changes start no CI run", () => {
  const on = workflow("ci").split(/^permissions:/m)[0];
  for (const event of ["push", "pull_request"]) {
    const block = on.split(new RegExp(`^  ${event}:`, "m"))[1]?.split(/^  \w+:/m)[0];
    assert.ok(block, `${event} trigger exists`);
    assert.match(block, /^    paths-ignore: \["docs\/\*\*", "site\/\*\*", "\*\*\/\*\.md", "dev\/\*\*"\]\r?$/m, `${event} skips docs-only changes`);
  }
});

test("a release reuses a full CI run that already passed on its commit", () => {
  const release = workflow("release");
  const gate = job(release, "gate");
  assert.ok(gate, "gate job exists");
  assert.match(gate, /^    permissions:\r?\n      actions: read\r?$/m);
  assert.match(gate, /gh api "repos\/\$GH_REPO\/actions\/workflows\/ci\.yml\/runs\?head_sha=\$SHA&event=workflow_dispatch&status=success"/);
  assert.match(gate, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(gate, /SHA: \$\{\{ github\.sha \}\}/);
  assert.match(gate, /found=/);
  assert.match(gate, /^    outputs:\r?\n      found: \$\{\{ steps\.[\w-]+\.outputs\.found \}\}\r?$/m);
  assert.doesNotMatch(gate.split(/run: \|/)[1] ?? "", /\$\{\{/, "the gate script takes the tag and sha through env, not the script text");
  const checks = job(release, "checks");
  assert.match(checks, /^    needs: gate\r?$/m);
  assert.match(checks, /^    if: needs\.gate\.outputs\.found != 'true'\r?$/m);
  const build = job(release, "build");
  assert.match(build, /^    needs: \[gate, checks\]\r?$/m);
  assert.match(build, /^    if: \$\{\{ !cancelled\(\) && needs\.gate\.result == 'success' && \(needs\.checks\.result == 'success' \|\| needs\.checks\.result == 'skipped'\) \}\}\r?$/m);
  // A skipped "checks" job skips every job downstream that does not say otherwise: signing and
  // the draft must still run when the builds passed (the first real release on this path
  // built everything and then skipped both).
  const sign = job(release, "sign");
  assert.match(sign, /^    if: \$\{\{ !cancelled\(\) && github\.ref_type == 'tag' && needs\.build\.result == 'success' \}\}\r?$/m);
  const publish = job(release, "publish");
  assert.match(publish, /^    if: \$\{\{ !cancelled\(\) && github\.ref_type == 'tag' && needs\.build\.result == 'success' && needs\.sign\.result == 'success' \}\}\r?$/m);
});

test("the frontend runs on Linux and Windows; macOS stays in the Rust matrix", () => {
  const ci = workflow("ci");
  const frontend = job(ci, "frontend");
  assert.ok(frontend, "frontend job exists");
  assert.match(frontend, /os: \[ubuntu-24\.04, windows-latest\]/);
  assert.match(job(ci, "rust"), /os: \[ubuntu-24\.04, windows-latest, macos-latest\]/);
});
